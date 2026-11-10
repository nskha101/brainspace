import { and, asc, desc, eq, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm'
import { createTwoFilesPatch } from 'diff'
import type { Actor } from '../actor'
import { TEAM, canDeleteInSpace, canReadSpace, canWriteSpace } from '../actor'
import { hmacSign, newId, sha256Hex } from '../crypto'
import { activity, batch, getDb, node, nodeVersion, raw, uploadLink, user } from '../db'
import { appUrl, background, getEnv } from '../env'
import { AppError, forbidden, invalid, notFound } from '../errors'
import {
  baseName,
  displayPath,
  isTextMime,
  joinPath,
  mimeFor,
  parentOf,
  inSubtree,
  parsePath,
  subtreeBounds,
  textMimeFor,
  type ParsedPath,
} from '../paths'
import { activityRow } from './activity'
import { ftsDelete, ftsReindex, ftsStatements, vectorDelete, vectorIndex } from './search'
import { publishChange } from '../live'
import { getFileText, isParseable, queueExtraction } from './extract'
import {
  accessInfo,
  accessView,
  assertCanSee,
  assertSeesAll,
  audienceFor,
  canSee,
  canSeeTrashed,
  effectiveAudience,
  forgetAccess,
  type Restriction,
  narrowAudience,
  requireAccessEditor,
  resolveList,
  resolvePeople,
  sameAudience,
  under,
} from './access'

export const MAX_DOC_BYTES = 1_000_000
export const MAX_FILE_BYTES = 95 * 1024 * 1024

type NodeRow = typeof node.$inferSelect

export type NodeInfo = {
  id: string
  path: string
  name: string
  space: 'team' | 'me'
  kind: 'folder' | 'doc' | 'file'
  mimeType: string | null
  size: number
  version: number
  description: string | null
  createdAt: number
  updatedAt: number
  updatedBy: string
  /** Restricted to certain people (set on this item itself, not inherited). */
  restricted?: boolean
}

export function nodeInfo(actor: Actor, n: NodeRow): NodeInfo {
  return {
    id: n.id,
    path: displayPath(actor, n.spaceId, n.path),
    name: n.name,
    space: n.spaceId === TEAM ? 'team' : 'me',
    kind: n.kind,
    mimeType: n.mimeType,
    size: n.size,
    version: n.version,
    description: n.description,
    createdAt: n.createdAt.getTime(),
    updatedAt: n.updatedAt.getTime(),
    updatedBy: n.updatedBy,
    ...(n.spaceId === TEAM && n.accessUsers ? { restricted: true } : {}),
  }
}


function assertReadable(actor: Actor, p: ParsedPath) {
  if (!canReadSpace(actor, p.spaceId)) throw forbidden("You can't read that space.")
}

function assertWritable(actor: Actor, spaceId: string) {
  if (!canWriteSpace(actor, spaceId)) {
    throw forbidden(
      actor.role === 'viewer'
        ? 'Your role is read-only, so you cannot change files.'
        : "You can't write to that space.",
      actor.role === 'viewer' ? 'Ask a workspace admin to make you a member.' : undefined,
    )
  }
}

async function getLive(actor: Actor, spaceId: string, path: string) {
  const [row] = await getDb()
    .select()
    .from(node)
    .where(
      and(
        eq(node.workspaceId, actor.workspaceId),
        eq(node.spaceId, spaceId),
        eq(node.path, path),
        isNull(node.deletedAt),
      ),
    )
    .limit(1)
  return row
}

export async function getNodeById(actor: Actor, id: string, opts: { includeDeleted?: boolean } = {}) {
  const [row] = await getDb()
    .select()
    .from(node)
    .where(and(eq(node.id, id), eq(node.workspaceId, actor.workspaceId)))
    .limit(1)
  if (!row || (!opts.includeDeleted && row.deletedAt) || !canReadSpace(actor, row.spaceId)) {
    throw notFound('File')
  }
  const view = await accessView(actor)
  if (row.deletedAt ? !canSeeTrashed(view, row) : !canSee(view, row.spaceId, row.path)) throw notFound('File')
  return row
}

export async function resolve(actor: Actor, fullPath: string) {
  const p = parsePath(actor, fullPath)
  assertReadable(actor, p)
  if (p.path === '/') return { p, node: undefined, isRoot: true as const }
  await assertCanSee(actor, p.spaceId, p.path)
  return { p, node: await getLive(actor, p.spaceId, p.path), isRoot: false as const }
}

async function requireNode(actor: Actor, fullPath: string) {
  const r = await resolve(actor, fullPath)
  if (r.isRoot) throw invalid('That is a space root, not a file.')
  if (!r.node) {
    throw notFound(
      `"${fullPath}"`,
      'Use list or search to find the right path. Paths start with /team/ or /me/.',
    )
  }
  return { p: r.p, node: r.node }
}

/** Make sure a folder path exists, creating missing folders. Returns the folder id (null for root). */
async function ensureFolder(
  actor: Actor,
  spaceId: string,
  path: string,
  opts: { accessUsers?: string[] | null; createOnly?: boolean } = {},
): Promise<string | null> {
  if (path === '/') return null
  const taken = () =>
    new AppError('conflict', `${displayPath(actor, spaceId, path)} already exists.`, { hint: 'Pick another destination.' })
  const parts = path.split('/').filter(Boolean)
  let parentId: string | null = null
  let cur = ''
  const db = getDb()
  for (const part of parts) {
    cur += `/${part}`
    let existing = await getLive(actor, spaceId, cur)
    if (existing && existing.kind !== 'folder') {
      throw invalid(`"${displayPath(actor, spaceId, cur)}" is a file, so it can't contain other files.`)
    }
    // Copies must create their folders, never adopt one someone else just made.
    if (existing && opts.createOnly && cur === path) throw taken()
    if (!existing) {
      const id = newId('n')
      try {
        await batch([
          db.insert(node).values({
            id,
            workspaceId: actor.workspaceId,
            spaceId,
            parentId,
            name: part,
            path: cur,
            kind: 'folder',
            // A restricted copy is restricted from the moment it exists.
            accessUsers: cur === path && spaceId === TEAM ? (opts.accessUsers ?? null) : null,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          }),
          ...ftsStatements({
            id,
            workspaceId: actor.workspaceId,
            spaceId,
            name: part,
            path: cur,
            kind: 'folder',
            content: null,
            chunkCount: 0,
          }),
        ])
        existing = await getLive(actor, spaceId, cur)
      } catch {
        if (opts.createOnly && cur === path) throw taken()
        existing = await getLive(actor, spaceId, cur)
        if (!existing) throw new AppError('conflict', `Could not create folder ${cur}`)
      }
    }
    parentId = existing!.id
  }
  return parentId
}

function indexInBackground(n: NodeRow) {
  if (n.kind === 'folder') return
  background(vectorIndex(n))
}

export async function list(actor: Actor, fullPath: string, opts: { depth?: number; limit?: number } = {}) {
  const r = await resolve(actor, fullPath)
  if (!r.isRoot && !r.node) throw notFound(`Folder "${fullPath}"`, 'Use list on /team or /me to browse from the top.')
  if (r.node && r.node.kind !== 'folder') {
    return { folder: nodeInfo(actor, r.node), entries: [nodeInfo(actor, r.node)], truncated: false }
  }
  const depth = Math.max(1, Math.min(opts.depth ?? 1, 10))
  const limit = Math.min(opts.limit ?? 500, 2000)
  const base = r.p.path
  const conds = [
    eq(node.workspaceId, actor.workspaceId),
    eq(node.spaceId, r.p.spaceId),
    isNull(node.deletedAt),
  ]
  if (depth === 1) {
    conds.push(r.node ? eq(node.parentId, r.node.id) : isNull(node.parentId))
  } else if (base !== '/') {
    conds.push(inSubtree(node.path, base))
  }
  const rows = await getDb()
    .select()
    .from(node)
    .where(and(...conds))
    .orderBy(asc(node.path))
    .limit(limit + 1)
  const baseDepth = base === '/' ? 0 : base.split('/').length - 1
  const view = await accessView(actor)
  const filtered = rows.filter((n) => n.path.split('/').length - 1 - baseDepth <= depth && canSee(view, n.spaceId, n.path))
  const entries = filtered.slice(0, limit).map((n) => nodeInfo(actor, n))
  entries.sort((a, b) =>
    depth === 1
      ? Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name)
      : a.path.localeCompare(b.path),
  )
  return {
    folder: r.node ? nodeInfo(actor, r.node) : { path: displayPath(actor, r.p.spaceId, '/'), kind: 'folder' as const },
    entries,
    truncated: rows.length > limit,
  }
}

