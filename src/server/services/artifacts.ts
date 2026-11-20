import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM, canReadSpace } from '../actor'
import { getDb, node, user } from '../db'
import { AppError, forbidden, invalid, notFound } from '../errors'
import { appUrl } from '../env'
import { ARTIFACT_CDNS } from '../../lib/artifact-frame'
import { displayPath, mimeFor, parentOf } from '../paths'
import { accessView, canSee, effectiveAudience } from './access'
import * as dbs from './databases'
import * as files from './files'

/**
 * Artifacts: HTML docs that the app runs as live pages. An artifact is an
 * ordinary doc ending in .html, so it's versioned, private in /me until it's
 * promoted, and written by agents and flows with the same tools as any doc.
 *
 * The page runs in a sandboxed frame with no network and no session. It reaches
 * Brainspace only through the calls below, which run as the person looking at
 * it. That would let a page someone else wrote read things only the viewer can
 * see and copy them somewhere wider, so a team artifact may only touch what
 * everyone who can open the artifact can already see.
 */

export const ARTIFACT_MIME = 'text/html'

export const isArtifact = (n: { kind: string; mimeType: string | null }) => n.kind === 'doc' && n.mimeType === ARTIFACT_MIME

export async function listArtifacts(actor: Actor) {
  const spaces = [TEAM, actor.userId].filter((id) => canReadSpace(actor, id))
  const rows = await getDb()
    .select({ n: node, updatedByName: user.name })
    .from(node)
    .leftJoin(user, eq(user.id, node.updatedBy))
    .where(
      and(
        eq(node.workspaceId, actor.workspaceId),
        inArray(node.spaceId, spaces),
        eq(node.kind, 'doc'),
        eq(node.mimeType, ARTIFACT_MIME),
        isNull(node.deletedAt),
      ),
    )
    .orderBy(desc(node.updatedAt))
    .limit(500)
  const view = await accessView(actor)
  return rows
    .filter((r) => canSee(view, r.n.spaceId, r.n.path))
    .map((r) => ({ ...files.nodeInfo(actor, r.n), title: artifactTitle(r.n), updatedByName: r.updatedByName }))
}

/** What to call an artifact in a list: its <title>, else its file name, else its folder for an index.html. */
function artifactTitle(n: { name: string; path: string; content: string | null }) {
  const title = n.content?.slice(0, 20_000).match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]?.trim()
  if (title) return title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  const base = n.name.replace(/\.html?$/i, '')
  const folder = parentOf(n.path).split('/').pop()
  return base.toLowerCase() === 'index' && folder ? folder : base
}

async function requireArtifact(actor: Actor, fullPath: string) {
  const r = await files.resolve(actor, fullPath)
  if (r.isRoot || !r.node || !isArtifact(r.node)) throw notFound(`Artifact "${fullPath}"`)
  return r.node
}

/** Paths in a page are absolute (/team/..., /me/...) or relative to the artifact's folder (data.db, ../customers/customers.db). */
export function resolveFrom(artifactPath: string, target: string) {
  const t = String(target ?? '').trim()
  if (!t) throw invalid('Pass a path.')
  if (/^\/(team|me)(\/|$)/i.test(t)) return t
  if (t.startsWith('/')) {
    throw invalid(`Path "${t}" doesn't start with a space.`, 'Use /team/... or /me/..., or a path relative to the artifact like data.db.')
  }
  const parts = parentOf(artifactPath).split('/').filter(Boolean)
  for (const seg of t.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      // parts[0] is the space, which a relative path can't climb out of.
      if (parts.length <= 1) throw invalid(`Path "${t}" goes above the space.`)
      parts.pop()
    } else parts.push(seg)
  }
  return '/' + parts.join('/')
}

async function assertSharedWithAudience(actor: Actor, artifact: files.NodeRow, target: files.NodeRow) {
  // A private artifact only ever runs for its owner.
  if (artifact.spaceId !== TEAM) return
  const shown = displayPath(actor, target.spaceId, target.path)
  if (target.spaceId !== TEAM) {
    throw forbidden(`A team artifact can't use ${shown}, which is in a personal space.`, `Promote ${shown} to the team space and point the artifact at it there.`)
  }
  const view = await accessView(actor)
  const needs = effectiveAudience(view, target.path)
  if (!needs) return
  const viewers = effectiveAudience(view, artifact.path)
  if (!viewers || viewers.some((id) => !needs.includes(id))) {
    throw forbidden(
      `${shown} is restricted to fewer people than this artifact, so the artifact can't use it.`,
      'Move the artifact into the same restricted folder, or restrict it to the same people.',
    )
  }
}

