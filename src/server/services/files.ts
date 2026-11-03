import { and, asc, desc, eq, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm'
import { createTwoFilesPatch } from 'diff'
import type { Actor } from '../actor'
import { TEAM, canDeleteInDrive, canReadDrive, canWriteDrive } from '../actor'
import { hmacSign, newId, sha256Hex } from '../crypto'
import { activity, batch, getDb, node, nodeVersion, raw, user } from '../db'
import { appUrl, background, getEnv } from '../env'
import { AppError, forbidden, invalid, notFound } from '../errors'
import {
  baseName,
  displayPath,
  isTextMime,
  joinPath,
  mimeFor,
  parentOf,
  parsePath,
  textMimeFor,
  type ParsedPath,
} from '../paths'
import { activityRow } from './activity'
import { ftsDelete, ftsReindex, ftsStatements, vectorDelete, vectorIndex } from './search'
import { publishChange } from '../live'

export const MAX_DOC_BYTES = 1_000_000
export const MAX_FILE_BYTES = 95 * 1024 * 1024

type NodeRow = typeof node.$inferSelect

export type NodeInfo = {
  id: string
  path: string
  name: string
  drive: 'team' | 'me'
  kind: 'folder' | 'doc' | 'file'
  mimeType: string | null
  size: number
  version: number
  description: string | null
  createdAt: number
  updatedAt: number
  updatedBy: string
}

export function nodeInfo(actor: Actor, n: NodeRow): NodeInfo {
  return {
    id: n.id,
    path: displayPath(actor, n.driveId, n.path),
    name: n.name,
    drive: n.driveId === TEAM ? 'team' : 'me',
    kind: n.kind,
    mimeType: n.mimeType,
    size: n.size,
    version: n.version,
    description: n.description,
    createdAt: n.createdAt.getTime(),
    updatedAt: n.updatedAt.getTime(),
    updatedBy: n.updatedBy,
  }
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
const subtreeLike = (path: string) => `${likeEscape(path)}/%`

function assertReadable(actor: Actor, p: ParsedPath) {
  if (!canReadDrive(actor, p.driveId)) throw forbidden("You can't read that drive.")
}

function assertWritable(actor: Actor, driveId: string) {
  if (!canWriteDrive(actor, driveId)) {
    throw forbidden(
      actor.role === 'viewer'
        ? 'Your role is read-only, so you cannot change files.'
        : "You can't write to that drive.",
      actor.role === 'viewer' ? 'Ask a workspace admin to make you a member.' : undefined,
    )
  }
}

async function getLive(actor: Actor, driveId: string, path: string) {
  const [row] = await getDb()
    .select()
    .from(node)
    .where(
      and(
        eq(node.workspaceId, actor.workspaceId),
        eq(node.driveId, driveId),
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
  if (!row || (!opts.includeDeleted && row.deletedAt) || !canReadDrive(actor, row.driveId)) {
    throw notFound('File')
  }
  return row
}

export async function resolve(actor: Actor, fullPath: string) {
  const p = parsePath(actor, fullPath)
  assertReadable(actor, p)
  if (p.path === '/') return { p, node: undefined, isRoot: true as const }
  return { p, node: await getLive(actor, p.driveId, p.path), isRoot: false as const }
}

async function requireNode(actor: Actor, fullPath: string) {
  const r = await resolve(actor, fullPath)
  if (r.isRoot) throw invalid('That is a drive root, not a file.')
  if (!r.node) {
    throw notFound(
      `"${fullPath}"`,
      'Use list or search to find the right path. Paths start with /team/ or /me/.',
    )
  }
  return { p: r.p, node: r.node }
}

/** Make sure a folder path exists, creating missing folders. Returns the folder id (null for root). */
async function ensureFolder(actor: Actor, driveId: string, path: string): Promise<string | null> {
  if (path === '/') return null
  const parts = path.split('/').filter(Boolean)
  let parentId: string | null = null
  let cur = ''
  const db = getDb()
  for (const part of parts) {
    cur += `/${part}`
    let existing = await getLive(actor, driveId, cur)
    if (existing && existing.kind !== 'folder') {
      throw invalid(`"${displayPath(actor, driveId, cur)}" is a file, so it can't contain other files.`)
    }
    if (!existing) {
      const id = newId('n')
      try {
        await batch([
          db.insert(node).values({
            id,
            workspaceId: actor.workspaceId,
            driveId,
            parentId,
            name: part,
            path: cur,
            kind: 'folder',
            createdBy: actor.userId,
            updatedBy: actor.userId,
          }),
          ...ftsStatements({
            id,
            workspaceId: actor.workspaceId,
            driveId,
            name: part,
            path: cur,
            kind: 'folder',
            content: null,
            chunkCount: 0,
          }),
        ])
        existing = await getLive(actor, driveId, cur)
      } catch {
        existing = await getLive(actor, driveId, cur)
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
    eq(node.driveId, r.p.driveId),
    isNull(node.deletedAt),
  ]
  if (depth === 1) {
    conds.push(r.node ? eq(node.parentId, r.node.id) : isNull(node.parentId))
  } else if (base !== '/') {
    conds.push(sql`${node.path} LIKE ${subtreeLike(base)} ESCAPE '\\'`)
  }
  const rows = await getDb()
    .select()
    .from(node)
    .where(and(...conds))
    .orderBy(asc(node.path))
    .limit(limit + 1)
  const baseDepth = base === '/' ? 0 : base.split('/').length - 1
  const filtered = rows.filter((n) => n.path.split('/').length - 1 - baseDepth <= depth)
  const entries = filtered.slice(0, limit).map((n) => nodeInfo(actor, n))
  entries.sort((a, b) =>
    depth === 1
      ? Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name)
      : a.path.localeCompare(b.path),
  )
  return {
    folder: r.node ? nodeInfo(actor, r.node) : { path: displayPath(actor, r.p.driveId, '/'), kind: 'folder' as const },
    entries,
    truncated: rows.length > limit,
  }
}

export async function signedFileUrl(n: { id: string }, version?: number, ttlSec = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const payload = `${n.id}:${version ?? ''}:${exp}`
  const sig = await hmacSign(payload)
  const qs = new URLSearchParams({ exp: String(exp), sig })
  if (version) qs.set('v', String(version))
  return `${appUrl()}/api/files/${n.id}?${qs}`
}

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
    return { ...info, version, currentVersion: n.version, downloadUrl: await signedFileUrl(n, opts.version) }
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
}

function versionConflict(actor: Actor, n: NodeRow, baseVersion: number) {
  return new AppError(
    'conflict',
    `${displayPath(actor, n.driveId, n.path)} is at version ${n.version}, not ${baseVersion}. Someone else changed it.`,
    {
      hint: 'Read the file again, merge your change into the latest content, and retry with the new baseVersion. Or use edit, which applies targeted replacements to the latest version.',
      data: { currentVersion: n.version },
    },
  )
}

export async function write(actor: Actor, fullPath: string, content: string, opts: WriteOpts = {}) {
  const p = parsePath(actor, fullPath)
  if (p.path === '/') throw invalid('Give a file path, not a drive root.')
  assertWritable(actor, p.driveId)
  const bytes = new TextEncoder().encode(content).length
  if (bytes > MAX_DOC_BYTES) {
    throw new AppError('too_large', `Docs are capped at 1 MB (this one is ${(bytes / 1e6).toFixed(1)} MB).`, {
      hint: 'Split it into several docs, or upload it as a file.',
    })
  }
  const db = getDb()
  const existing = await getLive(actor, p.driveId, p.path)
  const message = opts.message?.slice(0, 500) || null

  if (existing) {
    if (opts.createOnly) {
      throw new AppError('conflict', `${displayPath(actor, p.driveId, p.path)} already exists.`, {
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
            driveId: p.driveId,
            path: p.path,
            details: { version, message, ...opts.activityDetails },
          }),
        ),
      ])
    } catch (err) {
      const fresh = await getLive(actor, p.driveId, p.path)
      if (fresh && fresh.version !== existing.version) throw versionConflict(actor, fresh, existing.version)
      throw err
    }
    indexInBackground(updated)
    publishChange(actor, { driveId: p.driveId, path: p.path, action: opts.activityAction ?? 'edit' })
    return { node: nodeInfo(actor, updated), changed: true, created: false }
  }

  if (opts.baseVersion) {
    throw notFound(`"${fullPath}"`, 'It may have been moved or deleted. Omit baseVersion to create it.')
  }
  const parentId = await ensureFolder(actor, p.driveId, parentOf(p.path))
  const id = newId('n')
  const name = baseName(p.path)
  const row: NodeRow = {
    id,
    workspaceId: actor.workspaceId,
    driveId: p.driveId,
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
          driveId: p.driveId,
          path: p.path,
          details: { version: 1, message, ...opts.activityDetails },
        }),
      ),
    ])
  } catch (err) {
    if (await getLive(actor, p.driveId, p.path)) {
      throw new AppError('conflict', `${fullPath} was just created by someone else.`, {
        hint: 'Read it, then edit it.',
      })
    }
    throw err
  }
  indexInBackground(row)
  publishChange(actor, { driveId: p.driveId, path: p.path, action: opts.activityAction ?? 'create' })
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
  assertWritable(actor, n.driveId)
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

