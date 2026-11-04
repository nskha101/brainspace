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
  member: 'Can read and edit everything, promote private docs to the team drive, add connections and invite people. Cannot delete team files, change roles or remove members.',
  viewer: 'Can read the team drive and use read-only connection tools. Cannot change anything.',
}

export function atLeast(actor: Actor, role: Role) {
  return ROLE_RANK[actor.role] >= ROLE_RANK[role]
}

export function canReadDrive(actor: Actor, driveId: string) {
  return driveId === TEAM || driveId === actor.userId
}

export function canWriteDrive(actor: Actor, driveId: string) {
  return actor.role !== 'viewer' && canReadDrive(actor, driveId)
}

/** Trash or purge. Team files need an admin; your own private files are yours. */
export function canDeleteInDrive(actor: Actor, driveId: string) {
  if (driveId === TEAM) return actor.role === 'admin'
  return driveId === actor.userId && actor.role !== 'viewer'
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