/**
 * A download link for one version, made for one person. It always names the
 * version, so it can't follow a newer upload, and serving it checks that person
 * can still see the file.
 */
export async function signedFileUrl(actor: Actor, n: { id: string; version: number }, version?: number, ttlSec = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const v = version ?? n.version
  const sig = await hmacSign(signedPayload(n.id, v, exp, actor.userId))
  const qs = new URLSearchParams({ v: String(v), exp: String(exp), u: actor.userId, sig })
  return `${appUrl()}/api/files/${n.id}?${qs}`
}

export const signedPayload = (id: string, v: number | string, exp: number | string, userId: string) => `${id}:${v}:${exp}:${userId}`

export async function read(
  actor: Actor,
  fullPath: string,
  opts: { version?: number; offset?: number; limit?: number } = {},
) {
  const { node: n } = await requireNode(actor, fullPath)
  const info = nodeInfo(actor, n)
  if (n.kind === 'folder') {
    const listing = await list(actor, fullPath)
    return { ...info, entries: listing.entries }
  }
  let content = n.content
  let version = n.version
  let versionMeta: { message: string | null; createdAt: number } | undefined
  if (opts.version && opts.version !== n.version) {
    const [v] = await getDb()
      .select()
      .from(nodeVersion)
      .where(and(eq(nodeVersion.nodeId, n.id), eq(nodeVersion.version, opts.version)))
      .limit(1)
    if (!v) throw notFound(`Version ${opts.version} of ${info.path}`, `Use history to see versions 1-${n.version}.`)
    content = v.content
    version = v.version
    versionMeta = { message: v.message, createdAt: v.createdAt.getTime() }
  }
  if (n.kind === 'file') {
    const base = { ...info, version, currentVersion: n.version, downloadUrl: await signedFileUrl(actor, n, opts.version) }
    const extracted = !opts.version || opts.version === n.version ? await getFileText(n) : null
    if (!extracted) {
      return { ...base, text: n.textStatus ? { status: n.textStatus, error: n.textError } : undefined }
    }
    const lines = extracted.markdown.split('\n')
    const offset = Math.max(0, (opts.offset ?? 1) - 1)
    const lim = opts.limit ?? lines.length
    const paged = opts.offset !== undefined || opts.limit !== undefined
    return {
      ...base,
      text: {
        status: 'done' as const,
        pages: extracted.pages,
        chars: extracted.chars,
        content: paged ? lines.slice(offset, offset + lim).join('\n') : extracted.markdown,
        range: paged ? { offset: offset + 1, limit: lim, totalLines: lines.length } : undefined,
      },
    }
  }
  let text = content ?? ''
  let range: { offset: number; limit: number; totalLines: number } | undefined
  if (opts.offset !== undefined || opts.limit !== undefined) {
    const lines = text.split('\n')
    const offset = Math.max(0, (opts.offset ?? 1) - 1)
    const lim = opts.limit ?? lines.length
    text = lines.slice(offset, offset + lim).join('\n')
    range = { offset: offset + 1, limit: lim, totalLines: lines.length }
  }
  return { ...info, version, currentVersion: n.version, content: text, range, versionMeta }
}

type WriteOpts = {
  message?: string
  baseVersion?: number
  description?: string
  createOnly?: boolean
  activityAction?: string
  activityDetails?: Record<string, unknown>
  /** Restrict the doc as it's created (copies of restricted docs). */
  accessUsers?: string[] | null
}

function versionConflict(actor: Actor, n: NodeRow, baseVersion: number) {
  return new AppError(
    'conflict',
    `${displayPath(actor, n.spaceId, n.path)} is at version ${n.version}, not ${baseVersion}. Someone else changed it.`,
    {
      hint: 'Read the file again, merge your change into the latest content, and retry with the new baseVersion. Or use edit, which applies targeted replacements to the latest version.',
      data: { currentVersion: n.version },
    },
  )
}