async function target(actor: Actor, artifact: files.NodeRow, path: unknown, want: 'database' | 'any') {
  const full = resolveFrom(displayPath(actor, artifact.spaceId, artifact.path), String(path ?? ''))
  let r = await files.resolve(actor, full)
  // "customers" finds "customers.db".
  if (want === 'database' && !r.isRoot && !r.node) r = await files.resolve(actor, files.databasePath(full))
  if (r.isRoot || !r.node) throw notFound(`"${full}"`, 'Paths are relative to the folder the artifact is in, or start with /team/ or /me/.')
  if (want === 'database' && r.node.kind !== 'database') throw invalid(`${full} is a ${r.node.kind}, not a database.`)
  await assertSharedWithAudience(actor, artifact, r.node)
  return { n: r.node, shown: displayPath(actor, r.node.spaceId, r.node.path) }
}

export type ArtifactCall =
  | { method: 'db.query'; path: string; sql: string; params?: unknown[] }
  | { method: 'db.exec'; path: string; sql: string; params?: unknown[] }
  | { method: 'db.batch'; path: string; statements: { sql: string; params?: unknown[] }[] }
  | { method: 'db.insert'; path: string; table: string; rows: Record<string, unknown>[]; opts?: { upsertOn?: string[]; onConflict?: 'error' | 'ignore' } }
  | { method: 'db.schema'; path: string }
  | { method: 'read'; path: string }
  | { method: 'file'; path: string }

const MAX_ROWS = 5000

type Rows = { columns?: string[]; rows?: dbs.Cell[][] }
const objects = (r: Rows): Record<string, dbs.Cell>[] =>
  (r.rows ?? []).map((row) => Object.fromEntries((r.columns ?? []).map((c, i) => [c, row[i] ?? null])))

/** One call from a running artifact, made as the person looking at it. */
export async function artifactCall(actor: Actor, artifactPath: string, call: ArtifactCall) {
  const artifact = await requireArtifact(actor, artifactPath)
  switch (call.method) {
    case 'db.query': {
      const { shown } = await target(actor, artifact, call.path, 'database')
      const r = await dbs.queryDatabase(actor, shown, String(call.sql ?? ''), call.params, { maxRows: MAX_ROWS })
      // Dropping rows silently would make a page show part of the data as if it were all of it.
      if (r.truncated) {
        throw new AppError('too_large', `That query returns more than ${r.rows.length.toLocaleString('en-US')} rows (or about 900 KB).`, {
          hint: 'Filter or aggregate in SQL, or page with LIMIT and OFFSET.',
        })
      }
      return { path: shown, columns: r.columns, rows: r.rows }
    }
    case 'db.exec':
    case 'db.batch': {
      const { shown } = await target(actor, artifact, call.path, 'database')
      const input = call.method === 'db.batch' ? call.statements : { sql: String(call.sql ?? ''), params: call.params }
      if (call.method === 'db.batch' && (!Array.isArray(input) || !input.length)) throw invalid('Pass statements: [{ sql, params }, ...].')
      const r = await dbs.execDatabase(actor, shown, input, { maxRows: MAX_ROWS })
      return { path: shown, changes: r.changes, rows: r.results.flatMap((res) => objects(res as Rows)) }
    }
    case 'db.insert': {
      const { shown } = await target(actor, artifact, call.path, 'database')
      const r = await dbs.insertRows(actor, shown, String(call.table ?? ''), call.rows, call.opts ?? {})
      return { path: shown, changes: r.changes, rows: r.rows }
    }
    case 'db.schema': {
      const { shown } = await target(actor, artifact, call.path, 'database')
      return dbs.getSchema(actor, shown)
    }
    case 'read': {
      const { n, shown } = await target(actor, artifact, call.path, 'any')
      if (n.kind !== 'doc') throw invalid(`${shown} is a ${n.kind}. brain.read() returns text docs.`, n.kind === 'file' ? 'Use brain.file() for images and other files.' : undefined)
      return { path: shown, name: n.name, mimeType: n.mimeType, version: n.version, updatedAt: n.updatedAt.getTime(), content: n.content ?? '' }
    }
    case 'file': {
      const { n, shown } = await target(actor, artifact, call.path, 'any')
      if (n.kind !== 'doc' && n.kind !== 'file') throw invalid(`${shown} is a ${n.kind}, not a file.`)
      // The app fetches the bytes with the viewer's session and hands the page a blob.
      return { path: shown, id: n.id, name: n.name, mimeType: n.mimeType, size: n.size, version: n.version }
    }
    default:
      throw invalid(`Unknown call "${String((call as { method?: unknown }).method)}".`)
  }
}