export async function mkdir(actor: Actor, fullPath: string) {
  const p = parsePath(actor, fullPath)
  assertWritable(actor, p.driveId)
  const existed = await getLive(actor, p.driveId, p.path)
  if (existed && existed.kind !== 'folder') throw invalid(`${fullPath} is a file.`)
  await ensureFolder(actor, p.driveId, p.path)
  const n = await getLive(actor, p.driveId, p.path)
  if (!existed && n) {
    await getDb().insert(activity).values(activityRow(actor, 'mkdir', { nodeId: n.id, driveId: p.driveId, path: p.path }))
    publishChange(actor, { driveId: p.driveId, path: p.path, action: 'mkdir' })
  }
  return { node: n ? nodeInfo(actor, n) : null, created: !existed }
}

export async function upload(
  actor: Actor,
  fullPath: string,
  data: ArrayBuffer,
  opts: { mimeType?: string; message?: string; description?: string; baseVersion?: number } = {},
) {
  const p = parsePath(actor, fullPath)
  if (p.path === '/') throw invalid('Give a file path, not a drive root.')
  assertWritable(actor, p.driveId)
  const name = baseName(p.path)
  const mime = opts.mimeType || mimeFor(name)
  if (isTextMime(mime) && data.byteLength <= MAX_DOC_BYTES && textMimeFor(name)) {
    return write(actor, fullPath, new TextDecoder().decode(data), opts)
  }
  if (data.byteLength > MAX_FILE_BYTES) throw new AppError('too_large', 'Files are capped at 95 MB.')
  const db = getDb()
  const env = getEnv()
  const existing = await getLive(actor, p.driveId, p.path)
  if (existing && existing.kind !== 'file') {
    throw invalid(`${fullPath} already exists as a ${existing.kind}.`, 'Upload to a different path.')
  }
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
  let row: NodeRow
  if (existing) {
    row = { ...existing, mimeType: mime, size: data.byteLength, r2Key, version, description, updatedBy: actor.userId, updatedAt: now }
  } else {
    const parentId = await ensureFolder(actor, p.driveId, parentOf(p.path))
    row = {
      id,
      workspaceId: actor.workspaceId,
      driveId: p.driveId,
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
          .set({ mimeType: mime, size: data.byteLength, r2Key, version, description, updatedBy: actor.userId, updatedAt: now })
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
        driveId: p.driveId,
        path: p.path,
        details: { version, size: data.byteLength, mimeType: mime },
      }),
    ),
  ])
  indexInBackground(row)
  publishChange(actor, { driveId: p.driveId, path: p.path, action: existing ? 'upload_version' : 'upload' })
  return { node: nodeInfo(actor, row), changed: true, created: !existing }
}