export async function write(actor: Actor, fullPath: string, content: string, opts: WriteOpts = {}) {
  const p = parsePath(actor, fullPath)
  if (p.path === '/') throw invalid('Give a file path, not a space root.')
  assertWritable(actor, p.spaceId)
  await assertCanSee(actor, p.spaceId, p.path)
  const bytes = new TextEncoder().encode(content).length
  if (bytes > MAX_DOC_BYTES) {
    throw new AppError('too_large', `Docs are capped at 1 MB (this one is ${(bytes / 1e6).toFixed(1)} MB).`, {
      hint: 'Split it into several docs, or upload it as a file.',
    })
  }
  const db = getDb()
  const existing = await getLive(actor, p.spaceId, p.path)
  const message = opts.message?.slice(0, 500) || null

  if (existing) {
    if (opts.createOnly) {
      throw new AppError('conflict', `${displayPath(actor, p.spaceId, p.path)} already exists.`, {
        hint: 'Read it and use edit or write with baseVersion to change it, or pick another path.',
        data: { currentVersion: existing.version },
      })
    }
    if (existing.kind === 'folder') throw invalid(`${fullPath} is a folder.`)
    if (existing.kind === 'file') {
      throw invalid(`${fullPath} is a binary file.`, 'Use upload to replace binary files.')
    }
    if (opts.baseVersion !== undefined && opts.baseVersion !== existing.version) {
      throw versionConflict(actor, existing, opts.baseVersion)
    }
    const descChanged = opts.description !== undefined && opts.description !== existing.description
    if (existing.content === content && !descChanged) {
      return { node: nodeInfo(actor, existing), changed: false, created: false }
    }
    const version = existing.version + 1
    const description = opts.description !== undefined ? opts.description || null : existing.description
    const updated: NodeRow = {
      ...existing,
      content,
      size: bytes,
      version,
      description,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }
    try {
      await batch([
        db
          .update(node)
          .set({ content, size: bytes, version, description, updatedBy: actor.userId, updatedAt: updated.updatedAt })
          .where(and(eq(node.id, existing.id), eq(node.version, existing.version))),
        db.insert(nodeVersion).values({
          id: newId('v'),
          nodeId: existing.id,
          workspaceId: actor.workspaceId,
          version,
          content,
          size: bytes,
          hash: await sha256Hex(content),
          message,
          authorId: actor.userId,
          via: actor.via,
          clientName: actor.clientName ?? null,
        }),
        ...ftsStatements(updated),
        db.insert(activity).values(
          activityRow(actor, opts.activityAction ?? 'edit', {
            nodeId: existing.id,
            spaceId: p.spaceId,
            path: p.path,
            details: { version, message, ...opts.activityDetails },
          }),
        ),
      ])
    } catch (err) {
      const fresh = await getLive(actor, p.spaceId, p.path)
      if (fresh && fresh.version !== existing.version) throw versionConflict(actor, fresh, existing.version)
      throw err
    }
    indexInBackground(updated)
    publishChange(actor, { spaceId: p.spaceId, path: p.path, action: opts.activityAction ?? 'edit' })
    return { node: nodeInfo(actor, updated), changed: true, created: false }
  }

  if (opts.baseVersion) {
    throw notFound(`"${fullPath}"`, 'It may have been moved or deleted. Omit baseVersion to create it.')
  }
  const parentId = await ensureFolder(actor, p.spaceId, parentOf(p.path))
  const id = newId('n')
  const name = baseName(p.path)
  const row: NodeRow = {
    id,
    workspaceId: actor.workspaceId,
    spaceId: p.spaceId,
    parentId,
    name,
    path: p.path,
    kind: 'doc',
    mimeType: textMimeFor(name) ?? 'text/plain',
    size: bytes,
    content,
    r2Key: null,
    version: 1,
    description: opts.description || null,
    chunkCount: 0,
    textStatus: null,
    textError: null,
    textChars: null,
    accessUsers: p.spaceId === TEAM ? (opts.accessUsers ?? null) : null,
    trashAccess: null,
    createdBy: actor.userId,
    updatedBy: actor.userId,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
  }
  try {
    await batch([
      db.insert(node).values(row),
      db.insert(nodeVersion).values({
        id: newId('v'),
        nodeId: id,
        workspaceId: actor.workspaceId,
        version: 1,
        content,
        size: bytes,
        hash: await sha256Hex(content),
        message: message ?? 'Created',
        authorId: actor.userId,
        via: actor.via,
        clientName: actor.clientName ?? null,
      }),
      ...ftsStatements(row),
      db.insert(activity).values(
        activityRow(actor, opts.activityAction ?? 'create', {
          nodeId: id,
          spaceId: p.spaceId,
          path: p.path,
          details: { version: 1, message, ...opts.activityDetails },
        }),
      ),
    ])
  } catch (err) {
    if (await getLive(actor, p.spaceId, p.path)) {
      throw new AppError('conflict', `${fullPath} was just created by someone else.`, {
        hint: 'Read it, then edit it.',
      })
    }
    throw err
  }
  indexInBackground(row)
  publishChange(actor, { spaceId: p.spaceId, path: p.path, action: opts.activityAction ?? 'create' })
  return { node: nodeInfo(actor, row), changed: true, created: true }
}

export type Edit = { oldText: string; newText: string; replaceAll?: boolean }

export function applyEdits(content: string, edits: Edit[]) {
  let out = content
  edits.forEach((e, i) => {
    if (!e.oldText) throw invalid(`Edit ${i + 1} has an empty oldText.`)
    const count = out.split(e.oldText).length - 1
    if (count === 0) {
      throw invalid(
        `Edit ${i + 1}: oldText was not found in the current version.`,
        'Read the file again and copy oldText exactly, including whitespace and line breaks.',
      )
    }
    if (count > 1 && !e.replaceAll) {
      throw invalid(
        `Edit ${i + 1}: oldText appears ${count} times.`,
        'Include more surrounding text so it matches once, or set replaceAll: true.',
      )
    }
    out = e.replaceAll ? out.split(e.oldText).join(e.newText) : out.replace(e.oldText, () => e.newText)
  })
  return out
}

export async function edit(
  actor: Actor,
  fullPath: string,
  edits: Edit[],
  opts: { message?: string; baseVersion?: number } = {},
) {
  const { node: n } = await requireNode(actor, fullPath)
  assertWritable(actor, n.spaceId)
  if (n.kind !== 'doc') throw invalid(`${fullPath} is not a text doc.`)
  if (opts.baseVersion !== undefined && opts.baseVersion !== n.version) throw versionConflict(actor, n, opts.baseVersion)
  const next = applyEdits(n.content ?? '', edits)
  return write(actor, fullPath, next, { message: opts.message, baseVersion: n.version })
}

export async function append(actor: Actor, fullPath: string, text: string, opts: { message?: string } = {}) {
  const r = await resolve(actor, fullPath)
  if (!r.node) return write(actor, fullPath, text, { message: opts.message })
  if (r.node.kind !== 'doc') throw invalid(`${fullPath} is not a text doc.`)
  const cur = r.node.content ?? ''
  const sep = !cur || cur.endsWith('\n') ? '' : '\n'
  return write(actor, fullPath, cur + sep + text, { message: opts.message, baseVersion: r.node.version })
}

export async function mkdir(actor: Actor, fullPath: string, opts: { accessUsers?: string[] | null; createOnly?: boolean } = {}) {
  const p = parsePath(actor, fullPath)
  assertWritable(actor, p.spaceId)
  await assertCanSee(actor, p.spaceId, p.path)
  const existed = await getLive(actor, p.spaceId, p.path)
  if (existed && existed.kind !== 'folder') throw invalid(`${fullPath} is a file.`)
  await ensureFolder(actor, p.spaceId, p.path, opts)
  const n = await getLive(actor, p.spaceId, p.path)
  if (!existed && n) {
    await getDb().insert(activity).values(activityRow(actor, 'mkdir', { nodeId: n.id, spaceId: p.spaceId, path: p.path }))
    publishChange(actor, { spaceId: p.spaceId, path: p.path, action: 'mkdir' })
  }
  return { node: n ? nodeInfo(actor, n) : null, created: !existed }
}

