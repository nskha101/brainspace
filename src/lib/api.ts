import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { Actor } from '../server/actor'

/**
 * Server functions for the web UI. They are thin wrappers over the same
 * services the MCP server uses, so the app and agents always behave alike.
 */

async function actor(): Promise<Actor> {
  const { webActor } = await import('../server/web-actor')
  return webActor(new Headers(getRequestHeaders() as HeadersInit))
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const { AppError } = await import('../server/errors')
    if (err instanceof AppError) {
      throw new Error(err.hint && err.code !== 'forbidden' ? `${err.message} ${err.hint}` : err.message)
    }
    console.error('[api]', err)
    throw err
  }
}

const v = <T,>(d: T) => d

// Session & workspaces --------------------------------------------------

export const getMe = createServerFn({ method: 'GET' }).handler(async () => {
  const { sessionUser } = await import('../server/web-actor')
  const ws = await import('../server/services/workspaces')
  const u = await sessionUser(new Headers(getRequestHeaders() as HeadersInit))
  if (!u) return null
  const workspaces = await ws.listWorkspaces(u.id)
  const currentId = await ws.defaultWorkspaceId(u.id)
  const current = workspaces.find((w) => w.id === currentId) ?? null
  return {
    user: { id: u.id, name: u.name, email: u.email, image: u.image ?? null },
    workspaces,
    current,
  }
})

export const createWorkspaceFn = createServerFn({ method: 'POST' })
  .validator(v<{ name: string }>)
  .handler(({ data }) =>
    run(async () => {
      const { sessionUser } = await import('../server/web-actor')
      const ws = await import('../server/services/workspaces')
      const u = await sessionUser(new Headers(getRequestHeaders() as HeadersInit))
      if (!u) throw new Error('Sign in first.')
      return ws.createWorkspace(u, data.name)
    }),
  )

export const switchWorkspaceFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string }>)
  .handler(({ data }) =>
    run(async () => {
      const { sessionUser } = await import('../server/web-actor')
      const ws = await import('../server/services/workspaces')
      const u = await sessionUser(new Headers(getRequestHeaders() as HeadersInit))
      if (!u) throw new Error('Sign in first.')
      await ws.setDefaultWorkspace(u.id, data.id)
      return { ok: true }
    }),
  )

export const renameWorkspaceFn = createServerFn({ method: 'POST' })
  .validator(v<{ name: string; description?: string }>)
  .handler(({ data }) =>
    run(async () => (await import('../server/services/workspaces')).renameWorkspace(await actor(), data.name, data.description)),
  )

export const getWorkspaceFn = createServerFn({ method: 'GET' }).handler(() =>
  run(async () => {
    const a = await actor()
    const ws = await import('../server/services/workspaces')
    return { workspace: await ws.getWorkspace(a), role: a.role, userId: a.userId }
  }),
)

export const getInviteFn = createServerFn({ method: 'GET' })
  .validator(v<{ token: string }>)
  .handler(async ({ data }) => (await import('../server/services/workspaces')).lookupInvite(data.token))

export const acceptInviteFn = createServerFn({ method: 'POST' })
  .validator(v<{ token: string }>)
  .handler(({ data }) =>
    run(async () => {
      const { sessionUser } = await import('../server/web-actor')
      const ws = await import('../server/services/workspaces')
      const u = await sessionUser(new Headers(getRequestHeaders() as HeadersInit))
      if (!u) throw new Error('Sign in first.')
      return ws.acceptInvite(u, data.token)
    }),
  )

// Files -----------------------------------------------------------------

export const listFolderFn = createServerFn({ method: 'GET' })
  .validator(v<{ path: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).list(await actor(), data.path)))

export const folderTreeFn = createServerFn({ method: 'GET' })
  .validator(v<{ space: 'team' | 'me' }>)
  .handler(({ data }) =>
    run(async () => {
      const files = await import('../server/services/files')
      const r = await files.list(await actor(), `/${data.space}`, { depth: 6, limit: 2000 })
      return r.entries
        .filter((e) => e.kind === 'folder' || e.kind === 'doc' || e.kind === 'file')
        .map((e) => ({ path: e.path, kind: e.kind, name: e.name, restricted: !!e.restricted }))
    }),
  )