// ------------------------------------------------------------------ feedback for whoever wrote the page

const STYLE_HOSTS = [...ARTIFACT_CDNS, 'https://fonts.googleapis.com']
const allowed = (url: string, hosts: string[]) => hosts.some((h) => url === h || url.startsWith(h + '/'))
const isRemote = (url: string) => /^(https?:)?\/\//i.test(url)
const attrOf = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((v) => v !== undefined)

/**
 * Things in a page that the sandbox will block. Agents write artifacts without
 * seeing them run, so `write` and `edit` hand these back. A plain text scan:
 * it can miss things and it can flag a string that's never used.
 */
export function artifactWarnings(html: string): string[] {
  const out = new Set<string>()
  const cdns = ARTIFACT_CDNS.map((h) => h.replace('https://', '')).join(', ')
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = attrOf(tag, 'src')
    if (!src) continue
    if (!isRemote(src)) out.add(`<script src="${src}"> won't load: an artifact is one file. Inline the script or load it from a CDN.`)
    else if (!allowed(src.replace(/^\/\//, 'https://'), ARTIFACT_CDNS)) out.add(`<script src="${src}"> is blocked. Scripts load only from ${cdns}.`)
  }
  for (const m of html.matchAll(/\b(?:from|import)\s*\(?\s*["'](https?:\/\/[^"']+)["']/g)) {
    if (!allowed(m[1]!, ARTIFACT_CDNS)) out.add(`import "${m[1]}" is blocked. Modules load only from ${cdns}.`)
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const href = attrOf(tag, 'href')
    if (!href || !/stylesheet/i.test(attrOf(tag, 'rel') ?? '')) continue
    if (!isRemote(href)) out.add(`<link href="${href}"> won't load: an artifact is one file. Put the CSS in a <style> tag.`)
    else if (!allowed(href.replace(/^\/\//, 'https://'), STYLE_HOSTS)) out.add(`<link href="${href}"> is blocked. Stylesheets load only from ${cdns} and fonts.googleapis.com.`)
  }
  for (const tag of html.match(/<(?:img|video|audio|source)\b[^>]*>/gi) ?? []) {
    const src = attrOf(tag, 'src')
    if (src && isRemote(src)) out.add(`${tag.match(/<\w+/)![0]} src="${src}"> is blocked: remote images and media don't load. Upload the file to Brainspace and use brain.file(path), or inline it.`)
  }
  if (/<i?frame\b/i.test(html)) out.add("Frames inside an artifact don't load.")
  if (/\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bEventSource\b|\bsendBeacon\b|\bfetch\s*\(\s*["'`](?!blob:|data:)/.test(html)) {
    out.add('The page has no network access, so fetch, XMLHttpRequest and WebSocket calls fail. Read data with brain.db.query and brain.read. For an outside API, have a flow save the data into a database.')
  }
  if (/\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie/.test(html)) {
    out.add('localStorage, sessionStorage, IndexedDB and cookies throw in an artifact. Keep state in a database with brain.db.')
  }
  if (/\blocation\.(reload|replace|assign)\s*\(|\blocation(\.href)?\s*=[^=]|\bwindow\.open\s*\(/.test(html)) {
    out.add("The page can't navigate, reload itself or open windows. Redraw from your load function, and use links or brain.open() to go somewhere.")
  }
  if (!/<title[^>]*>\s*[^<\s]/i.test(html)) out.add('Add a <title>: it is the name people see in the Artifacts list.')
  return [...out].slice(0, 12)
}

/** For write and edit results: the link to open, and anything the sandbox will block. Undefined when the path isn't an artifact. */
export function artifactInfo(fullPath: string, content: string) {
  if (mimeFor(fullPath.slice(fullPath.lastIndexOf('/') + 1)) !== ARTIFACT_MIME) return undefined
  const warnings = artifactWarnings(content)
  return {
    url: `${appUrl()}/app/space${encodeURI(fullPath)}`,
    opens: 'as a live page in the app. Give the user this link.',
    ...(warnings.length ? { warnings } : {}),
  }
}
