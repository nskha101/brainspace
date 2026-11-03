import { and, desc, eq, inArray, like, lt, or, sql } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM } from '../actor'
import { newId } from '../crypto'
import { activity, getDb, user, type Json } from '../db'
import { displayPath } from '../paths'
import { publishChange, type LiveEvent } from '../live'

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

const LIVE_SCOPES: Record<string, LiveEvent['scope']> = {
  invite: 'members',
  invite_revoke: 'members',
  member_join: 'members',
  member_leave: 'members',
  member_remove: 'members',
  role_change: 'members',
  auto_join_on: 'members',
  auto_join_off: 'members',
  connection_add: 'connections',
  connection_update: 'connections',
  connection_remove: 'connections',
  workspace_rename: 'workspace',
}

export async function logActivity(...args: Parameters<typeof activityRow>) {
  const row = activityRow(...args)
  await getDb().insert(activity).values(row)
  const scope = LIVE_SCOPES[row.action]
  if (scope) publishChange(args[0], { scope, action: row.action })
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
