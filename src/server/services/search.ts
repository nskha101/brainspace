import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM } from '../actor'
import { batch, getDb, node, nodeText, raw } from '../db'
import { getEnv } from '../env'
import { displayPath } from '../paths'
import { accessView, canSee } from './access'

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5'
const CHUNK_CHARS = 1800
const CHUNK_OVERLAP = 200
const MAX_CHUNKS = 60

type IndexableNode = {
  id: string
  workspaceId: string
  spaceId: string
  name: string
  path: string
  kind: string
  content: string | null
  description?: string | null
  /** Folders only. */
  notes?: string | null
  chunkCount: number
  version?: number
}

/** Extracted text for binary files (PDF, Word...), current version only. */
async function fileTexts(nodes: IndexableNode[]): Promise<Map<string, string>> {
  const files = nodes.filter((n) => n.kind === 'file')
  const out = new Map<string, string>()
  for (let i = 0; i < files.length; i += 90) {
    const slice = files.slice(i, i + 90)
    const rows = await getDb()
      .select({ nodeId: nodeText.nodeId, version: nodeText.version, markdown: nodeText.markdown })
      .from(nodeText)
      .where(inArray(nodeText.nodeId, slice.map((n) => n.id)))
    for (const r of rows) {
      const n = slice.find((x) => x.id === r.nodeId)
      if (n && (n.version === undefined || n.version === r.version)) out.set(r.nodeId, r.markdown)
    }
  }
  return out
}

/** Keyword index statements, meant to run inside the same batch as the write. */
/** `fileText` is the extracted text of a binary file; pass it so a reindex doesn't drop it. */
export function ftsStatements(n: IndexableNode, fileText?: string | null) {
  const body = n.kind === 'doc' ? n.content : n.kind === 'folder' ? n.notes : fileText
  const text = [n.description ?? '', body ?? ''].join('\n')
  return [
    raw('DELETE FROM node_fts WHERE node_id = ?', n.id),
    raw(
      'INSERT INTO node_fts (node_id, workspace_id, drive_id, name, path, content) VALUES (?, ?, ?, ?, ?, ?)',
      n.id,
      n.workspaceId,
      n.spaceId,
      n.name,
      n.path,
      text,
    ),
  ]
}

export async function ftsDelete(nodeIds: string[]) {
  if (!nodeIds.length) return
  const env = getEnv()
  const stmts = nodeIds.map((id) => env.DB.prepare('DELETE FROM node_fts WHERE node_id = ?').bind(id))
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50))
}

export async function ftsReindex(nodes: IndexableNode[]) {
  const texts = await fileTexts(nodes)
  const stmts = nodes.flatMap((n) => ftsStatements(n, texts.get(n.id)))
  for (let i = 0; i < stmts.length; i += 50) await batch(stmts.slice(i, i + 50))
}

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r/g, '').trim()
  if (!clean) return []
  const chunks: string[] = []
  let start = 0
  while (start < clean.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(start + CHUNK_CHARS, clean.length)
    if (end < clean.length) {
      const para = clean.lastIndexOf('\n\n', end)
      const line = clean.lastIndexOf('\n', end)
      if (para > start + CHUNK_CHARS / 2) end = para
      else if (line > start + CHUNK_CHARS / 2) end = line
    }
    chunks.push(clean.slice(start, end).trim())
    if (end >= clean.length) break
    start = Math.max(end - CHUNK_OVERLAP, start + 1)
  }
  return chunks.filter(Boolean)
}

async function embed(texts: string[]): Promise<number[][]> {
  const env = getEnv()
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 50) {
    const res = (await env.AI.run(EMBED_MODEL, { text: texts.slice(i, i + 50) })) as {
      data: number[][]
    }
    out.push(...res.data)
  }
  return out
}

/** Semantic index. Runs in the background after a write. Returns the new chunk count. */
export async function vectorIndex(n: IndexableNode, fileText?: string | null): Promise<number> {
  const env = getEnv()
  if (n.kind === 'file' && fileText === undefined) fileText = (await fileTexts([n])).get(n.id) ?? null
  const body = n.kind === 'doc' ? (n.content ?? '') : (fileText ?? '')
  const header = `${n.path}\n${n.description ?? ''}`.trim()
  const chunks = body ? chunkText(body) : [header]
  const vectors = await embed(chunks.map((c) => `${header}\n\n${c}`))
  if (vectors.length) {
    await env.VECTORS.upsert(
      vectors.map((values, i) => ({
        id: `${n.id}:${i}`,
        values,
        metadata: {
          workspaceId: n.workspaceId,
          // Vectorize metadata key (and its index) predates the "space" rename.
          driveId: n.spaceId,
          nodeId: n.id,
          chunk: i,
          text: chunks[i]!.slice(0, 1500),
        },
      })),
    )
  }
  const stale = []
  for (let i = vectors.length; i < n.chunkCount; i++) stale.push(`${n.id}:${i}`)
  if (stale.length) await env.VECTORS.deleteByIds(stale)
  await getDb().update(node).set({ chunkCount: vectors.length }).where(eq(node.id, n.id))
  return vectors.length
}

export async function vectorDelete(nodes: { id: string; chunkCount: number }[]) {
  const ids = nodes.flatMap((n) => Array.from({ length: n.chunkCount }, (_, i) => `${n.id}:${i}`))
  if (!ids.length) return
  const env = getEnv()
  for (let i = 0; i < ids.length; i += 500) await env.VECTORS.deleteByIds(ids.slice(i, i + 500))
}