export const resolvePathFn = createServerFn({ method: 'GET' })
  .validator(v<{ path: string; version?: number }>)
  .handler(({ data }) =>
    run(async () => {
      const files = await import('../server/services/files')
      const a = await actor()
      const { accessInfo } = await import('../server/services/access')
      const r = await files.resolve(a, data.path)
      const access = await accessInfo(a, r.p.spaceId, r.p.path)
      if (r.isRoot || r.node?.kind === 'folder') {
        return { type: 'folder' as const, ...(await files.list(a, data.path)), role: a.role, userId: a.userId, access }
      }
      if (!r.node) return { type: 'missing' as const, path: data.path, role: a.role }
      // For PDFs and other parsed files, the browser gets the first part of the text; agents read all of it.
      const doc = await files.read(a, data.path, { version: data.version, ...(r.node.kind === 'file' ? { limit: 800 } : {}) })
      return { type: 'file' as const, file: doc, role: a.role, userId: a.userId, access }
    }),
  )

export const writeFn = createServerFn({ method: 'POST' })
  .validator(v<{ path: string; content: string; message?: string; baseVersion?: number; description?: string; createOnly?: boolean }>)
  .handler(({ data }) =>
    run(async () =>
      // Forward only the public options. Validators don't strip extra fields at runtime.
      (await import('../server/services/files')).write(await actor(), String(data.path), String(data.content), {
        message: typeof data.message === 'string' ? data.message : undefined,
        baseVersion: typeof data.baseVersion === 'number' ? data.baseVersion : undefined,
        description: typeof data.description === 'string' ? data.description : undefined,
        createOnly: data.createOnly === true,
      }),
    ),
  )

export const mkdirFn = createServerFn({ method: 'POST' })
  .validator(v<{ path: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).mkdir(await actor(), data.path)))

export const moveFn = createServerFn({ method: 'POST' })
  .validator(v<{ from: string; to: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).move(await actor(), data.from, data.to)))

export const copyFn = createServerFn({ method: 'POST' })
  .validator(v<{ from: string; to: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).copy(await actor(), data.from, data.to)))

export const promoteFn = createServerFn({ method: 'POST' })
  .validator(v<{ path: string; to?: string; keepCopy?: boolean; baseVersion?: number; message?: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).promote(await actor(), data.path, data)))

export const accessFn = createServerFn({ method: 'GET' })
  .validator(v<{ path: string }>)
  .handler(({ data }) =>
    run(async () => {
      const a = await actor()
      const files = await import('../server/services/files')
      const ws = await import('../server/services/workspaces')
      const access = await files.getAccess(a, data.path)
      const members = a.role !== 'viewer' ? await ws.listMembers(a) : []
      return {
        access,
        members: members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, image: m.image, role: m.role })),
        userId: a.userId,
      }
    }),
  )

export const setAccessFn = createServerFn({ method: 'POST' })
  .validator(v<{ path: string; people: string[] | null }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).setAccess(await actor(), data.path, data.people)))

export const describeFn = createServerFn({ method: 'POST' })
  .validator(v<{ path: string; description: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).describe(await actor(), data.path, data.description)))

export const trashFn = createServerFn({ method: 'POST' })
  .validator(v<{ path: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).trash(await actor(), data.path)))

export const listTrashFn = createServerFn({ method: 'GET' }).handler(() =>
  run(async () => (await import('../server/services/files')).listTrash(await actor())),
)

export const restoreTrashFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string; to?: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).restoreFromTrash(await actor(), data.id, data)))

export const purgeFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).purge(await actor(), data.id)))

export const historyFn = createServerFn({ method: 'GET' })
  .validator(v<{ path: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).history(await actor(), data.path, { limit: 200 })))

export const diffFn = createServerFn({ method: 'GET' })
  .validator(v<{ path: string; from: number; to?: number }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).diff(await actor(), data.path, data.from, data.to)))

export const restoreVersionFn = createServerFn({ method: 'POST' })
  .validator(v<{ path: string; version: number }>)
  .handler(({ data }) => run(async () => (await import('../server/services/files')).restoreVersion(await actor(), data.path, data.version)))

export const searchFn = createServerFn({ method: 'GET' })
  .validator(v<{ query: string; space?: 'all' | 'team' | 'me' }>)
  .handler(({ data }) =>
    run(async () => (await import('../server/services/search')).search(await actor(), data.query, { space: data.space, limit: 30 })),
  )

export const homeFn = createServerFn({ method: 'GET' }).handler(() =>
  run(async () => {
    const a = await actor()
    const files = await import('../server/services/files')
    const { listActivity } = await import('../server/services/activity')
    const { listSkills } = await import('../server/services/skills')
    const { listConnections } = await import('../server/services/connections')
    const [recent, activity, stats, skills, connections] = await Promise.all([
      files.recent(a, { limit: 8 }),
      listActivity(a, { limit: 12 }),
      files.spaceStats(a),
      listSkills(a),
      listConnections(a, { usableOnly: true }),
    ])
    return { recent, activity, stats, skills, connections, role: a.role, workspaceName: a.workspaceName, userName: a.userName }
  }),
)

