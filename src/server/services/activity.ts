import { and, desc, eq, inArray, like, lt, or, sql } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM } from '../actor'
import { newId } from '../crypto'
import { activity, getDb, user, type Json } from '../db'
import { displayPath } from '../paths'
import { publishChange, type LiveEvent } from '../live'
import { accessView, admitsStamp, canSee, hiddenNodeIds, narrowAudience } from './access'

export function activityRow(
  actor: Actor,
  action: string,
  target?: {
    nodeId?: string
    spaceId?: string
    path?: string
    details?: Record<string, unknown>
    /** Only these people may see the row (restricted things). */
    audience?: string[] | null
  },
) {
  return {
    id: newId('act'),
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    via: actor.via,
    clientName: actor.clientName ?? null,
    action,
    nodeId: target?.nodeId ?? null,
    spaceId: target?.spaceId ?? null,
    path: target?.path ?? null,
    details: (target?.details ?? null) as Record<string, Json> | null,
    audience: narrowAudience(actor.activityAudience, target?.audience),
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
    // Never leak other people's private-space activity.
    or(
      sql`${activity.spaceId} is null`,
      eq(activity.spaceId, TEAM),
      eq(activity.spaceId, actor.userId),
    ),
  ]
  if (opts.actions?.length) conds.push(inArray(activity.action, opts.actions))
  if (opts.pathPrefix) {
    const alias = opts.pathPrefix.startsWith('/me') ? actor.userId : TEAM
    const inner = opts.pathPrefix.replace(/^\/(team|me)/, '') || '/'
    conds.push(eq(activity.spaceId, alias))
    if (inner !== '/') conds.push(like(activity.path, `${inner}%`))
  }
  // Hide what happened inside restricted folders from people who can't see them,
  // matching by stamp, by node (rows keep old paths after moves) and by current path.
  const [view, hidden] = await Promise.all([accessView(actor), hiddenNodeIds(actor)])
  const allowed = (r: { audience: string[] | null; nodeId: string | null; spaceId: string | null; path: string | null }) =>
    admitsStamp(view, r.audience) && !(r.nodeId && hidden.has(r.nodeId)) && !(r.spaceId && r.path && !canSee(view, r.spaceId, r.path))
  // Hidden rows can crowd a page, so keep reading older pages until it's full (a few at most).
  const visible = []
  const pageSize = Math.max(limit * 2, 200)
  let before = opts.before
  for (let page = 0; page < 5 && visible.length < limit; page++) {
    const rows = await db
      .select({
        id: activity.id,
        action: activity.action,
        via: activity.via,
        clientName: activity.clientName,
        nodeId: activity.nodeId,
        spaceId: activity.spaceId,
        path: activity.path,
        details: activity.details,
        audience: activity.audience,
        createdAt: activity.createdAt,
        actorId: activity.actorId,
        actorName: user.name,
        actorEmail: user.email,
        actorImage: user.image,
      })
      .from(activity)
      .leftJoin(user, eq(user.id, activity.actorId))
      .where(and(...conds, ...(before ? [lt(activity.createdAt, new Date(before))] : [])))
      .orderBy(desc(activity.createdAt))
      .limit(pageSize)
    visible.push(...rows.filter(allowed))
    if (rows.length < pageSize) break
    before = rows[rows.length - 1]!.createdAt.getTime()
  }
  return visible.slice(0, limit).map(({ audience: _audience, ...r }) => ({
    ...r,
    createdAt: r.createdAt.getTime(),
    fullPath: r.spaceId && r.path ? displayPath(actor, r.spaceId, r.path) : null,
  }))
}
