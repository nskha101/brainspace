import { asc, eq } from 'drizzle-orm'
import { getAuth } from './auth'
import type { Actor } from './actor'
import { getDb, member, user, workspace } from './db'
import { AppError } from './errors'

export async function sessionUser(headers: Headers) {
  const session = await getAuth().api.getSession({ headers })
  return session?.user ?? null
}

/**
 * Actor for a browser request, in the user's current workspace. One query
 * (the session itself comes from Better Auth's cookie cache), because every
 * page load and server function goes through here.
 */
export async function webActor(headers: Headers): Promise<Actor> {
  const u = await sessionUser(headers)
  if (!u) throw new AppError('unauthorized', 'Sign in first.')
  const memberships = await getDb()
    .select({
      workspaceId: member.workspaceId,
      role: member.role,
      name: workspace.name,
      slug: workspace.slug,
      // Read from the table, not the cookie-cached session, so a workspace switch applies at once.
      preferred: user.defaultWorkspaceId,
    })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.userId, u.id))
    .orderBy(asc(workspace.createdAt))
  const preferred = memberships[0]?.preferred
  const m = memberships.find((x) => x.workspaceId === preferred) ?? memberships[0]
  if (!m) throw new AppError('forbidden', 'No workspace yet.', { hint: 'onboarding' })
  return {
    userId: u.id,
    userName: u.name,
    email: u.email,
    workspaceId: m.workspaceId,
    workspaceName: m.name,
    workspaceSlug: m.slug,
    role: m.role,
    via: 'web',
  }
}
