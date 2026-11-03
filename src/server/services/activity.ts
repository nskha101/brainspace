import { and, desc, eq, inArray, like, lt, or, sql } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM } from '../actor'
import { newId } from '../crypto'
import { activity, getDb, user, type Json } from '../db'
import { displayPath } from '../paths'

export function activityRow(
  actor: Actor,
  action: string,
  target?: { nodeId?: string; driveId?: string; path?: string; details?: Record<string, unknown> },
) {
  return {
    id: newId('act'),
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    via: actor.via,
    clientName: actor.clientName ?? null,
    action,
    nodeId: target?.nodeId ?? null,
    driveId: target?.driveId ?? null,
    path: target?.path ?? null,
    details: (target?.details ?? null) as Record<string, Json> | null,
  }
}

export async function logActivity(...args: Parameters<typeof activityRow>) {
  await getDb().insert(activity).values(activityRow(...args))
}

export async function listActivity(
  actor: Actor,
  opts: { limit?: number; before?: number; pathPrefix?: string; actions?: string[] } = {},
) {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 50, 200)
  const conds = [
    eq(activity.workspaceId, actor.workspaceId),
    // Never leak other people's private-drive activity.
    or(
      sql`${activity.driveId} is null`,
      eq(activity.driveId, TEAM),
      eq(activity.driveId, actor.userId),
    ),
  ]
  if (opts.before) conds.push(lt(activity.createdAt, new Date(opts.before)))
  if (opts.actions?.length) conds.push(inArray(activity.action, opts.actions))
  if (opts.pathPrefix) {
    const alias = opts.pathPrefix.startsWith('/me') ? actor.userId : TEAM
    const inner = opts.pathPrefix.replace(/^\/(team|me)/, '') || '/'
    conds.push(eq(activity.driveId, alias))
    if (inner !== '/') conds.push(like(activity.path, `${inner}%`))
  }
  const rows = await db
    .select({
      id: activity.id,
      action: activity.action,
      via: activity.via,
      clientName: activity.clientName,
      nodeId: activity.nodeId,
      driveId: activity.driveId,
      path: activity.path,
      details: activity.details,
      createdAt: activity.createdAt,
      actorId: activity.actorId,
      actorName: user.name,
      actorEmail: user.email,
      actorImage: user.image,
    })
    .from(activity)
    .leftJoin(user, eq(user.id, activity.actorId))
    .where(and(...conds))
    .orderBy(desc(activity.createdAt))
    .limit(limit)
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.getTime(),
    fullPath: r.driveId && r.path ? displayPath(actor, r.driveId, r.path) : null,
  }))
}