export async function upload(
  actor: Actor,
  fullPath: string,
  data: ArrayBuffer,
  opts: {
    mimeType?: string
    message?: string
    description?: string
    baseVersion?: number
    accessUsers?: string[] | null
    createOnly?: boolean
  } = {},
) {
  const p = parsePath(actor, fullPath)
  if (p.path === '/') throw invalid('Give a file path, not a space root.')
  assertWritable(actor, p.spaceId)
  await assertCanSee(actor, p.spaceId, p.path)
  const name = baseName(p.path)
  const mime = opts.mimeType || mimeFor(name)
  if (isTextMime(mime) && data.byteLength <= MAX_DOC_BYTES && textMimeFor(name)) {
    return write(actor, fullPath, new TextDecoder().decode(data), opts)
  }
  if (data.byteLength > MAX_FILE_BYTES) throw new AppError('too_large', 'Files are capped at 95 MB.')
  const db = getDb()
  const env = getEnv()
  const existing = await getLive(actor, p.spaceId, p.path)
  if (existing && existing.kind !== 'file') {
    throw invalid(`${fullPath} already exists as a ${existing.kind}.`, 'Upload to a different path.')
  }
  if (existing && opts.createOnly) throw new AppError('conflict', `${fullPath} already exists.`)
  if (existing && opts.baseVersion !== undefined && opts.baseVersion !== existing.version) {
    throw versionConflict(actor, existing, opts.baseVersion)
  }
  const id = existing?.id ?? newId('n')
  const version = (existing?.version ?? 0) + 1
  const r2Key = `ws/${actor.workspaceId}/n/${id}/v${version}`
  const hash = await sha256Hex(data)
  await env.FILES.put(r2Key, data, { httpMetadata: { contentType: mime } })
  const message = opts.message?.slice(0, 500) || (existing ? null : 'Uploaded')
  const now = new Date()
  const description = opts.description !== undefined ? opts.description || null : (existing?.description ?? null)
  // PDFs, Word files and similar get their text extracted after the upload (see services/extract).
  const textStatus = isParseable(name) ? ('pending' as const) : null
  let row: NodeRow
  if (existing) {
    row = { ...existing, mimeType: mime, size: data.byteLength, r2Key, version, description, updatedBy: actor.userId, updatedAt: now, textStatus, textError: null, textChars: null }
  } else {
    const parentId = await ensureFolder(actor, p.spaceId, parentOf(p.path))
    row = {
      id,
      workspaceId: actor.workspaceId,
      spaceId: p.spaceId,
      parentId,
      name,
      path: p.path,
      kind: 'file',
      mimeType: mime,
      size: data.byteLength,
      content: null,
      r2Key,
      version,
      description,
      chunkCount: 0,
      textStatus,
      textError: null,
      textChars: null,
      accessUsers: p.spaceId === TEAM ? (opts.accessUsers ?? null) : null,
      trashAccess: null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
    }
  }
  await batch([
    existing
      ? db
          .update(node)
          .set({ mimeType: mime, size: data.byteLength, r2Key, version, description, updatedBy: actor.userId, updatedAt: now, textStatus, textError: null, textChars: null })
          .where(and(eq(node.id, id), eq(node.version, existing.version)))
      : db.insert(node).values(row),
    db.insert(nodeVersion).values({
      id: newId('v'),
      nodeId: id,
      workspaceId: actor.workspaceId,
      version,
      r2Key,
      size: data.byteLength,
      hash,
      message,
      authorId: actor.userId,
      via: actor.via,
      clientName: actor.clientName ?? null,
    }),
    ...ftsStatements(row),
    db.insert(activity).values(
      activityRow(actor, existing ? 'upload_version' : 'upload', {
        nodeId: id,
        spaceId: p.spaceId,
        path: p.path,
        details: { version, size: data.byteLength, mimeType: mime },
      }),
    ),
  ])
  indexInBackground(row)
  if (textStatus) background(queueExtraction({ nodeId: id, version }))
  publishChange(actor, { spaceId: p.spaceId, path: p.path, action: existing ? 'upload_version' : 'upload' })
  return { node: nodeInfo(actor, row), changed: true, created: !existing }
}

export async function describe(actor: Actor, fullPath: string, description: string) {
  const { node: n } = await requireNode(actor, fullPath)
  assertWritable(actor, n.spaceId)
  const db = getDb()
  const updated = { ...n, description: description || null }
  const fileText = n.kind === 'file' ? ((await getFileText(n))?.markdown ?? null) : null
  await batch([
    db.update(node).set({ description: updated.description }).where(eq(node.id, n.id)),
    ...ftsStatements(updated, fileText),
    db.insert(activity).values(activityRow(actor, 'describe', { nodeId: n.id, spaceId: n.spaceId, path: n.path })),
  ])
  indexInBackground(updated)
  publishChange(actor, { spaceId: n.spaceId, path: n.path, action: 'describe' })
  return nodeInfo(actor, updated)
}

async function subtree(actor: Actor, n: NodeRow, opts: { deletedAt?: Date } = {}) {
  if (n.kind !== 'folder') return [n]
  const rows = await getDb()
    .select()
    .from(node)
    .where(
      and(
        eq(node.workspaceId, actor.workspaceId),
        eq(node.spaceId, n.spaceId),
        inSubtree(node.path, n.path),
        opts.deletedAt ? eq(node.deletedAt, opts.deletedAt) : isNull(node.deletedAt),
      ),
    )
  return [n, ...rows]
}

export async function move(
  actor: Actor,
  from: string,
  to: string,
  opts: { action?: 'move' | 'promote' | 'rename' } = {},
) {
  const { node: src } = await requireNode(actor, from)
  assertWritable(actor, src.spaceId)
  const dest = parsePath(actor, to)
  assertWritable(actor, dest.spaceId)
  if (src.spaceId === TEAM && dest.spaceId !== TEAM && !canDeleteInSpace(actor, TEAM)) {
    throw forbidden(
      'Moving a file out of the team space removes it for everyone, which only admins can do.',
      'Use copy to put a copy in your personal space instead.',
    )
  }
  let destPath = dest.path
  // Check the destination before looking anything up there, so nothing about a hidden folder leaks.
  await assertCanSee(actor, dest.spaceId, destPath)
  const target = await getLive(actor, dest.spaceId, destPath)
  if (to.endsWith('/') || dest.path === '/' || target?.kind === 'folder') {
    destPath = joinPath(dest.path, src.name)
  } else if (target) {
    throw new AppError('conflict', `${to} already exists.`, {
      hint: 'Pick another destination, or move it into a folder by ending the path with "/".',
    })
  }
  if (src.spaceId === dest.spaceId && src.path === destPath) return { node: nodeInfo(actor, src), changed: false }
  await assertCanSee(actor, dest.spaceId, destPath)
  if (await getLive(actor, dest.spaceId, destPath)) {
    throw new AppError('conflict', `${displayPath(actor, dest.spaceId, destPath)} already exists.`)
  }
  if (src.kind === 'folder' && src.spaceId === dest.spaceId && destPath.startsWith(src.path + '/')) {
    throw invalid("You can't move a folder into itself.")
  }
  const nodes = await subtree(actor, src)
  if (nodes.length > 2000) throw invalid('That folder has too many items to move at once (max 2000).')
  const crossSpace = src.spaceId !== dest.spaceId
  // Moving between spaces drops restrictions, so it has to cover only what you can see.
  // Within /team, restrictions travel with the folders they're on.
  if (crossSpace) await assertSeesAll(actor, nodes, 'move it out of /team', displayPath(actor, src.spaceId, src.path))
  const srcAudience = crossSpace ? await audienceFor(actor.workspaceId, src.spaceId, src.path) : null
  // Leaving this path behind: stamp activity and earlier-trashed items that relied on it.
  const protect = src.spaceId === TEAM ? await protectStatements(actor, src.path, nodes) : null
  const parentId = await ensureFolder(actor, dest.spaceId, parentOf(destPath))
  const db = getDb()
  const newName = baseName(destPath)
  const now = new Date()
  const action = opts.action ?? (crossSpace && dest.spaceId === TEAM ? 'promote' : 'move')
  await batch([
    ...(protect?.stmts ?? []),
    db
      .update(node)
      .set({ spaceId: dest.spaceId, path: destPath, name: newName, parentId, updatedAt: now, updatedBy: actor.userId })
      .where(eq(node.id, src.id)),
    ...(src.kind === 'folder'
      ? [
          raw(
            // length(?) counts characters the way substr does (JS .length counts UTF-16 units).
            `UPDATE node SET path = ? || substr(path, length(?) + 1), drive_id = ?
             WHERE workspace_id = ? AND drive_id = ? AND path >= ? AND path < ? AND deleted_at IS NULL`,
            destPath,
            src.path,
            dest.spaceId,
            actor.workspaceId,
            src.spaceId,
            ...subtreeBounds(src.path),
          ),
        ]
      : []),
    // Restrictions only mean something in the team space.
    ...(dest.spaceId !== TEAM
      ? [
          raw(
            `UPDATE node SET access_users = NULL
             WHERE workspace_id = ? AND drive_id = ? AND (id = ? OR (path >= ? AND path < ?)) AND deleted_at IS NULL AND access_users IS NOT NULL`,
            actor.workspaceId,
            dest.spaceId,
            src.id,
            ...subtreeBounds(destPath),
          ),
        ]
      : []),
    db.insert(activity).values(
      activityRow(actor, action, {
        nodeId: src.id,
        spaceId: dest.spaceId,
        path: destPath,
        details: { from: displayPath(actor, src.spaceId, src.path), to: displayPath(actor, dest.spaceId, destPath) },
      }),
    ),
  ])
  const moved = nodes.map((n) => ({
    ...n,
    spaceId: dest.spaceId,
    path: n.id === src.id ? destPath : destPath + n.path.slice(src.path.length),
    name: n.id === src.id ? newName : n.name,
  }))
  await ftsReindex(moved)
  if (crossSpace) background(Promise.all(moved.filter((n) => n.kind !== 'folder').slice(0, 200).map((n) => vectorIndex(n))))
  const [fresh] = await db.select().from(node).where(eq(node.id, src.id))
  forgetAccess(actor)
  publishChange(actor, { spaceId: dest.spaceId, path: destPath, action })
  if (crossSpace) publishChange(actor, { spaceId: src.spaceId, path: src.path, action, audience: srcAudience })
  return { node: nodeInfo(actor, fresh!), changed: true, movedCount: nodes.length }
}

