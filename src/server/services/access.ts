import { and, eq, isNotNull, isNull, or } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM, requireRole } from '../actor'
import { getDb, member, node, user, type Role } from '../db'
import { forbidden, invalid } from '../errors'
import { displayPath, inSubtree } from '../paths'

/**
 * Restricted access in the team space. A folder or file with `accessUsers` set
 * is visible only to those people, and so is everything under it. Nested
 * restrictions stack: you need to be on every list above a file to see it.
 *
 * Admins are not exempt. "Only Nith and Farris" means exactly that. The one
 * exception: if nobody on a list is still in the workspace, admins get in, so a
 * folder can never be locked away for good.
 *
 * Live files are checked by path against the live restricted folders. Things in
 * the trash carry a stamp of who could see them when they were deleted
 * (`node.trashAccess`, `activity.audience`), so renaming or purging the folder
 * above them later can't expose them.
 */

export type Person = { userId: string; name: string; email: string; role?: Role }

export type Restriction = {
  nodeId: string
  path: string
  userIds: string[]
  people: Person[]
}

export type AccessView = {
  /** Every live restriction in the workspace's team space. */
  all: Restriction[]
  /** The ones that keep this actor out. */
  blocked: Restriction[]
  members: Map<string, Person>
  actor: Actor
}

export const under = (path: string, root: string) => path === root || path.startsWith(root + '/')

async function load(workspaceId: string) {
  const db = getDb()
  const [rows, memberRows] = await Promise.all([
    db
      .select({ id: node.id, path: node.path, accessUsers: node.accessUsers })
      .from(node)
      .where(and(eq(node.workspaceId, workspaceId), eq(node.spaceId, TEAM), isNotNull(node.accessUsers), isNull(node.deletedAt))),
    db
      .select({ userId: member.userId, name: user.name, email: user.email, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.workspaceId, workspaceId)),
  ])
  const members = new Map<string, Person>(memberRows.map((m) => [m.userId, m]))
  const all = rows.map((r) => {
    const userIds = r.accessUsers ?? []
    return {
      nodeId: r.id,
      path: r.path,
      userIds,
      people: userIds.map((id) => members.get(id)).filter((m): m is Person => !!m),
    }
  })
  return { all, members }
}

/** Whether a list of user ids lets the actor in, with the admin fallback for orphaned lists. */
function admitsIds(actor: Actor, ids: string[], members: Map<string, Person>) {
  if (ids.includes(actor.userId)) return true
  // An empty list means nobody (lists that don't overlap). Only a list whose
  // people have all left falls back to the admins.
  return ids.length > 0 && actor.role === 'admin' && !ids.some((id) => members.has(id))
}

// One lookup per actor per request. Actors are built fresh for every request.
const cache = new WeakMap<Actor, Promise<AccessView>>()

export function accessView(actor: Actor): Promise<AccessView> {
  let v = cache.get(actor)
  if (!v) {
    v = load(actor.workspaceId).then(({ all, members }) => ({
      all,
      members,
      actor,
      blocked: all.filter((r) => !admitsIds(actor, r.userIds, members)),
    }))
    cache.set(actor, v)
  }
  return v
}

export function forgetAccess(actor: Actor) {
  cache.delete(actor)
}

/** The restriction that keeps the actor away from a live path, if any. */
export function blockerFor(view: AccessView, spaceId: string, path: string) {
  if (spaceId !== TEAM || path === '/') return undefined
  return view.blocked.find((r) => under(path, r.path))
}

export function canSee(view: AccessView, spaceId: string, path: string) {
  return !blockerFor(view, spaceId, path)
}

/** Whether a stamped list (trash, activity) lets the actor in. Null means everyone. */
export function admitsStamp(view: AccessView, ids: string[] | null | undefined) {
  return !ids || admitsIds(view.actor, ids, view.members)
}

/**
 * For items in the trash: the stamp from when it was deleted, plus any live
 * restricted folder that now covers its old path.
 */
export function canSeeTrashed(view: AccessView, n: { spaceId: string; path: string; trashAccess?: string[] | null }) {
  if (n.spaceId !== TEAM) return true
  return admitsStamp(view, n.trashAccess) && canSee(view, n.spaceId, n.path)
}

/**
 * Everyone who can see a live team path right now, as concrete user ids: on
 * every list that applies, where a list nobody on is still a member stands for
 * the admins. Null means everyone. Used for stamps and copies, so it must not
 * widen anything when lists are combined.
 */
export function effectiveAudience(view: Pick<AccessView, 'all' | 'members'>, path: string): string[] | null {
  const applying = view.all.filter((r) => under(path, r.path))
  if (!applying.length) return null
  let ids: string[] | null = null
  for (const r of applying) {
    const allowed = resolveList(view, r.userIds)
    ids = ids === null ? allowed : ids.filter((id) => allowed.includes(id))
  }
  return ids
}

/**
 * A list as the people it lets in now: its current members, or the admins when
 * everyone on it has left. An empty list stays empty (nobody).
 */
export function resolveList(view: Pick<AccessView, 'members'>, ids: string[]): string[] {
  if (!ids.length) return []
  const present = ids.filter((id) => view.members.has(id))
  if (present.length) return present
  return [...view.members.values()].filter((m) => m.role === 'admin').map((m) => m.userId)
}

/** Combine two audiences: you need to be in both. Null means everyone. */
export function narrowAudience(a: string[] | null | undefined, b: string[] | null | undefined): string[] | null {
  if (!a) return b ?? null
  if (!b) return a
  return a.filter((id) => b.includes(id))
}

