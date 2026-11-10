import type { Role } from './db'
import { forbidden } from './errors'

/** Who is doing something, in which workspace, and through what surface. */
export type Actor = {
  userId: string
  userName: string
  email: string
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  role: Role
  via: 'web' | 'mcp' | 'flow'
  clientName?: string
  /**
   * Set when acting for a flow inside a restricted folder: who may see the
   * activity it causes (approvals, connection calls). Null or unset means
   * the activity's own path decides.
   */
  activityAudience?: string[] | null
}

export const TEAM = 'team'

export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 }

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  member: 'Member',
  viewer: 'Read-only',
}

export const ROLE_SUMMARY: Record<Role, string> = {
  admin: 'Full control: everything a member can do, plus deleting team files, managing members and roles, and removing connections.',
  member: 'Can read and edit everything, promote private docs to the team space, add connections and invite people. Cannot delete team files, change roles or remove members.',
  viewer: 'Can read the team space and use read-only connection tools. Cannot change anything.',
}

export function atLeast(actor: Actor, role: Role) {
  return ROLE_RANK[actor.role] >= ROLE_RANK[role]
}

export function canReadSpace(actor: Actor, spaceId: string) {
  return spaceId === TEAM || spaceId === actor.userId
}

export function canWriteSpace(actor: Actor, spaceId: string) {
  return actor.role !== 'viewer' && canReadSpace(actor, spaceId)
}

/** Trash or purge. Team files need an admin; your own private files are yours. */
export function canDeleteInSpace(actor: Actor, spaceId: string) {
  if (spaceId === TEAM) return actor.role === 'admin'
  return spaceId === actor.userId && actor.role !== 'viewer'
}

export function requireRole(actor: Actor, role: Role, doing: string) {
  if (!atLeast(actor, role)) {
    throw forbidden(
      `Your role (${ROLE_LABEL[actor.role]}) can't ${doing}.`,
      role === 'admin'
        ? 'Ask a workspace admin to do this, or to change your role.'
        : 'Read-only members cannot make changes. Ask an admin to upgrade your role.',
    )
  }
}