export async function describe(actor: Actor, fullPath: string, description: string) {
  const { node: n } = await requireNode(actor, fullPath)
  assertWritable(actor, n.driveId)
  const db = getDb()
  const updated = { ...n, description: description || null }
  await batch([
    db.update(node).set({ description: updated.description }).where(eq(node.id, n.id)),
    ...ftsStatements(updated),
    db.insert(activity).values(activityRow(actor, 'describe', { nodeId: n.id, driveId: n.driveId, path: n.path })),
  ])
  indexInBackground(updated)
  publishChange(actor, { driveId: n.driveId, path: n.path, action: 'describe' })
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
        eq(node.driveId, n.driveId),
        sql`${node.path} LIKE ${subtreeLike(n.path)} ESCAPE '\\'`,
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
  assertWritable(actor, src.driveId)
  const dest = parsePath(actor, to)
  assertWritable(actor, dest.driveId)
  if (src.driveId === TEAM && dest.driveId !== TEAM && !canDeleteInDrive(actor, TEAM)) {
    throw forbidden(
      'Moving a file out of the team drive removes it for everyone, which only admins can do.',
      'Use copy to put a copy in your private drive instead.',
    )
  }
  let destPath = dest.path
  const target = await getLive(actor, dest.driveId, destPath)
  if (to.endsWith('/') || dest.path === '/' || target?.kind === 'folder') {
    destPath = joinPath(dest.path, src.name)
  } else if (target) {
    throw new AppError('conflict', `${to} already exists.`, {
      hint: 'Pick another destination, or move it into a folder by ending the path with "/".',
    })
  }
  if (src.driveId === dest.driveId && src.path === destPath) return { node: nodeInfo(actor, src), changed: false }
  if (await getLive(actor, dest.driveId, destPath)) {
    throw new AppError('conflict', `${displayPath(actor, dest.driveId, destPath)} already exists.`)
  }
  if (src.kind === 'folder' && src.driveId === dest.driveId && destPath.startsWith(src.path + '/')) {
    throw invalid("You can't move a folder into itself.")
  }
  const parentId = await ensureFolder(actor, dest.driveId, parentOf(destPath))
  const nodes = await subtree(actor, src)
  if (nodes.length > 2000) throw invalid('That folder has too many items to move at once (max 2000).')
  const db = getDb()
  const newName = baseName(destPath)
  const now = new Date()
  const crossDrive = src.driveId !== dest.driveId
  const action = opts.action ?? (crossDrive && dest.driveId === TEAM ? 'promote' : 'move')
  await batch([
    db
      .update(node)
      .set({ driveId: dest.driveId, path: destPath, name: newName, parentId, updatedAt: now, updatedBy: actor.userId })
      .where(eq(node.id, src.id)),
    ...(src.kind === 'folder'
      ? [
          raw(
            `UPDATE node SET path = ? || substr(path, ?), drive_id = ?
             WHERE workspace_id = ? AND drive_id = ? AND path LIKE ? ESCAPE '\\' AND deleted_at IS NULL`,
            destPath,
            src.path.length + 1,
            dest.driveId,
            actor.workspaceId,
            src.driveId,
            subtreeLike(src.path),
          ),
        ]
      : []),
    db.insert(activity).values(
      activityRow(actor, action, {
        nodeId: src.id,
        driveId: dest.driveId,
        path: destPath,
        details: { from: displayPath(actor, src.driveId, src.path), to: displayPath(actor, dest.driveId, destPath) },
      }),
    ),
  ])
  const moved = nodes.map((n) => ({
    ...n,
    driveId: dest.driveId,
    path: n.id === src.id ? destPath : destPath + n.path.slice(src.path.length),
    name: n.id === src.id ? newName : n.name,
  }))
  await ftsReindex(moved)
  if (crossDrive) background(Promise.all(moved.filter((n) => n.kind !== 'folder').slice(0, 200).map((n) => vectorIndex(n))))
  const [fresh] = await db.select().from(node).where(eq(node.id, src.id))
  publishChange(actor, { driveId: dest.driveId, path: destPath, action })
  if (crossDrive) publishChange(actor, { driveId: src.driveId, path: src.path, action })
  return { node: nodeInfo(actor, fresh!), changed: true, movedCount: nodes.length }
}