export const sameAudience = (a: string[] | null | undefined, b: string[] | null | undefined) =>
  (!a && !b) || (!!a && !!b && a.length === b.length && a.every((id) => b.includes(id)))

function names(people: { name: string; email: string }[]) {
  const list = people.map((p) => p.name || p.email)
  if (list.length <= 1) return list[0] ?? 'nobody'
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

export function restrictedError(actor: Actor, r: Restriction) {
  const where = displayPath(actor, TEAM, r.path)
  if (!r.people.length) {
    return forbidden(
      `${where} is restricted, and everyone on its list has left the workspace. Only admins can open it now.`,
      'Ask an admin to open it up or add you.',
    )
  }
  return forbidden(
    `${where} is restricted. Only ${names(r.people)} can open it.`,
    'Ask one of them to add you, or work somewhere else in /team.',
  )
}

export async function assertCanSee(actor: Actor, spaceId: string, path: string) {
  if (spaceId !== TEAM || path === '/') return
  const blocker = blockerFor(await accessView(actor), spaceId, path)
  if (blocker) throw restrictedError(actor, blocker)
}

/**
 * Folder operations act on everything inside. Refuse when that includes things
 * the actor can't see, so nobody can copy, trash or move what's hidden from them.
 */
export async function assertSeesAll(
  actor: Actor,
  nodes: { spaceId: string; path: string; deletedAt: Date | null; trashAccess?: string[] | null }[],
  doing: string,
  label: string,
) {
  const view = await accessView(actor)
  const hidden = nodes.some((n) => (n.deletedAt ? !canSeeTrashed(view, n) : !canSee(view, n.spaceId, n.path)))
  if (hidden) {
    throw forbidden(
      `${label} contains restricted items you can't see, so you can't ${doing}.`,
      'Ask someone who can see everything inside it to do this.',
    )
  }
}

/** Which restrictions apply at a live team path, nearest first. */
export function restrictionsAt(view: AccessView, path: string) {
  return view.all.filter((r) => under(path, r.path)).sort((a, b) => b.path.length - a.path.length)
}

/**
 * Ids of every live node the actor can't see. Used to filter the activity log,
 * where rows keep the path they had at the time.
 */
export async function hiddenNodeIds(actor: Actor): Promise<Set<string>> {
  const view = await accessView(actor)
  if (!view.blocked.length) return new Set()
  const roots = [...new Set(view.blocked.map((r) => r.path))]
  const out = new Set<string>(view.blocked.map((r) => r.nodeId))
  // D1 allows 100 bound parameters per query: 3 per root, plus 3.
  for (let i = 0; i < roots.length; i += 30) {
    const slice = roots.slice(i, i + 30)
    const rows = await getDb()
      .select({ id: node.id })
      .from(node)
      .where(
        and(
          eq(node.workspaceId, actor.workspaceId),
          eq(node.spaceId, TEAM),
          isNull(node.deletedAt),
          or(...slice.flatMap((p) => [eq(node.path, p), inSubtree(node.path, p)])),
        ),
      )
    rows.forEach((r) => out.add(r.id))
  }
  return out
}

/** Who should hear about a change at this path. Null means everyone. */
export async function audienceFor(workspaceId: string, spaceId: string | null, path: string | null) {
  if (spaceId !== TEAM || !path || path === '/') return null
  return effectiveAudience(await load(workspaceId), path)
}

export type AccessInfo = {
  path: string
  /** Restricted here or by a folder above. */
  restricted: boolean
  /** The path of the restriction that sets who can see this (the nearest one). */
  restrictedAt: string | null
  inherited: boolean
  /** Everyone who can see it: on every list that applies. */
  people: Person[]
  canManage: boolean
}

export async function accessInfo(actor: Actor, spaceId: string, path: string): Promise<AccessInfo | null> {
  if (spaceId !== TEAM) return null
  const view = await accessView(actor)
  const applying = restrictionsAt(view, path)
  let people = applying[0]?.people ?? []
  for (const r of applying.slice(1)) people = people.filter((p) => r.userIds.includes(p.userId))
  const nearest = applying[0]
  return {
    path: displayPath(actor, TEAM, path),
    restricted: applying.length > 0,
    restrictedAt: nearest ? displayPath(actor, TEAM, nearest.path) : null,
    inherited: !!nearest && nearest.path !== path,
    people,
    canManage: actor.role !== 'viewer' && path !== '/',
  }
}

/** Validate a list of people (user ids, emails or unambiguous names) against the workspace. */
export async function resolvePeople(actor: Actor, who: string[]) {
  const { members } = await accessView(actor)
  const rows = [...members.values()]
  const ids = new Set<string>()
  for (const w of who) {
    const key = w.trim().toLowerCase()
    if (!key) continue
    let m = rows.find((r) => r.userId === w.trim() || r.email.toLowerCase() === key)
    if (!m) {
      const byName = rows.filter((r) => r.name.toLowerCase() === key || r.name.toLowerCase().split(/\s+/)[0] === key)
      if (byName.length > 1) throw invalid(`"${w}" matches more than one member.`, 'Use their email address instead.')
      m = byName[0]
    }
    if (!m) throw invalid(`"${w}" isn't in this workspace.`, 'Use members_list to see who is in the workspace, and pass their email.')
    ids.add(m.userId)
  }
  return { ids: [...ids], members }
}

/**
 * Anyone who can edit (members and admins) can restrict what they can see, and
 * anyone on a list can change it. Read-only members can't change access.
 */
export function requireAccessEditor(actor: Actor) {
  requireRole(actor, 'member', 'change who can see team files')
}