export async function copy(actor: Actor, from: string, to: string) {
  const { node: src } = await requireNode(actor, from)
  const dest = parsePath(actor, to)
  assertWritable(actor, dest.spaceId)
  let destPath = dest.path
  await assertCanSee(actor, dest.spaceId, destPath)
  const target = await getLive(actor, dest.spaceId, destPath)
  if (to.endsWith('/') || dest.path === '/' || target?.kind === 'folder') destPath = joinPath(dest.path, src.name)
  else if (target) throw new AppError('conflict', `${to} already exists.`)
  await assertCanSee(actor, dest.spaceId, destPath)
  if (await getLive(actor, dest.spaceId, destPath)) {
    throw new AppError('conflict', `${displayPath(actor, dest.spaceId, destPath)} already exists.`)
  }
  // Copy only what you can see: restricted folders inside stay behind.
  const view = await accessView(actor)
  const nodes = (await subtree(actor, src)).filter((n) => canSee(view, n.spaceId, n.path))
  if (nodes.length > 500) throw invalid('That folder is too big to copy at once (max 500 items).')
  const srcLabel = displayPath(actor, src.spaceId, src.path)
  const env = getEnv()
  // Copies inside /team stay as restricted as the originals: the top item takes on
  // everything restricting it (its own list and any folders above it), the items
  // inside keep their own lists. Each copy is restricted as it's created.
  const accessFor = (n: NodeRow) =>
    dest.spaceId !== TEAM || src.spaceId !== TEAM
      ? null
      : n.id === src.id
        ? effectiveAudience(view, src.path)
        : n.accessUsers
  for (const n of nodes) {
    const rel = n.id === src.id ? '' : n.path.slice(src.path.length)
    const target = displayPath(actor, dest.spaceId, destPath + rel)
    const accessUsers = accessFor(n)
    // Every item is created fresh. If someone else made something at that path
    // meanwhile, stop rather than pour restricted content into it.
    if (n.kind === 'folder') await mkdir(actor, target, { accessUsers, createOnly: true })
    else if (n.kind === 'doc') {
      await write(actor, target, n.content ?? '', {
        accessUsers,
        message: `Copied from ${srcLabel}`,
        description: n.description ?? undefined,
        createOnly: true,
        activityAction: 'copy',
        activityDetails: { from: displayPath(actor, n.spaceId, n.path) },
      })
    } else if (n.r2Key) {
      const obj = await env.FILES.get(n.r2Key)
      if (obj) {
        await upload(actor, target, await obj.arrayBuffer(), {
          accessUsers,
          createOnly: true,
          mimeType: n.mimeType ?? undefined,
          message: `Copied from ${srcLabel}`,
          description: n.description ?? undefined,
        })
      }
    }
  }
  forgetAccess(actor)
  const created = await getLive(actor, dest.spaceId, destPath)
  return { node: created ? nodeInfo(actor, created) : null, copiedCount: nodes.length }
}

export type PromoteResult = {
  node: NodeInfo | null
  promoted: true
  keptPrivateCopy: boolean
  /** Paths that became a new version of an existing team doc, with the version they replaced. */
  updated: { path: string; previousVersion: number; version: number }[]
  /** Paths that didn't exist in the team space before. */
  created: string[]
}

/**
 * Share private work with the team. Promoting onto a doc that already exists in
 * /team does not fail or duplicate: it becomes the next version of that doc, like
 * a commit, so everyone's agents get the new one by default and the old one stays
 * in history.
 */
export async function promote(
  actor: Actor,
  from: string,
  opts: { to?: string; keepCopy?: boolean; baseVersion?: number; message?: string } = {},
): Promise<PromoteResult> {
  const { node: src } = await requireNode(actor, from)
  if (src.spaceId === TEAM) throw invalid(`${from} is already in the team space.`)
  assertWritable(actor, TEAM)
  const dest = parsePath(actor, opts.to ?? `/team${src.path}`)
  if (dest.spaceId !== TEAM) {
    throw invalid('Promote moves things into the team space, so "to" must start with /team/.')
  }
  let destPath = dest.path
  await assertCanSee(actor, TEAM, destPath)
  let target = destPath === '/' ? undefined : await getLive(actor, TEAM, destPath)
  if (destPath === '/' || (target?.kind === 'folder' && src.kind !== 'folder') || (opts.to ?? '').endsWith('/')) {
    destPath = joinPath(destPath, src.name)
    await assertCanSee(actor, TEAM, destPath)
    target = await getLive(actor, TEAM, destPath)
  }
  const result: PromoteResult = { node: null, promoted: true, keptPrivateCopy: !!opts.keepCopy, updated: [], created: [] }
  const srcLabel = displayPath(actor, src.spaceId, src.path)

  // Nothing there yet: move (keeps the private history) or copy.
  if (!target) {
    const to = displayPath(actor, TEAM, destPath)
    if (opts.keepCopy) {
      const r = await copy(actor, from, to)
      result.node = r.node
    } else {
      const r = await move(actor, from, to, { action: 'promote' })
      result.node = r.node
    }
    result.created.push(to)
    return result
  }

  if (target.kind === 'folder' && src.kind !== 'folder') throw invalid(`${displayPath(actor, TEAM, destPath)} is a folder.`)
  if (target.kind !== 'folder' && src.kind === 'folder') {
    throw new AppError('conflict', `${displayPath(actor, TEAM, destPath)} is a file, but ${srcLabel} is a folder.`, {
      hint: 'Promote to a different path.',
    })
  }
  if (target.kind !== 'folder' && target.kind !== src.kind) {
    throw new AppError('conflict', `${displayPath(actor, TEAM, destPath)} is a ${target.kind} and ${srcLabel} is a ${src.kind}.`, {
      hint: 'Promote to a different path.',
    })
  }

  const message = opts.message ?? `Promoted from ${srcLabel}`
  const env = getEnv()

  async function promoteOne(n: NodeRow, teamPath: string, baseVersion?: number) {
    await assertCanSee(actor, TEAM, teamPath)
    const existing = await getLive(actor, TEAM, teamPath)
    const full = displayPath(actor, TEAM, teamPath)
    if (existing && existing.kind !== n.kind) {
      throw new AppError('conflict', `${full} is a ${existing.kind}, so ${displayPath(actor, n.spaceId, n.path)} can't replace it.`)
    }
    if (n.kind === 'doc') {
      const r = await write(actor, full, n.content ?? '', {
        message,
        baseVersion: existing ? (baseVersion ?? existing.version) : undefined,
        description: n.description ?? undefined,
        activityAction: 'promote',
        activityDetails: { from: displayPath(actor, n.spaceId, n.path) },
      })
      if (existing && r.changed) result.updated.push({ path: full, previousVersion: existing.version, version: r.node.version })
      else if (!existing) result.created.push(full)
      return r.node
    }
    const obj = n.r2Key ? await env.FILES.get(n.r2Key) : null
    if (!obj) throw notFound(`Stored file for ${displayPath(actor, n.spaceId, n.path)}`)
    const r = await upload(actor, full, await obj.arrayBuffer(), {
      mimeType: n.mimeType ?? undefined,
      message,
      description: n.description ?? undefined,
      baseVersion: existing ? (baseVersion ?? existing.version) : undefined,
    })
    if (existing) result.updated.push({ path: full, previousVersion: existing.version, version: r.node.version })
    else result.created.push(full)
    return r.node
  }

  if (src.kind === 'folder') {
    // Merge the folder: each file becomes a new version (or a new file) in the team folder.
    const nodes = (await subtree(actor, src)).filter((n) => n.kind !== 'folder')
    if (nodes.length > 500) throw invalid('That folder is too big to promote at once (max 500 files).')
    for (const n of nodes) await promoteOne(n, destPath + n.path.slice(src.path.length))
    const fresh = await getLive(actor, TEAM, destPath)
    result.node = fresh ? nodeInfo(actor, fresh) : null
  } else {
    result.node = await promoteOne(src, destPath, opts.baseVersion)
  }
  if (!opts.keepCopy) await trash(actor, from)
  return result
}