export type SearchHit = {
  id: string
  path: string
  name: string
  kind: string
  space: 'team' | 'me'
  version: number
  updatedAt: number
  snippet: string
  score: number
  matchedBy: ('keyword' | 'semantic')[]
}

function ftsQuery(q: string, mode: 'and' | 'or') {
  const tokens = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 12)
  if (!tokens.length) return null
  return tokens.map((t) => `"${t}"*`).join(mode === 'and' ? ' AND ' : ' OR ')
}

export async function search(
  actor: Actor,
  query: string,
  opts: { space?: 'team' | 'me' | 'all'; mode?: 'hybrid' | 'keyword' | 'semantic'; limit?: number; pathPrefix?: string } = {},
): Promise<SearchHit[]> {
  const env = getEnv()
  const limit = Math.min(opts.limit ?? 10, 50)
  const mode = opts.mode ?? 'hybrid'
  const spaces =
    opts.space === 'team' ? [TEAM] : opts.space === 'me' ? [actor.userId] : [TEAM, actor.userId]
  const hits = new Map<string, { score: number; snippet: string; matchedBy: Set<'keyword' | 'semantic'> }>()

  const view = await accessView(actor)
  if (mode !== 'semantic') {
    // Leave restricted folders the actor can't see out of the keyword query itself,
    // so they can't crowd out the hits that remain.
    const blocked = [...new Set(view.blocked.map((r) => r.path))]
    // One JSON parameter however many there are (D1 allows 100 bound parameters).
    const exclude = blocked.length
      ? ` AND NOT (node_fts.drive_id = '${TEAM}' AND EXISTS (SELECT 1 FROM json_each(?) j WHERE node_fts.path = j.value OR (node_fts.path >= j.value || '/' AND node_fts.path < j.value || '0')))`
      : ''
    const excludeArgs = blocked.length ? [JSON.stringify(blocked)] : []
    for (const m of ['and', 'or'] as const) {
      const fq = ftsQuery(query, m)
      if (!fq) break
      const placeholders = spaces.map(() => '?').join(',')
      const res = await env.DB.prepare(
        `SELECT node_id, bm25(node_fts, 0, 0, 0, 8.0, 4.0, 1.0) AS rank,
                snippet(node_fts, 5, '**', '**', '…', 24) AS snip
         FROM node_fts
         WHERE node_fts MATCH ? AND workspace_id = ? AND drive_id IN (${placeholders})${exclude}
         ORDER BY rank LIMIT ?`,
      )
        .bind(fq, actor.workspaceId, ...spaces, ...excludeArgs, limit * 2)
        .all<{ node_id: string; rank: number; snip: string }>()
      res.results.forEach((r, i) => {
        const score = 1 / (60 + i)
        hits.set(r.node_id, { score, snippet: r.snip, matchedBy: new Set(['keyword']) })
      })
      if (res.results.length) break
    }
  }

  if (mode !== 'keyword') {
    try {
      const [vec] = await embed([query])
      const res = await env.VECTORS.query(vec!, {
        topK: Math.min(limit * 3, 50),
        returnMetadata: 'all',
        filter: { workspaceId: actor.workspaceId, driveId: { $in: spaces } },
      })
      const seen = new Set<string>()
      let rank = 0
      for (const m of res.matches) {
        const md = m.metadata as { nodeId?: string; text?: string; driveId?: string } | undefined
        if (!md?.nodeId || seen.has(md.nodeId) || !spaces.includes(md.driveId ?? '')) continue
        seen.add(md.nodeId)
        const score = 1 / (60 + rank++)
        const prev = hits.get(md.nodeId)
        if (prev) {
          prev.score += score
          prev.matchedBy.add('semantic')
        } else {
          hits.set(md.nodeId, {
            score,
            snippet: (md.text ?? '').slice(0, 300),
            matchedBy: new Set(['semantic']),
          })
        }
      }
    } catch (err) {
      console.error('[search] semantic search failed', err)
    }
  }

  if (!hits.size) return []
  const ids = [...hits.keys()]
  const rows = await getDb()
    .select({
      id: node.id,
      spaceId: node.spaceId,
      path: node.path,
      name: node.name,
      kind: node.kind,
      version: node.version,
      updatedAt: node.updatedAt,
    })
    .from(node)
    .where(and(inArray(node.id, ids), eq(node.workspaceId, actor.workspaceId), isNull(node.deletedAt)))

  const prefix = opts.pathPrefix?.replace(/\/$/, '')
  return rows
    .filter((r) => spaces.includes(r.spaceId) && canSee(view, r.spaceId, r.path))
    .map((r) => {
      const h = hits.get(r.id)!
      return {
        id: r.id,
        path: displayPath(actor, r.spaceId, r.path),
        name: r.name,
        kind: r.kind,
        space: (r.spaceId === TEAM ? 'team' : 'me') as 'team' | 'me',
        version: r.version,
        updatedAt: r.updatedAt.getTime(),
        snippet: h.snippet,
        score: Number(h.score.toFixed(5)),
        matchedBy: [...h.matchedBy],
      }
    })
    .filter((r) => !prefix || r.path === prefix || r.path.startsWith(prefix + '/'))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
