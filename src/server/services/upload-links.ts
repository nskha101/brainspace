import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import type { Actor } from '../actor'
import { canWriteSpace } from '../actor'
import { randomToken, newId, sha256Hex } from '../crypto'
import { getDb, uploadLink, user, workspace } from '../db'
import { appUrl } from '../env'
import { AppError, forbidden, invalid, notFound } from '../errors'
import { baseName, displayPath, joinPath, parsePath, validateName } from '../paths'
import { resolve, upload, MAX_FILE_BYTES } from './files'
import { actorFor } from './workspaces'
import { logActivity } from './activity'

const DEFAULT_MINUTES = 60
const MAX_MINUTES = 60 * 24 * 7

type LinkRow = typeof uploadLink.$inferSelect

function shape(actor: Pick<Actor, 'userId'>, l: LinkRow) {
  return {
    id: l.id,
    target: displayPath(actor, l.spaceId, l.path),
    mode: l.mode,
    maxFiles: l.maxFiles,
    uploadedCount: l.uses,
    uploaded: l.uploaded ?? [],
    expiresAt: l.expiresAt.getTime(),
    expired: l.expiresAt.getTime() < Date.now(),
    revoked: !!l.revokedAt,
    note: l.note,
  }
}

export async function createUploadLink(
  actor: Actor,
  opts: {
    path: string
    expiresInMinutes?: number
    maxFiles?: number
    message?: string
    description?: string
    note?: string
  },
) {
  const p = parsePath(actor, opts.path)
  if (!canWriteSpace(actor, p.spaceId)) {
    throw forbidden('Your role cannot add files there, so you cannot make an upload link for it.')
  }
  const r = await resolve(actor, opts.path)
  // A trailing slash, a space root or an existing folder means "drop files into this folder".
  const mode: 'folder' | 'file' = opts.path.trim().endsWith('/') || r.isRoot || r.node?.kind === 'folder' ? 'folder' : 'file'
  if (mode === 'file' && r.node && r.node.kind !== 'file' && r.node.kind !== 'doc') throw invalid(`${opts.path} is not a file.`)
  const minutes = Math.min(Math.max(opts.expiresInMinutes ?? DEFAULT_MINUTES, 5), MAX_MINUTES)
  const maxFiles = Math.min(Math.max(opts.maxFiles ?? (mode === 'file' ? 5 : 100), 1), 1000)
  const token = randomToken(24)
  const id = newId('ul')
  const expiresAt = new Date(Date.now() + minutes * 60_000)
  await getDb().insert(uploadLink).values({
    id,
    workspaceId: actor.workspaceId,
    createdBy: actor.userId,
    tokenHash: await sha256Hex(token),
    spaceId: p.spaceId,
    path: p.path,
    mode,
    maxFiles,
    message: opts.message?.slice(0, 300) ?? null,
    description: opts.description?.slice(0, 300) ?? null,
    note: opts.note?.slice(0, 500) ?? null,
    clientName: actor.clientName ?? null,
    expiresAt,
  })
  await logActivity(actor, 'upload_link_create', { spaceId: p.spaceId, path: p.path, details: { mode, minutes, maxFiles } })
  const url = `${appUrl()}/u/${token}`
  const putUrl = `${appUrl()}/api/u/${token}`
  const target = displayPath(actor, p.spaceId, p.path)
  return {
    id,
    target,
    mode,
    url,
    expiresAt: expiresAt.getTime(),
    maxFiles,
    forPeople: `Send this link. It opens a page where they can drop files${mode === 'folder' ? ' or folders' : ''} into ${target}. No sign-in needed.`,
    forAgents:
      mode === 'folder'
        ? `curl -fsS -T ./report.pdf "${putUrl}?name=report.pdf"`
        : `curl -fsS -T ./${baseName(p.path)} "${putUrl}"`,
    next: 'Check what has arrived with upload_link_status, then read or describe the new files.',
  }
}

export async function uploadLinkStatus(actor: Actor, id: string) {
  const [l] = await getDb()
    .select()
    .from(uploadLink)
    .where(and(eq(uploadLink.id, id), eq(uploadLink.workspaceId, actor.workspaceId)))
  if (!l || (l.createdBy !== actor.userId && actor.role !== 'admin')) throw notFound('Upload link')
  return shape(actor, l)
}

export async function revokeUploadLink(actor: Actor, id: string) {
  const [l] = await getDb()
    .select()
    .from(uploadLink)
    .where(and(eq(uploadLink.id, id), eq(uploadLink.workspaceId, actor.workspaceId)))
  if (!l || (l.createdBy !== actor.userId && actor.role !== 'admin')) throw notFound('Upload link')
  await getDb().update(uploadLink).set({ revokedAt: new Date() }).where(eq(uploadLink.id, id))
  return { revoked: id }
}