function groupByAudience(ids: string[], audienceOf: (id: string) => string[] | null) {
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const aud = audienceOf(id)
    if (!aud) continue
    const key = JSON.stringify(aud)
    groups.set(key, [...(groups.get(key) ?? []), id])
  }
  return groups
}

/**
 * Before a team folder or file leaves its place (trash, move, rename), stamp what
 * relied on its path for protection: activity about it and items already in the
 * trash under it. Path rules can't cover those once the path changes. Returns
 * statements to run in the same batch as the change.
 */
async function protectStatements(actor: Actor, root: string, nodes: NodeRow[]) {
  const view = await accessView(actor)
  const audienceOf = (path: string) => effectiveAudience(view, path)
  const nodeStamps = new Map(nodes.map((x) => [x.id, audienceOf(x.path)]))
  const touches = view.all.some((r) => under(r.path, root) || under(root, r.path))
  if (!touches) return { stmts: [], audienceOf, nodeStamps }
  const db = getDb()
  const stmts = []

  // Items trashed earlier from inside this folder.
  const trashed = await db
    .select({ id: node.id, path: node.path, trashAccess: node.trashAccess })
    .from(node)
    .where(
      and(
        eq(node.workspaceId, actor.workspaceId),
        eq(node.spaceId, TEAM),
        isNotNull(node.deletedAt),
        or(eq(node.path, root), inSubtree(node.path, root)),
      ),
    )
  for (const t of trashed) {
    const next = narrowAudience(t.trashAccess, audienceOf(t.path))
    if (!sameAudience(next, t.trashAccess)) stmts.push(db.update(node).set({ trashAccess: next }).where(eq(node.id, t.id)))
  }

  // Activity about these items, or at paths under this folder.
  const pick = { id: activity.id, nodeId: activity.nodeId, path: activity.path, audience: activity.audience }
  const rows = new Map<string, { id: string; nodeId: string | null; path: string | null; audience: string[] | null }>()
  const base = eq(activity.workspaceId, actor.workspaceId)
  for (const r of await db
    .select(pick)
    .from(activity)
    .where(and(base, eq(activity.spaceId, TEAM), or(eq(activity.path, root), inSubtree(activity.path, root))))) {
    rows.set(r.id, r)
  }
  const ids = [...nodeStamps.keys()]
  for (let i = 0; i < ids.length; i += 90) {
    for (const r of await db.select(pick).from(activity).where(and(base, inArray(activity.nodeId, ids.slice(i, i + 90))))) {
      rows.set(r.id, r)
    }
  }
  const stampOf = (r: { nodeId: string | null; path: string | null }) =>
    r.nodeId && nodeStamps.has(r.nodeId) ? nodeStamps.get(r.nodeId)! : r.path && under(r.path, root) ? audienceOf(r.path) : null
  const changes = new Map<string, string[]>()
  for (const r of rows.values()) {
    const next = narrowAudience(r.audience, stampOf(r))
    if (next && !sameAudience(next, r.audience)) changes.set(r.id, next)
  }
  for (const [key, group] of groupByAudience([...changes.keys()], (id) => changes.get(id)!)) {
    for (let i = 0; i < group.length; i += 90) {
      stmts.push(db.update(activity).set({ audience: JSON.parse(key) }).where(inArray(activity.id, group.slice(i, i + 90))))
    }
  }
  return { stmts, audienceOf, nodeStamps }
}

export async function trash(actor: Actor, fullPath: string) {
  const { node: n } = await requireNode(actor, fullPath)
  if (!canDeleteInSpace(actor, n.spaceId)) {
    throw forbidden(
      n.spaceId === TEAM
        ? 'Only admins can delete files from the team space.'
        : 'Your role is read-only, so you cannot delete files.',
      n.spaceId === TEAM ? 'Ask an admin to delete it, or move it into an /team/archive folder instead.' : undefined,
    )
  }
  const nodes = await subtree(actor, n)
  await assertSeesAll(actor, nodes, 'delete it', displayPath(actor, n.spaceId, n.path))
  // Stamp who could see each item, so it stays protected in the trash whatever
  // happens to the restricted folder above it later.
  const team = n.spaceId === TEAM
  const protect = team ? await protectStatements(actor, n.path, nodes) : null
  const audienceOf = (path: string) => protect?.audienceOf(path) ?? null
  const stamps = protect?.nodeStamps ?? new Map<string, string[] | null>()
  const now = new Date()
  const db = getDb()
  const ids = nodes.map((x) => x.id)
  const stmts = []
  for (let i = 0; i < ids.length; i += 90) {
    stmts.push(db.update(node).set({ deletedAt: now, deletedBy: actor.userId }).where(inArray(node.id, ids.slice(i, i + 90))))
  }
  for (const [key, group] of groupByAudience(ids, (id) => stamps.get(id) ?? null)) {
    for (let i = 0; i < group.length; i += 90) {
      stmts.push(db.update(node).set({ trashAccess: JSON.parse(key) }).where(inArray(node.id, group.slice(i, i + 90))))
    }
  }
  await batch([
    ...stmts,
    ...(protect?.stmts ?? []),
    db.insert(activity).values(
      activityRow(actor, 'delete', {
        nodeId: n.id,
        spaceId: n.spaceId,
        path: n.path,
        details: { items: nodes.length },
        audience: audienceOf(n.path),
      }),
    ),
  ])
  await ftsDelete(ids)
  background(vectorDelete(nodes))
  forgetAccess(actor)
  publishChange(actor, { spaceId: n.spaceId, path: n.path, action: 'delete', audience: audienceOf(n.path) })
  return { deleted: displayPath(actor, n.spaceId, n.path), items: nodes.length, trashId: n.id }
}