export const activityFn = createServerFn({ method: 'GET' })
  .validator(v<{ before?: number; pathPrefix?: string }>)
  .handler(({ data }) =>
    run(async () => (await import('../server/services/activity')).listActivity(await actor(), { limit: 100, ...data })),
  )

export const skillsFn = createServerFn({ method: 'GET' }).handler(() =>
  run(async () => (await import('../server/services/skills')).listSkills(await actor())),
)

// People ----------------------------------------------------------------

export const membersFn = createServerFn({ method: 'GET' }).handler(() =>
  run(async () => {
    const a = await actor()
    const ws = await import('../server/services/workspaces')
    return {
      members: await ws.listMembers(a),
      invites: a.role === 'viewer' ? [] : await ws.listInvites(a),
      autoJoin: await ws.getAutoJoin(a),
      role: a.role,
      userId: a.userId,
    }
  }),
)

export const setAutoJoinFn = createServerFn({ method: 'POST' })
  .validator(v<{ enabled: boolean; role?: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/workspaces')).setAutoJoin(await actor(), data)))

export const inviteFn = createServerFn({ method: 'POST' })
  .validator(v<{ email?: string; role: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/workspaces')).invite(await actor(), data)))

export const revokeInviteFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/workspaces')).revokeInvite(await actor(), data.id)))

export const setRoleFn = createServerFn({ method: 'POST' })
  .validator(v<{ userId: string; role: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/workspaces')).setRole(await actor(), data.userId, data.role)))

export const removeMemberFn = createServerFn({ method: 'POST' })
  .validator(v<{ userId: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/workspaces')).removeMember(await actor(), data.userId)))

export const apiKeysFn = createServerFn({ method: 'GET' }).handler(() =>
  run(async () => (await import('../server/services/workspaces')).listApiKeys(await actor())),
)

export const createApiKeyFn = createServerFn({ method: 'POST' })
  .validator(v<{ name: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/workspaces')).createApiKey(await actor(), data.name)))

export const revokeApiKeyFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/workspaces')).revokeApiKey(await actor(), data.id)))

// Connections -----------------------------------------------------------

export const connectionsFn = createServerFn({ method: 'GET' }).handler(() =>
  run(async () => {
    const a = await actor()
    const c = await import('../server/services/connections')
    const ws = await import('../server/services/workspaces')
    return {
      connections: await c.listConnections(a),
      members: (await ws.listMembers(a)).map((m) => ({ userId: m.userId, name: m.name, email: m.email })),
      role: a.role,
      callbackUrl: c.callbackUrl(),
    }
  }),
)

type ConnInput = import('../server/services/connections').ConnectionInput

export const addConnectionFn = createServerFn({ method: 'POST' })
  .validator(v<ConnInput>)
  .handler(({ data }) => run(async () => (await import('../server/services/connections')).addConnection(await actor(), data)))

export const updateConnectionFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string } & ConnInput>)
  .handler(({ data }) => run(async () => (await import('../server/services/connections')).updateConnection(await actor(), data.id, data)))

export const removeConnectionFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/connections')).removeConnection(await actor(), data.id)))

export const authorizeConnectionFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string }>)
  .handler(({ data }) => run(async () => ({ url: await (await import('../server/services/connections')).startOAuth(await actor(), data.id) })))

export const testConnectionFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/connections')).testConnection(await actor(), data.id)))

export const connectionToolsFn = createServerFn({ method: 'GET' })
  .validator(v<{ id: string }>)
  .handler(({ data }) => run(async () => (await import('../server/services/connections')).listToolsFor(await actor(), data.id)))

// OAuth consent (for MCP clients signing in) -----------------------------

export const consentInfoFn = createServerFn({ method: 'GET' })
  .validator(v<{ query: string }>)
  .handler(async ({ data }) => {
    const { verifyOAuthQueryParams } = await import('@better-auth/oauth-provider')
    const { getAuth } = await import('../server/auth')
    const { getDb, oauthClient } = await import('../server/db')
    const { eq } = await import('drizzle-orm')
    const auth = getAuth()
    const { secret } = await auth.$context
    if (!(await verifyOAuthQueryParams(data.query, secret))) return { valid: false as const }
    const params = new URLSearchParams(data.query)
    const clientId = params.get('client_id') ?? ''
    const [client] = await getDb().select().from(oauthClient).where(eq(oauthClient.clientId, clientId))
    return {
      valid: true as const,
      clientName: client?.name ?? clientId,
      clientUri: client?.uri ?? null,
      scopes: (params.get('scope') ?? '').split(' ').filter(Boolean),
    }
  })

export const authConfigFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getEnv } = await import('../server/env')
  const { allowedDomains } = await import('../server/signup-guard')
  const env = getEnv()
  return {
    google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    appUrl: env.APP_URL,
    domains: allowedDomains(),
  }
})

// Agents signed in over OAuth ------------------------------------------

export const oauthAgentsFn = createServerFn({ method: 'GET' }).handler(() =>
  run(async () => {
    const a = await actor()
    const { getDb, oauthConsent, oauthClient } = await import('../server/db')
    const { eq } = await import('drizzle-orm')
    const rows = await getDb()
      .select({ clientId: oauthConsent.clientId, createdAt: oauthConsent.createdAt, updatedAt: oauthConsent.updatedAt, name: oauthClient.name, uri: oauthClient.uri })
      .from(oauthConsent)
      .leftJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .where(eq(oauthConsent.userId, a.userId))
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime(), updatedAt: r.updatedAt.getTime() }))
  }),
)