export async function copy(actor: Actor, from: string, to: string) {
  const { node: src } = await requireNode(actor, from)
  const dest = parsePath(actor, to)
  assertWritable(actor, dest.driveId)
  let destPath = dest.path
  const target = await getLive(actor, dest.driveId, destPath)
  if (to.endsWith('/') || dest.path === '/' || target?.kind === 'folder') destPath = joinPath(dest.path, src.name)
  else if (target) throw new AppError('conflict', `${to} already exists.`)
  if (await getLive(actor, dest.driveId, destPath)) {
    throw new AppError('conflict', `${displayPath(actor, dest.driveId, destPath)} already exists.`)
  }
  const nodes = await subtree(actor, src)
  if (nodes.length > 500) throw invalid('That folder is too big to copy at once (max 500 items).')
  const srcLabel = displayPath(actor, src.driveId, src.path)
  const env = getEnv()
  for (const n of nodes) {
    const rel = n.id === src.id ? '' : n.path.slice(src.path.length)
    const target = displayPath(actor, dest.driveId, destPath + rel)
    if (n.kind === 'folder') await mkdir(actor, target)
    else if (n.kind === 'doc') {
      await write(actor, target, n.content ?? '', {
        message: `Copied from ${srcLabel}`,
        description: n.description ?? undefined,
        createOnly: true,
        activityAction: 'copy',
        activityDetails: { from: displayPath(actor, n.driveId, n.path) },
      })
    } else if (n.r2Key) {
      const obj = await env.FILES.get(n.r2Key)
      if (obj) {
        await upload(actor, target, await obj.arrayBuffer(), {
          mimeType: n.mimeType ?? undefined,
          message: `Copied from ${srcLabel}`,
          description: n.description ?? undefined,
        })
      }
    }
  }
  const created = await getLive(actor, dest.driveId, destPath)
  return { node: created ? nodeInfo(actor, created) : null, copiedCount: nodes.length }
}