export async function listTrash(actor: Actor) {
  const spaces = [TEAM, actor.userId]
  const rows = await getDb()
    .select({ n: node, deletedByName: user.name })
    .from(node)
    .leftJoin(user, eq(user.id, node.deletedBy))
    .where(and(eq(node.workspaceId, actor.workspaceId), inArray(node.spaceId, spaces), isNotNull(node.deletedAt)))
    .orderBy(desc(node.deletedAt))
    .limit(1000)
  const byId = new Map(rows.map((r) => [r.n.id, r.n]))
  const view = await accessView(actor)
  return rows
    .filter((r) => canSeeTrashed(view, r.n))
    .filter((r) => {
      const parent = r.n.parentId ? byId.get(r.n.parentId) : undefined
      return !parent || parent.deletedAt?.getTime() !== r.n.deletedAt?.getTime()
    })
    .slice(0, 200)
    .map((r) => ({
      ...nodeInfo(actor, r.n),
      deletedAt: r.n.deletedAt!.getTime(),
      deletedBy: r.deletedByName ?? r.n.deletedBy,
      canRestore: canWriteSpace(actor, r.n.spaceId),
      canPurge: canDeleteInSpace(actor, r.n.spaceId),
    }))
}

export async function restoreFromTrash(actor: Actor, id: string, opts: { to?: string } = {}) {
  const n = await getNodeById(actor, id, { includeDeleted: true })
  if (!n.deletedAt) throw invalid('That item is not in the trash.')
  assertWritable(actor, n.spaceId)
  let spaceId = n.spaceId
  let path = n.path
  if (opts.to) {
    const p = parsePath(actor, opts.to)
    if (p.spaceId !== n.spaceId) throw invalid('Restore into the same space, then move it.')
    path = p.path
  }
  await assertCanSee(actor, spaceId, path)
  if (await getLive(actor, spaceId, path)) {
    throw new AppError('conflict', `Something already exists at ${displayPath(actor, spaceId, path)}.`, {
      hint: 'Pass "to" with a different path to restore it there.',
    })
  }
  const nodes = await subtree(actor, n, { deletedAt: n.deletedAt })
  await assertSeesAll(actor, nodes, 'restore it', displayPath(actor, n.spaceId, n.path))
  const parentId = await ensureFolder(actor, spaceId, parentOf(path))
  const db = getDb()
  const ids = nodes.map((x) => x.id)
  const stmts = []
  for (let i = 0; i < ids.length; i += 90) {
    stmts.push(
      db.update(node).set({ deletedAt: null, deletedBy: null, trashAccess: null }).where(inArray(node.id, ids.slice(i, i + 90))),
    )
  }
  // Each item comes back at least as restricted as when it was deleted. Walk from
  // the top down, counting restrictions put back along the way, and wherever the
  // live folders above wouldn't keep the stamped audience, restrict the item itself.
  // An admin can open things up later.
  const view = await accessView(actor)
  const restored = (x: NodeRow) => (x.id === n.id ? path : path + x.path.slice(n.path.length))
  const added: Restriction[] = []
  const restrict = new Map<string, string[]>()
  if (spaceId === TEAM) {
    for (const x of [...nodes].sort((a, b) => a.path.length - b.path.length)) {
      const at = restored(x)
      const own = x.accessUsers ?? null
      const there = effectiveAudience({ all: [...view.all, ...added], members: view.members }, at)
      // Compare people, not raw lists: a list whose people all left stands for the admins.
      const needed = narrowAudience(own ? resolveList(view, own) : null, x.trashAccess ?? null)
      const keeps = !needed || (!!there && there.every((id) => needed.includes(id)))
      const next = keeps ? own : needed
      if (next && !sameAudience(next, own)) restrict.set(x.id, next)
      if (next) added.push({ nodeId: x.id, path: at, userIds: next, people: [] })
    }
  }
  await batch([
    ...stmts,
    db
      .update(node)
      .set({ parentId, path, name: baseName(path) })
      .where(eq(node.id, n.id)),
    ...[...restrict].map(([id, users]) => db.update(node).set({ accessUsers: users }).where(eq(node.id, id))),
    ...(path !== n.path && n.kind === 'folder'
      ? [
          ...ids
            .filter((x) => x !== n.id)
            .map((x) => raw('UPDATE node SET path = ? || substr(path, length(?) + 1) WHERE id = ?', path, n.path, x)),
        ]
      : []),
    db.insert(activity).values(activityRow(actor, 'restore', { nodeId: n.id, spaceId, path })),
  ])
  const all: NodeRow[] = []
  for (let i = 0; i < ids.length; i += 90) {
    all.push(...(await db.select().from(node).where(inArray(node.id, ids.slice(i, i + 90)))))
  }
  await ftsReindex(all)
  background(Promise.all(all.filter((x) => x.kind !== 'folder').slice(0, 200).map((x) => vectorIndex(x))))
  forgetAccess(actor)
  publishChange(actor, { spaceId, path, action: 'restore' })
  return { restored: displayPath(actor, spaceId, path), items: nodes.length }
}

export async function purge(actor: Actor, id: string) {
  const n = await getNodeById(actor, id, { includeDeleted: true })
  if (!n.deletedAt) throw invalid('Only items in the trash can be permanently deleted. Delete it first.')
  if (!canDeleteInSpace(actor, n.spaceId)) throw forbidden('Only admins can permanently delete team files.')
  const nodes = await subtree(actor, n, { deletedAt: n.deletedAt })
  await assertSeesAll(actor, nodes, 'permanently delete it', displayPath(actor, n.spaceId, n.path))
  const ids = nodes.map((x) => x.id)
  const db = getDb()
  const keys = new Set<string>()
  for (let i = 0; i < ids.length; i += 90) {
    const vs = await db
      .select({ r2Key: nodeVersion.r2Key })
      .from(nodeVersion)
      .where(and(inArray(nodeVersion.nodeId, ids.slice(i, i + 90)), isNotNull(nodeVersion.r2Key)))
    vs.forEach((v) => v.r2Key && keys.add(v.r2Key))
  }
  nodes.forEach((x) => x.r2Key && keys.add(x.r2Key))
  const env = getEnv()
  const keyList = [...keys]
  for (let i = 0; i < keyList.length; i += 1000) await env.FILES.delete(keyList.slice(i, i + 1000))
  for (let i = 0; i < ids.length; i += 90) await db.delete(node).where(inArray(node.id, ids.slice(i, i + 90)))
  const audience = n.spaceId === TEAM ? (n.trashAccess ?? null) : null
  await db.insert(activity).values(
    activityRow(actor, 'purge', { spaceId: n.spaceId, path: n.path, details: { items: nodes.length }, audience }),
  )
  // The live rules may no longer cover this path, so use the stamp from when it was deleted.
  publishChange(actor, { spaceId: n.spaceId, path: n.path, action: 'purge', ...(audience ? { audience } : {}) })
  return { purged: displayPath(actor, n.spaceId, n.path), items: nodes.length }
}

export async function history(actor: Actor, fullPath: string, opts: { limit?: number } = {}) {
  const { node: n } = await requireNode(actor, fullPath)
  const rows = await getDb()
    .select({
      version: nodeVersion.version,
      message: nodeVersion.message,
      size: nodeVersion.size,
      via: nodeVersion.via,
      clientName: nodeVersion.clientName,
      createdAt: nodeVersion.createdAt,
      authorId: nodeVersion.authorId,
      authorName: user.name,
      authorEmail: user.email,
      authorImage: user.image,
    })
    .from(nodeVersion)
    .leftJoin(user, eq(user.id, nodeVersion.authorId))
    .where(eq(nodeVersion.nodeId, n.id))
    .orderBy(desc(nodeVersion.version))
    .limit(Math.min(opts.limit ?? 50, 500))
  return {
    node: nodeInfo(actor, n),
    versions: rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime(), current: r.version === n.version })),
  }
}