export const revokeOauthAgentFn = createServerFn({ method: 'POST' })
  .validator(v<{ clientId: string }>)
  .handler(({ data }) =>
    run(async () => {
      const a = await actor()
      const { batch, getDb, oauthConsent, oauthRefreshToken } = await import('../server/db')
      const { and, eq } = await import('drizzle-orm')
      const db = getDb()
      await batch([
        db.delete(oauthConsent).where(and(eq(oauthConsent.userId, a.userId), eq(oauthConsent.clientId, data.clientId))),
        db.delete(oauthRefreshToken).where(and(eq(oauthRefreshToken.userId, a.userId), eq(oauthRefreshToken.clientId, data.clientId))),
      ])
      return { ok: true }
    }),
  )

// Welcome flow ------------------------------------------------------------

export const welcomeFn = createServerFn({ method: 'GET' }).handler(() =>
  run(async () => {
    const a = await actor()
    const ws = await import('../server/services/workspaces')
    const { listActivity } = await import('../server/services/activity')
    const { getEnv } = await import('../server/env')
    const status = await ws.onboardingStatus(a)
    const [recent, autoJoin] = await Promise.all([listActivity(a, { limit: 40 }), ws.getAutoJoin(a)])
    const agentActivity = recent
      .filter((r) => r.via === 'mcp' && r.actorId === a.userId && r.createdAt >= status.joinedAt)
      .slice(0, 8)
    return { ...status, agentActivity, autoJoin, appUrl: getEnv().APP_URL.replace(/\/$/, '') }
  }),
)

export const completeWelcomeFn = createServerFn({ method: 'POST' }).handler(() =>
  run(async () => (await import('../server/services/workspaces')).markOnboarded(await actor())),
)

// Upload links (public page) ---------------------------------------------

export const uploadLinkInfoFn = createServerFn({ method: 'GET' })
  .validator(v<{ token: string }>)
  .handler(async ({ data }) => (await import('../server/services/upload-links')).uploadLinkInfo(data.token))

export const extractTextFn = createServerFn({ method: 'POST' })
  .validator(v<{ path: string }>)
  .handler(({ data }) =>
    run(async () => {
      const a = await actor()
      const files = await import('../server/services/files')
      const { runExtraction } = await import('../server/services/extract')
      const r = await files.resolve(a, data.path)
      if (!r.node || r.node.kind !== 'file') throw new Error('Not an uploaded file.')
      if (a.role === 'viewer') throw new Error('Read-only members cannot re-run extraction.')
      return runExtraction({ nodeId: r.node.id, version: r.node.version })
    }),
  )

// Flows -----------------------------------------------------------------

type Destination = import('../server/db').FlowDestination

export const flowsFn = createServerFn({ method: 'GET' }).handler(() =>
  run(async () => {
    const flows = await import('../server/services/flows')
    const a = await actor()
    const [list, waiting] = await Promise.all([flows.listFlows(a), flows.listRuns(a, { status: 'waiting', limit: 20 })])
    return { flows: list, waiting, templates: flows.listTemplates(), role: a.role }
  }),
)