export async function listUploadLinks(actor: Actor) {
  const rows = await getDb()
    .select()
    .from(uploadLink)
    .where(
      and(
        eq(uploadLink.workspaceId, actor.workspaceId),
        eq(uploadLink.createdBy, actor.userId),
        isNull(uploadLink.revokedAt),
        gt(uploadLink.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(uploadLink.createdAt))
    .limit(50)
  return rows.map((l) => shape(actor, l))
}

async function findByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return undefined
  const [row] = await getDb()
    .select({ l: uploadLink, creatorName: user.name, creatorEmail: user.email, creatorId: user.id, workspaceName: workspace.name })
    .from(uploadLink)
    .innerJoin(user, eq(user.id, uploadLink.createdBy))
    .innerJoin(workspace, eq(workspace.id, uploadLink.workspaceId))
    .where(eq(uploadLink.tokenHash, await sha256Hex(token)))
  return row
}

/** Public info for the upload page. Never exposes the personal space owner's other files. */
export async function uploadLinkInfo(token: string) {
  const row = await findByToken(token)
  if (!row) return { valid: false as const, reason: 'This upload link does not exist.' }
  const { l } = row
  const reason = l.revokedAt
    ? 'This upload link was turned off.'
    : l.expiresAt < new Date()
      ? 'This upload link has expired.'
      : l.uses >= l.maxFiles
        ? 'This upload link has already been used for as many files as it allows.'
        : null
  return {
    valid: !reason,
    reason,
    workspaceName: row.workspaceName,
    requestedBy: row.creatorName || row.creatorEmail,
    target: l.spaceId === 'team' ? `/team${l.path === '/' ? '' : l.path}` : `${row.creatorName || 'their'}'s personal space: ${l.path}`,
    mode: l.mode,
    remaining: Math.max(0, l.maxFiles - l.uses),
    expiresAt: l.expiresAt.getTime(),
    note: l.note,
  }
}

/** Store one file sent to an upload link. `relPath` is the file's path relative to what was dropped. */
export async function receiveUpload(token: string, file: { data: ArrayBuffer; relPath: string; mimeType?: string }) {
  const row = await findByToken(token)
  if (!row) throw notFound('Upload link')
  const { l } = row
  if (file.data.byteLength > MAX_FILE_BYTES) throw new AppError('too_large', 'Files are capped at 95 MB.')
  // Claim a slot atomically so parallel uploads can't exceed the limit.
  const claimed = await getDb()
    .update(uploadLink)
    .set({ uses: sql`${uploadLink.uses} + 1` })
    .where(
      and(
        eq(uploadLink.id, l.id),
        isNull(uploadLink.revokedAt),
        gt(uploadLink.expiresAt, new Date()),
        lt(uploadLink.uses, uploadLink.maxFiles),
      ),
    )
    .returning({ uses: uploadLink.uses })
  if (!claimed.length) throw new AppError('forbidden', 'This upload link has expired or is used up.', { hint: 'Ask for a new link.' })

  // Upload as the person who made the link, with their current role.
  const actor = await actorFor(
    { id: row.creatorId, name: row.creatorName, email: row.creatorEmail },
    l.workspaceId,
    'mcp',
    l.clientName ? `upload link from ${l.clientName}` : 'upload link',
  ).catch(() => {
    throw forbidden('The person who made this link is no longer in the workspace.')
  })
  let innerPath: string
  if (l.mode === 'file') {
    innerPath = l.path
  } else {
    const parts = file.relPath.split('/').filter(Boolean)
    if (!parts.length) throw invalid('Missing file name.')
    for (const part of parts) validateName(part)
    innerPath = parts.reduce((dir, part) => joinPath(dir, part), l.path)
  }
  const full = displayPath(actor, l.spaceId, innerPath)
  const res = await upload(actor, full, file.data, {
    mimeType: file.mimeType,
    message: l.message ?? `Uploaded with a link${l.clientName ? ` from ${l.clientName}` : ''}`,
    description: l.mode === 'file' ? (l.description ?? undefined) : undefined,
  })
  await getDb()
    .update(uploadLink)
    .set({ uploaded: sql`json_insert(coalesce(${uploadLink.uploaded}, '[]'), '$[#]', ${full})` })
    .where(eq(uploadLink.id, l.id))
  return { path: res.node.path, version: res.node.version, size: res.node.size, mimeType: res.node.mimeType }
}