async function versionContent(n: NodeRow, version: number) {
  if (version === n.version) return { content: n.content ?? '', r2Key: n.r2Key }
  const [v] = await getDb()
    .select()
    .from(nodeVersion)
    .where(and(eq(nodeVersion.nodeId, n.id), eq(nodeVersion.version, version)))
    .limit(1)
  if (!v) throw notFound(`Version ${version}`, `This file has versions 1-${n.version}.`)
  return { content: v.content ?? '', r2Key: v.r2Key }
}

export async function diff(actor: Actor, fullPath: string, from: number, to?: number) {
  const { node: n } = await requireNode(actor, fullPath)
  if (n.kind !== 'doc') throw invalid('Diffs only work on text docs.')
  const toV = to ?? n.version
  const [a, b] = await Promise.all([versionContent(n, from), versionContent(n, toV)])
  const label = displayPath(actor, n.spaceId, n.path)
  return {
    path: label,
    from,
    to: toV,
    patch: createTwoFilesPatch(`${label}@v${from}`, `${label}@v${toV}`, a.content, b.content, '', '', { context: 3 }),
  }
}

export async function restoreVersion(actor: Actor, fullPath: string, version: number, opts: { message?: string } = {}) {
  const { node: n } = await requireNode(actor, fullPath)
  assertWritable(actor, n.spaceId)
  if (version === n.version) return { node: nodeInfo(actor, n), changed: false }
  const v = await versionContent(n, version)
  if (n.kind === 'doc') {
    return write(actor, fullPath, v.content, {
      message: opts.message ?? `Restored version ${version}`,
      baseVersion: n.version,
      activityAction: 'restore_version',
      activityDetails: { restoredFrom: version },
    })
  }
  if (!v.r2Key) throw invalid('That version has no stored file.')
  const obj = await getEnv().FILES.get(v.r2Key)
  if (!obj) throw notFound('Stored file for that version')
  return upload(actor, fullPath, await obj.arrayBuffer(), {
    mimeType: n.mimeType ?? undefined,
    message: opts.message ?? `Restored version ${version}`,
    baseVersion: n.version,
  })
}

export async function recent(actor: Actor, opts: { limit?: number; space?: 'team' | 'me' | 'all' } = {}) {
  const spaces = opts.space === 'team' ? [TEAM] : opts.space === 'me' ? [actor.userId] : [TEAM, actor.userId]
  const rows = await getDb()
    .select({ n: node, updatedByName: user.name })
    .from(node)
    .leftJoin(user, eq(user.id, node.updatedBy))
    .where(
      and(
        eq(node.workspaceId, actor.workspaceId),
        inArray(node.spaceId, spaces),
        isNull(node.deletedAt),
        or(eq(node.kind, 'doc'), eq(node.kind, 'file')),
      ),
    )
    .orderBy(desc(node.updatedAt))
    .limit(Math.min(opts.limit ?? 20, 100) * 3)
  const view = await accessView(actor)
  return rows
    .filter((r) => canSee(view, r.n.spaceId, r.n.path))
    .slice(0, Math.min(opts.limit ?? 20, 100))
    .map((r) => ({ ...nodeInfo(actor, r.n), updatedByName: r.updatedByName }))
}

export async function findByName(actor: Actor, spaceId: string, pattern: string) {
  return getDb()
    .select()
    .from(node)
    .where(
      and(
        eq(node.workspaceId, actor.workspaceId),
        eq(node.spaceId, spaceId),
        isNull(node.deletedAt),
        like(node.path, pattern),
      ),
    )
    .orderBy(asc(node.path))
    .limit(500)
}

export async function spaceStats(actor: Actor) {
  const rows = await getDb()
    .select({ spaceId: node.spaceId, kind: node.kind, count: sql<number>`count(*)`, bytes: sql<number>`sum(size)` })
    .from(node)
    .where(and(eq(node.workspaceId, actor.workspaceId), inArray(node.spaceId, [TEAM, actor.userId]), isNull(node.deletedAt)))
    .groupBy(node.spaceId, node.kind)
  const out = { team: { docs: 0, files: 0, folders: 0, bytes: 0 }, me: { docs: 0, files: 0, folders: 0, bytes: 0 } }
  for (const r of rows) {
    const d = r.spaceId === TEAM ? out.team : out.me
    if (r.kind === 'doc') d.docs = r.count
    else if (r.kind === 'file') d.files = r.count
    else d.folders = r.count
    d.bytes += r.bytes ?? 0
  }
  return out
}

/** Who can see a team file or folder, and whether that comes from a folder above it. */
export async function getAccess(actor: Actor, fullPath: string) {
  const r = await resolve(actor, fullPath)
  if (r.p.spaceId !== TEAM) {
    throw invalid('Only team space items have access settings. Your /me space is already private to you.')
  }
  if (!r.isRoot && !r.node) throw notFound(`"${fullPath}"`, 'Use list or search to find the right path.')
  return (await accessInfo(actor, TEAM, r.p.path))!
}

/**
 * Restrict a team folder or file to certain people, change who's on the list,
 * or open it back up to everyone (people: null). Any member or admin who can
 * see it can do this, and you stay on any list you set, so you can't lock
 * yourself out.
 */
export async function setAccess(actor: Actor, fullPath: string, people: string[] | null) {
  requireAccessEditor(actor)
  const { node: n } = await requireNode(actor, fullPath)
  if (n.spaceId !== TEAM) {
    throw invalid('Only team space items can be restricted. Your /me space is already private to you.')
  }
  const before = n.accessUsers
  let next: string[] | null = null
  if (people) {
    const { ids } = await resolvePeople(actor, people)
    next = [actor.userId, ...ids.filter((id) => id !== actor.userId)]
  }
  const same = JSON.stringify(before ?? null) === JSON.stringify(next) ||
    (!!before && !!next && before.length === next.length && before.every((id) => next!.includes(id)))
  if (!same) {
    const action = !next ? 'unrestrict' : before ? 'access_change' : 'restrict'
    // Whoever could see it before the change hears about it, as well as whoever can see it now.
    const hadAccess = await audienceFor(actor.workspaceId, TEAM, n.path)
    const { members } = await resolvePeople(actor, [])
    const nameOf = (id: string) => members.get(id)?.name ?? id
    await batch([
      getDb().update(node).set({ accessUsers: next }).where(eq(node.id, n.id)),
      // Upload links into it were made for a different audience. Turn them off.
      ...(next
        ? [
            getDb()
              .update(uploadLink)
              .set({ revokedAt: new Date() })
              .where(
                and(
                  eq(uploadLink.workspaceId, actor.workspaceId),
                  eq(uploadLink.spaceId, TEAM),
                  isNull(uploadLink.revokedAt),
                  or(eq(uploadLink.path, n.path), inSubtree(uploadLink.path, n.path)),
                ),
              ),
          ]
        : []),
      getDb().insert(activity).values(
        activityRow(actor, action, {
          nodeId: n.id,
          spaceId: n.spaceId,
          path: n.path,
          details: next ? { people: next.map(nameOf) } : {},
        }),
      ),
    ])
    forgetAccess(actor)
    publishChange(actor, { spaceId: n.spaceId, path: n.path, action, alsoTo: hadAccess ?? 'everyone' })
  }
  return { ...(await accessInfo(actor, TEAM, n.path))!, changed: !same }
}