export const flowFn = createServerFn({ method: 'GET' })
  .validator(v<{ id: string }>)
  .handler(({ data }) =>
    run(async () => {
      const flows = await import('../server/services/flows')
      return flows.getFlow(await actor(), data.id)
    }),
  )

export const flowCreateFn = createServerFn({ method: 'POST' })
  .validator(v<{ name: string; template?: string }>)
  .handler(({ data }) =>
    run(async () => {
      const flows = await import('../server/services/flows')
      const a = await actor()
      const r = await flows.createFlow(a, data)
      const f = await flows.findFlow(a, r.path)
      return { ...r, id: f.id }
    }),
  )

export const flowRunFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string; inputs: Record<string, unknown>; deliver?: Destination[]; test?: boolean; secrets?: Record<string, string> }>)
  .handler(({ data }) =>
    run(async () => {
      const flows = await import('../server/services/flows')
      return flows.runFlow(await actor(), data.id, data)
    }),
  )

export const flowRunGetFn = createServerFn({ method: 'GET' })
  .validator(v<{ id: string }>)
  .handler(({ data }) =>
    run(async () => {
      const flows = await import('../server/services/flows')
      const a = await actor()
      return { ...(await flows.getRun(a, data.id)), canAct: a.role !== 'viewer' }
    }),
  )

export const flowRunCancelFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string }>)
  .handler(({ data }) =>
    run(async () => {
      const flows = await import('../server/services/flows')
      return flows.cancelRun(await actor(), data.id)
    }),
  )

export const flowRunApproveFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string; approved: boolean; note?: string }>)
  .handler(({ data }) =>
    run(async () => {
      const flows = await import('../server/services/flows')
      return flows.approveRun(await actor(), data.id, data)
    }),
  )

export const flowTriggerSetFn = createServerFn({ method: 'POST' })
  .validator(
    v<{
      flow: string
      id?: string
      kind?: 'manual' | 'schedule' | 'webhook'
      name?: string
      cron?: string
      timezone?: string
      inputs?: Record<string, unknown>
      deliver?: Destination[]
      enabled?: boolean
    }>,
  )
  .handler(({ data }) =>
    run(async () => {
      const flows = await import('../server/services/flows')
      return flows.setTrigger(await actor(), data)
    }),
  )

export const flowTriggerRemoveFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string }>)
  .handler(({ data }) =>
    run(async () => {
      const flows = await import('../server/services/flows')
      return flows.removeTrigger(await actor(), data.id)
    }),
  )

export const flowTriggerRunFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string }>)
  .handler(({ data }) =>
    run(async () => {
      const flows = await import('../server/services/flows')
      return flows.runTrigger(await actor(), data.id)
    }),
  )

export const flowTriggerApproveFn = createServerFn({ method: 'POST' })
  .validator(v<{ id: string }>)
  .handler(({ data }) =>
    run(async () => {
      const flows = await import('../server/services/flows')
      return flows.approveTriggerScope(await actor(), data.id)
    }),
  )

export const aiSettingsFn = createServerFn({ method: 'GET' }).handler(() =>
  run(async () => {
    const ai = await import('../server/services/ai')
    const a = await actor()
    const [settings, models] = await Promise.all([ai.getAiSettings(a), ai.listModels().catch(() => [])])
    return { ...settings, models: models.map((m) => ({ id: m.id, name: m.name })), canEdit: a.role === 'admin' }
  }),
)

export const setAiSettingsFn = createServerFn({ method: 'POST' })
  .validator(v<{ key?: string | null; model?: string | null }>)
  .handler(({ data }) =>
    run(async () => {
      const ai = await import('../server/services/ai')
      return ai.setAiSettings(await actor(), data)
    }),
  )

export const secretsFn = createServerFn({ method: 'GET' }).handler(() =>
  run(async () => {
    const s = await import('../server/services/secrets')
    const a = await actor()
    return { secrets: await s.listSecrets(a), canEdit: a.role !== 'viewer' }
  }),
)

export const setSecretFn = createServerFn({ method: 'POST' })
  .validator(v<{ name: string; value?: string; hosts?: string[]; scope?: 'team' | 'me'; description?: string }>)
  .handler(({ data }) =>
    run(async () => {
      const s = await import('../server/services/secrets')
      return s.setSecret(await actor(), data)
    }),
  )

export const removeSecretFn = createServerFn({ method: 'POST' })
  .validator(v<{ name: string; scope?: 'team' | 'me' }>)
  .handler(({ data }) =>
    run(async () => {
      const s = await import('../server/services/secrets')
      return s.removeSecret(await actor(), data)
    }),
  )