export type PromoteResult = {
  node: NodeInfo | null
  promoted: true
  keptPrivateCopy: boolean
  /** Paths that became a new version of an existing team doc, with the version they replaced. */
  updated: { path: string; previousVersion: number; version: number }[]
  /** Paths that didn't exist in the team drive before. */
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
  if (src.driveId === TEAM) throw invalid(`${from} is already in the team drive.`)
  assertWritable(actor, TEAM)
  const dest = parsePath(actor, opts.to ?? `/team${src.path}`)
  if (dest.driveId !== TEAM) {
    throw invalid('Promote moves things into the team drive, so "to" must start with /team/.')
  }
  let destPath = dest.path
  let target = destPath === '/' ? undefined : await getLive(actor, TEAM, destPath)
  if (destPath === '/' || (target?.kind === 'folder' && src.kind !== 'folder') || (opts.to ?? '').endsWith('/')) {
    destPath = joinPath(destPath, src.name)
    target = await getLive(actor, TEAM, destPath)
  }
  const result: PromoteResult = { node: null, promoted: true, keptPrivateCopy: !!opts.keepCopy, updated: [], created: [] }
  const srcLabel = displayPath(actor, src.driveId, src.path)

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
    const existing = await getLive(actor, TEAM, teamPath)
    const full = displayPath(actor, TEAM, teamPath)
    if (existing && existing.kind !== n.kind) {
      throw new AppError('conflict', `${full} is a ${existing.kind}, so ${displayPath(actor, n.driveId, n.path)} can't replace it.`)
    }
    if (n.kind === 'doc') {
      const r = await write(actor, full, n.content ?? '', {
        message,
        baseVersion: existing ? (baseVersion ?? existing.version) : undefined,
        description: n.description ?? undefined,
        activityAction: 'promote',
        activityDetails: { from: displayPath(actor, n.driveId, n.path) },
      })
      if (existing && r.changed) result.updated.push({ path: full, previousVersion: existing.version, version: r.node.version })
      else if (!existing) result.created.push(full)
      return r.node
    }
    const obj = n.r2Key ? await env.FILES.get(n.r2Key) : null
    if (!obj) throw notFound(`Stored file for ${displayPath(actor, n.driveId, n.path)}`)
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

export async function trash(actor: Actor, fullPath: string) {
  const { node: n } = await requireNode(actor, fullPath)
  if (!canDeleteInDrive(actor, n.driveId)) {
    throw forbidden(
      n.driveId === TEAM
        ? 'Only admins can delete files from the team drive.'
        : 'Your role is read-only, so you cannot delete files.',
      n.driveId === TEAM ? 'Ask an admin to delete it, or move it into an /team/archive folder instead.' : undefined,
    )
  }
  const nodes = await subtree(actor, n)
  const now = new Date()
  const db = getDb()
  const ids = nodes.map((x) => x.id)
  const stmts = []
  for (let i = 0; i < ids.length; i += 90) {
    stmts.push(db.update(node).set({ deletedAt: now, deletedBy: actor.userId }).where(inArray(node.id, ids.slice(i, i + 90))))
  }
  await batch([
    ...stmts,
    db.insert(activity).values(
      activityRow(actor, 'delete', { nodeId: n.id, driveId: n.driveId, path: n.path, details: { items: nodes.length } }),
    ),
  ])
  await ftsDelete(ids)
  background(vectorDelete(nodes))
  publishChange(actor, { driveId: n.driveId, path: n.path, action: 'delete' })
  return { deleted: displayPath(actor, n.driveId, n.path), items: nodes.length, trashId: n.id }
}

export async function listTrash(actor: Actor) {
  const drives = [TEAM, actor.userId]
  const rows = await getDb()
    .select({ n: node, deletedByName: user.name })
    .from(node)
    .leftJoin(user, eq(user.id, node.deletedBy))
    .where(and(eq(node.workspaceId, actor.workspaceId), inArray(node.driveId, drives), isNotNull(node.deletedAt)))
    .orderBy(desc(node.deletedAt))
    .limit(1000)
  const byId = new Map(rows.map((r) => [r.n.id, r.n]))
  return rows
    .filter((r) => {
      const parent = r.n.parentId ? byId.get(r.n.parentId) : undefined
      return !parent || parent.deletedAt?.getTime() !== r.n.deletedAt?.getTime()
    })
    .slice(0, 200)
    .map((r) => ({
      ...nodeInfo(actor, r.n),
      deletedAt: r.n.deletedAt!.getTime(),
      deletedBy: r.deletedByName ?? r.n.deletedBy,
      canRestore: canWriteDrive(actor, r.n.driveId),
      canPurge: canDeleteInDrive(actor, r.n.driveId),
    }))
}

export async function restoreFromTrash(actor: Actor, id: string, opts: { to?: string } = {}) {
  const n = await getNodeById(actor, id, { includeDeleted: true })
  if (!n.deletedAt) throw invalid('That item is not in the trash.')
  assertWritable(actor, n.driveId)
  let driveId = n.driveId
  let path = n.path
  if (opts.to) {
    const p = parsePath(actor, opts.to)
    if (p.driveId !== n.driveId) throw invalid('Restore into the same drive, then move it.')
    path = p.path
  }
  if (await getLive(actor, driveId, path)) {
    throw new AppError('conflict', `Something already exists at ${displayPath(actor, driveId, path)}.`, {
      hint: 'Pass "to" with a different path to restore it there.',
    })
  }
  const nodes = await subtree(actor, n, { deletedAt: n.deletedAt })
  const parentId = await ensureFolder(actor, driveId, parentOf(path))
  const db = getDb()
  const ids = nodes.map((x) => x.id)
  const stmts = []
  for (let i = 0; i < ids.length; i += 90) {
    stmts.push(db.update(node).set({ deletedAt: null, deletedBy: null }).where(inArray(node.id, ids.slice(i, i + 90))))
  }
  await batch([
    ...stmts,
    db.update(node).set({ parentId, path, name: baseName(path) }).where(eq(node.id, n.id)),
    ...(path !== n.path && n.kind === 'folder'
      ? [
          ...ids
            .filter((x) => x !== n.id)
            .map((x) => raw('UPDATE node SET path = ? || substr(path, ?) WHERE id = ?', path, n.path.length + 1, x)),
        ]
      : []),
    db.insert(activity).values(activityRow(actor, 'restore', { nodeId: n.id, driveId, path })),
  ])
  const all: NodeRow[] = []
  for (let i = 0; i < ids.length; i += 90) {
    all.push(...(await db.select().from(node).where(inArray(node.id, ids.slice(i, i + 90)))))
  }
  await ftsReindex(all)
  background(Promise.all(all.filter((x) => x.kind !== 'folder').slice(0, 200).map((x) => vectorIndex(x))))
  publishChange(actor, { driveId, path, action: 'restore' })
  return { restored: displayPath(actor, driveId, path), items: nodes.length }
}

export async function purge(actor: Actor, id: string) {
  const n = await getNodeById(actor, id, { includeDeleted: true })
  if (!n.deletedAt) throw invalid('Only items in the trash can be permanently deleted. Delete it first.')
  if (!canDeleteInDrive(actor, n.driveId)) throw forbidden('Only admins can permanently delete team files.')
  const nodes = await subtree(actor, n, { deletedAt: n.deletedAt })
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
  await db.insert(activity).values(
    activityRow(actor, 'purge', { driveId: n.driveId, path: n.path, details: { items: nodes.length } }),
  )
  publishChange(actor, { driveId: n.driveId, path: n.path, action: 'purge' })
  return { purged: displayPath(actor, n.driveId, n.path), items: nodes.length }
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
  const label = displayPath(actor, n.driveId, n.path)
  return {
    path: label,
    from,
    to: toV,
    patch: createTwoFilesPatch(`${label}@v${from}`, `${label}@v${toV}`, a.content, b.content, '', '', { context: 3 }),
  }
}

export async function restoreVersion(actor: Actor, fullPath: string, version: number, opts: { message?: string } = {}) {
  const { node: n } = await requireNode(actor, fullPath)
  assertWritable(actor, n.driveId)
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

export async function recent(actor: Actor, opts: { limit?: number; drive?: 'team' | 'me' | 'all' } = {}) {
  const drives = opts.drive === 'team' ? [TEAM] : opts.drive === 'me' ? [actor.userId] : [TEAM, actor.userId]
  const rows = await getDb()
    .select({ n: node, updatedByName: user.name })
    .from(node)
    .leftJoin(user, eq(user.id, node.updatedBy))
    .where(
      and(
        eq(node.workspaceId, actor.workspaceId),
        inArray(node.driveId, drives),
        isNull(node.deletedAt),
        or(eq(node.kind, 'doc'), eq(node.kind, 'file')),
      ),
    )
    .orderBy(desc(node.updatedAt))
    .limit(Math.min(opts.limit ?? 20, 100))
  return rows.map((r) => ({ ...nodeInfo(actor, r.n), updatedByName: r.updatedByName }))
}

export async function findByName(actor: Actor, driveId: string, pattern: string) {
  return getDb()
    .select()
    .from(node)
    .where(
      and(
        eq(node.workspaceId, actor.workspaceId),
        eq(node.driveId, driveId),
        isNull(node.deletedAt),
        like(node.path, pattern),
      ),
    )
    .orderBy(asc(node.path))
    .limit(500)
}

export async function driveStats(actor: Actor) {
  const rows = await getDb()
    .select({ driveId: node.driveId, kind: node.kind, count: sql<number>`count(*)`, bytes: sql<number>`sum(size)` })
    .from(node)
    .where(and(eq(node.workspaceId, actor.workspaceId), inArray(node.driveId, [TEAM, actor.userId]), isNull(node.deletedAt)))
    .groupBy(node.driveId, node.kind)
  const out = { team: { docs: 0, files: 0, folders: 0, bytes: 0 }, me: { docs: 0, files: 0, folders: 0, bytes: 0 } }
  for (const r of rows) {
    const d = r.driveId === TEAM ? out.team : out.me
    if (r.kind === 'doc') d.docs = r.count
    else if (r.kind === 'file') d.files = r.count
    else d.folders = r.count
    d.bytes += r.bytes ?? 0
  }
  return out
}
