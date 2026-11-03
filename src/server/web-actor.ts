import { getAuth } from './auth'
import type { Actor } from './actor'
import { AppError } from './errors'
import { actorFor, defaultWorkspaceId } from './services/workspaces'

export async function sessionUser(headers: Headers) {
  const session = await getAuth().api.getSession({ headers })
  return session?.user ?? null
}

/** Actor for a browser request, in the user's current workspace. */
export async function webActor(headers: Headers): Promise<Actor> {
  const u = await sessionUser(headers)
  if (!u) throw new AppError('unauthorized', 'Sign in first.')
  const wsId = await defaultWorkspaceId(u.id)
  if (!wsId) throw new AppError('forbidden', 'No workspace yet.', { hint: 'onboarding' })
  return actorFor(u, wsId, 'web')
}
