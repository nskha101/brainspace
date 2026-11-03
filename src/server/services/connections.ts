import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  auth as mcpAuth,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import type { Actor } from '../actor'
import { ROLE_LABEL, ROLE_RANK, requireRole } from '../actor'
import { decryptJson, encryptJson, newId, randomToken } from '../crypto'
import {
  connection,
  connectionAccess,
  connectionCredential,
  getDb,
  member,
  user,
  type CachedTool,
  type Json,
  type ConnectionAuth,
  type Role,
} from '../db'
import { appUrl, background } from '../env'
import { AppError, forbidden, invalid, notFound } from '../errors'
import { presetById } from '../../lib/presets'
import { logActivity } from './activity'

type ConnRow = typeof connection.$inferSelect

type CredentialData = {
  headers?: Record<string, string>
  tokens?: StoredOAuthTokens
  clientInformation?: StoredOAuthClientInformation
  codeVerifier?: string
  discoveryState?: OAuthDiscoveryState
  authorizationServerUrl?: string
  resourceUrl?: string
}

const TOOLS_TTL_MS = 1000 * 60 * 60 * 6
export const TOOL_SEP = '__'

export function callbackUrl() {
  return `${appUrl()}/api/connections/callback`
}

export function clientMetadataUrl() {
  return `${appUrl()}/oauth/client-metadata.json`
}

export function clientMetadataDocument(): OAuthClientMetadata & { client_id: string } {
  return {
    client_id: clientMetadataUrl(),
    client_name: 'Brainspace',
    client_uri: appUrl(),
    logo_uri: `${appUrl()}/icon.svg`,
    redirect_uris: [callbackUrl()],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
}

function credentialKey(conn: ConnRow, userId: string) {
  return conn.credentialMode === 'per_user' ? userId : ''
}

async function loadCredential(conn: ConnRow, key: string) {
  const [row] = await getDb()
    .select()
    .from(connectionCredential)
    .where(and(eq(connectionCredential.connectionId, conn.id), eq(connectionCredential.userId, key)))
  return { row, data: ((await decryptJson<CredentialData>(row?.data)) ?? {}) as CredentialData }
}

async function saveCredential(conn: ConnRow, key: string, data: CredentialData, oauthState?: string | null) {
  const enc = await encryptJson(data)
  await getDb()
    .insert(connectionCredential)
    .values({ connectionId: conn.id, userId: key, data: enc, oauthState: oauthState ?? null })
    .onConflictDoUpdate({
      target: [connectionCredential.connectionId, connectionCredential.userId],
      set: { data: enc, updatedAt: new Date(), ...(oauthState !== undefined ? { oauthState } : {}) },
    })
}

/** OAuth client provider for upstream MCP servers, persisted (encrypted) in D1. */
class DbOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: URL
  private stateValue?: string
  constructor(
    private conn: ConnRow,
    private key: string,
    private data: CredentialData,
    private staticClient?: { clientId: string; clientSecret?: string },
  ) {}

  get redirectUrl() {
    return callbackUrl()
  }
  get clientMetadataUrl() {
    return this.staticClient ? undefined : clientMetadataUrl()
  }
  get clientMetadata(): OAuthClientMetadata {
    const md = clientMetadataDocument()
    return {
      client_name: md.client_name,
      client_uri: md.client_uri,
      redirect_uris: md.redirect_uris,
      grant_types: md.grant_types,
      response_types: md.response_types,
      token_endpoint_auth_method: this.staticClient?.clientSecret ? 'client_secret_post' : 'none',
      ...(this.conn.oauthScope ? { scope: this.conn.oauthScope } : {}),
    }
  }
  state() {
    this.stateValue ??= randomToken(24)
    return this.stateValue
  }
  get pendingState() {
    return this.stateValue
  }
  clientInformation() {
    if (this.staticClient) {
      return {
        client_id: this.staticClient.clientId,
        ...(this.staticClient.clientSecret ? { client_secret: this.staticClient.clientSecret } : {}),
      }
    }
    return this.data.clientInformation
  }
  async saveClientInformation(info: StoredOAuthClientInformation) {
    this.data.clientInformation = info
    await this.persist()
  }
  tokens() {
    return this.data.tokens
  }
  async saveTokens(tokens: StoredOAuthTokens) {
    this.data.tokens = tokens
    await this.persist()
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url
  }
  async saveCodeVerifier(v: string) {
    this.data.codeVerifier = v
    await this.persist()
  }
  codeVerifier() {
    if (!this.data.codeVerifier) throw new Error('No PKCE verifier saved')
    return this.data.codeVerifier
  }
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'client') delete this.data.clientInformation
    if (scope === 'all' || scope === 'tokens') delete this.data.tokens
    if (scope === 'all' || scope === 'verifier') delete this.data.codeVerifier
    if (scope === 'all' || scope === 'discovery') delete this.data.discoveryState
    await this.persist()
  }
  async saveDiscoveryState(s: OAuthDiscoveryState) {
    this.data.discoveryState = s
    await this.persist()
  }
  discoveryState() {
    return this.data.discoveryState
  }
  async saveAuthorizationServerUrl(u: string) {
    this.data.authorizationServerUrl = u
  }
  authorizationServerUrl() {
    return this.data.authorizationServerUrl
  }
  async saveResourceUrl(u: string) {
    this.data.resourceUrl = u
  }
  resourceUrl() {
    return this.data.resourceUrl
  }
  async persist() {
    await saveCredential(this.conn, this.key, this.data, this.stateValue ?? undefined)
  }
}

async function staticClientFor(conn: ConnRow) {
  return decryptJson<{ clientId: string; clientSecret?: string }>(conn.oauthClient)
}

async function makeProvider(conn: ConnRow, key: string) {
  const { data } = await loadCredential(conn, key)
  return new DbOAuthProvider(conn, key, data, await staticClientFor(conn))
}

// ---------------------------------------------------------------------------
// Access control

/** minRole gates the whole connection. Viewers who pass it still only get read-only tools. */
export function canUseConnection(actor: Actor, conn: ConnRow, allowedUserIds: Set<string>) {
  if (ROLE_RANK[actor.role] < ROLE_RANK[conn.minRole]) return false
  if (conn.accessMode === 'restricted' && actor.role !== 'admin' && !allowedUserIds.has(actor.userId)) return false
  return true
}

export function isReadOnlyTool(conn: ConnRow, tool: CachedTool | undefined, name: string) {
  if (conn.readOnlyTools?.includes(name)) return true
  return tool?.annotations?.readOnlyHint === true
}

function toolAllowed(conn: ConnRow, name: string) {
  return !conn.toolAllowlist || conn.toolAllowlist.includes(name)
}

async function accessSets(connIds: string[]) {
  const map = new Map<string, Set<string>>()
  if (!connIds.length) return map
  const rows = await getDb().select().from(connectionAccess).where(inArray(connectionAccess.connectionId, connIds))
  for (const r of rows) {
    if (!map.has(r.connectionId)) map.set(r.connectionId, new Set())
    map.get(r.connectionId)!.add(r.userId)
  }
  return map
}

// ---------------------------------------------------------------------------
// CRUD

export async function listConnections(actor: Actor, opts: { usableOnly?: boolean } = {}) {
  const db = getDb()
  const rows = await db
    .select()
    .from(connection)
    .where(eq(connection.workspaceId, actor.workspaceId))
    .orderBy(asc(connection.name))
  const access = await accessSets(rows.map((r) => r.id))
  const creds = rows.length
    ? await db
        .select({ connectionId: connectionCredential.connectionId, userId: connectionCredential.userId, oauthState: connectionCredential.oauthState })
        .from(connectionCredential)
        .where(inArray(connectionCredential.connectionId, rows.map((r) => r.id)))
    : []
  return rows
    .map((c) => {
      const allowed = access.get(c.id) ?? new Set<string>()
      const usable = canUseConnection(actor, c, allowed)
      const myCred = creds.find((x) => x.connectionId === c.id && x.userId === credentialKey(c, actor.userId))
      const tools = (c.toolsCache ?? []).filter((t) => toolAllowed(c, t.name))
      const status: ConnRow['status'] =
        c.credentialMode === 'per_user' && c.authType === 'oauth' ? (myCred && !myCred.oauthState ? 'active' : 'needs_auth') : c.status
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        presetId: c.presetId,
        type: c.type,
        url: c.url,
        authType: c.authType,
        credentialMode: c.credentialMode,
        minRole: c.minRole,
        accessMode: c.accessMode,
        allowedUserIds: [...allowed],
        exposeTools: c.exposeTools,
        toolAllowlist: c.toolAllowlist,
        readOnlyTools: c.readOnlyTools,
        instructions: c.instructions,
        status,
        statusMessage: c.statusMessage,
        toolCount: tools.length,
        totalToolCount: (c.toolsCache ?? []).length,
        toolsCachedAt: c.toolsCachedAt?.getTime() ?? null,
        usable,
        hasOAuthClient: !!c.oauthClient,
        createdAt: c.createdAt.getTime(),
      }
    })
    .filter((c) => !opts.usableOnly || c.usable)
}

export type ConnectionInput = {
  name?: string
  slug?: string
  presetId?: string
  type?: 'mcp' | 'http'
  url?: string
  authType?: ConnectionAuth
  credentialMode?: 'shared' | 'per_user'
  /** Bearer token, for authType "bearer". */
  token?: string
  /** Extra headers (e.g. { "X-Api-Key": "..." }), for authType "headers". */
  headers?: Record<string, string>
  oauthClientId?: string
  oauthClientSecret?: string
  oauthScope?: string
  minRole?: Role
  accessMode?: 'all' | 'restricted'
  allowedUsers?: string[]
  exposeTools?: boolean
  toolAllowlist?: string[] | null
  readOnlyTools?: string[] | null
  instructions?: string
}

async function requireConn(actor: Actor, idOrSlug: string) {
  const [row] = await getDb()
    .select()
    .from(connection)
    .where(and(eq(connection.workspaceId, actor.workspaceId)))
    .then((rows) => rows.filter((r) => r.id === idOrSlug || r.slug === idOrSlug.toLowerCase()))
  if (!row) throw notFound(`Connection "${idOrSlug}"`, 'Use connections_list to see what is connected.')
  return row
}

async function resolveUserIds(actor: Actor, who: string[]) {
  if (!who.length) return []
  const rows = await getDb()
    .select({ userId: member.userId, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.workspaceId, actor.workspaceId))
  return who.map((w) => {
    const m = rows.find((r) => r.userId === w || r.email.toLowerCase() === w.toLowerCase())
    if (!m) throw notFound(`Member "${w}"`)
    return m.userId
  })
}

function validateUrl(url: string) {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw invalid(`"${url}" is not a valid URL.`)
  }
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) {
    throw invalid('Connections must use https.')
  }
  return u.toString()
}

export async function addConnection(actor: Actor, input: ConnectionInput) {
  requireRole(actor, 'member', 'add connections')
  const preset = presetById(input.presetId)
  const type = input.type ?? preset?.type ?? 'mcp'
  const url = validateUrl(input.url || preset?.url || '')
  const name = (input.name || preset?.name || new URL(url).hostname).trim().slice(0, 60)
  const slug = slugify(input.slug || preset?.slug || name)
  if (!slug) throw invalid('Give the connection a short slug, like "hubspot".')
  const authType: ConnectionAuth =
    input.authType ?? (input.token ? 'bearer' : input.headers ? 'headers' : (preset?.authType ?? 'none'))
  const db = getDb()
  const [dupe] = await db
    .select({ id: connection.id })
    .from(connection)
    .where(and(eq(connection.workspaceId, actor.workspaceId), eq(connection.slug, slug)))
  if (dupe) throw new AppError('conflict', `A connection with slug "${slug}" already exists.`, { hint: 'Pick another slug or update the existing one.' })

  const id = newId('conn')
  const oauthClient =
    input.oauthClientId ? await encryptJson({ clientId: input.oauthClientId, clientSecret: input.oauthClientSecret }) : null
  if (authType === 'oauth' && preset?.needsOAuthClient && !oauthClient) {
    throw invalid(`${preset.name} needs a pre-registered OAuth app.`, `${preset.setup} Redirect URL: ${callbackUrl()}`)
  }
  await db.insert(connection).values({
    id,
    workspaceId: actor.workspaceId,
    name,
    slug,
    presetId: preset?.id ?? null,
    type,
    url,
    authType,
    credentialMode: input.credentialMode ?? 'shared',
    oauthClient,
    oauthScope: input.oauthScope ?? null,
    minRole: input.minRole ?? 'viewer',
    accessMode: input.accessMode ?? 'all',
    exposeTools: input.exposeTools ?? true,
    toolAllowlist: input.toolAllowlist ?? null,
    readOnlyTools: input.readOnlyTools ?? null,
    instructions: input.instructions ?? preset?.instructions ?? null,
    status: authType === 'oauth' ? 'needs_auth' : 'active',
    createdBy: actor.userId,
  })
  const conn = (await requireConn(actor, id))!
  if (input.allowedUsers?.length) {
    const ids = await resolveUserIds(actor, input.allowedUsers)
    await db.insert(connectionAccess).values(ids.map((userId) => ({ connectionId: id, userId })))
  }
  if (authType === 'bearer' || authType === 'headers') {
    const headers: Record<string, string> = { ...(input.headers ?? {}) }
    if (input.token) headers.Authorization = `Bearer ${input.token.replace(/^Bearer\s+/i, '')}`
    if (!Object.keys(headers).length && type === 'mcp') {
      throw invalid('This connection needs a token.', 'Pass token (sent as a Bearer header) or headers.')
    }
    await saveCredential(conn, '', { headers })
  }
  await logActivity(actor, 'connection_add', { details: { name, slug, url } })

  let authorizeUrl: string | undefined
  if (authType === 'oauth') {
    authorizeUrl = await startOAuth(actor, conn)
  } else if (type === 'mcp') {
    try {
      await refreshTools(actor, conn)
    } catch (err) {
      // The connection stays, flagged with the error.
      console.error('[connections] initial tool fetch failed', err)
    }
  }
  const [fresh] = (await listConnections(actor)).filter((c) => c.id === id)
  return {
    connection: fresh,
    authorizeUrl,
    next: authorizeUrl
      ? 'Open authorizeUrl in a browser and sign in. The connection becomes active after the provider redirects back.'
      : undefined,
  }
}

export async function updateConnection(actor: Actor, idOrSlug: string, input: ConnectionInput) {
  requireRole(actor, 'member', 'change connections')
  const conn = await requireConn(actor, idOrSlug)
  const accessChange =
    input.minRole !== undefined || input.accessMode !== undefined || input.allowedUsers !== undefined
  if (accessChange) requireRole(actor, 'admin', 'change who can use a connection')
  const db = getDb()
  const set: Partial<typeof connection.$inferInsert> = { updatedAt: new Date() }
  if (input.name) set.name = input.name.slice(0, 60)
  if (input.url) set.url = validateUrl(input.url)
  if (input.minRole) set.minRole = input.minRole
  if (input.accessMode) set.accessMode = input.accessMode
  if (input.exposeTools !== undefined) set.exposeTools = input.exposeTools
  if (input.toolAllowlist !== undefined) set.toolAllowlist = input.toolAllowlist
  if (input.readOnlyTools !== undefined) set.readOnlyTools = input.readOnlyTools
  if (input.instructions !== undefined) set.instructions = input.instructions || null
  if (input.credentialMode) set.credentialMode = input.credentialMode
  if (input.oauthScope !== undefined) set.oauthScope = input.oauthScope || null
  if (input.oauthClientId) {
    set.oauthClient = await encryptJson({ clientId: input.oauthClientId, clientSecret: input.oauthClientSecret })
  }
  await db.update(connection).set(set).where(eq(connection.id, conn.id))
  if (input.allowedUsers !== undefined) {
    const ids = await resolveUserIds(actor, input.allowedUsers)
    await db.delete(connectionAccess).where(eq(connectionAccess.connectionId, conn.id))
    if (ids.length) await db.insert(connectionAccess).values(ids.map((userId) => ({ connectionId: conn.id, userId })))
  }
  if (input.token || input.headers) {
    const headers: Record<string, string> = { ...(input.headers ?? {}) }
    if (input.token) headers.Authorization = `Bearer ${input.token.replace(/^Bearer\s+/i, '')}`
    await saveCredential(conn, '', { headers })
    await db.update(connection).set({ status: 'active', statusMessage: null }).where(eq(connection.id, conn.id))
  }
  await logActivity(actor, 'connection_update', { details: { slug: conn.slug, fields: Object.keys(input) } })
  const fresh = await requireConn(actor, conn.id)
  if ((input.token || input.headers || input.url) && fresh.type === 'mcp') {
    await refreshTools(actor, fresh).catch(() => {})
  }
  return (await listConnections(actor)).find((c) => c.id === conn.id)
}

export async function removeConnection(actor: Actor, idOrSlug: string) {
  requireRole(actor, 'admin', 'remove connections')
  const conn = await requireConn(actor, idOrSlug)
  await getDb().delete(connection).where(eq(connection.id, conn.id))
  await logActivity(actor, 'connection_remove', { details: { name: conn.name, slug: conn.slug } })
  return { removed: conn.slug }
}

// ---------------------------------------------------------------------------
// OAuth

export async function startOAuth(actor: Actor, connOrId: ConnRow | string) {
  const conn = typeof connOrId === 'string' ? await requireConn(actor, connOrId) : connOrId
  if (conn.authType !== 'oauth') throw invalid(`${conn.name} doesn't use OAuth.`)
  if (conn.credentialMode === 'shared') requireRole(actor, 'member', 'authorize shared connections')
  const key = credentialKey(conn, actor.userId)
  const provider = await makeProvider(conn, key)
  provider.state()
  // Drop any stale tokens so auth() starts a fresh authorization.
  delete (provider as unknown as { data: CredentialData }).data.tokens
  const result = await mcpAuth(provider, { serverUrl: conn.url, scope: conn.oauthScope ?? undefined })
  if (result === 'AUTHORIZED') {
    await markStatus(conn, 'active', null)
    return undefined
  }
  if (!provider.authorizationUrl) throw new AppError('upstream', `${conn.name} did not return an authorization URL.`)
  await saveCredential(conn, key, (provider as unknown as { data: CredentialData }).data, provider.pendingState)
  return provider.authorizationUrl.toString()
}

export async function finishOAuth(state: string, code: string) {
  const db = getDb()
  const [cred] = await db.select().from(connectionCredential).where(eq(connectionCredential.oauthState, state))
  if (!cred) throw invalid('This authorization link expired. Start the connection again.')
  const [conn] = await db.select().from(connection).where(eq(connection.id, cred.connectionId))
  if (!conn) throw notFound('Connection')
  const provider = await makeProvider(conn, cred.userId)
  await mcpAuth(provider, { serverUrl: conn.url, authorizationCode: code, scope: conn.oauthScope ?? undefined })
  await db
    .update(connectionCredential)
    .set({ oauthState: null })
    .where(and(eq(connectionCredential.connectionId, conn.id), eq(connectionCredential.userId, cred.userId)))
  if (conn.credentialMode === 'shared') await markStatus(conn, 'active', null)
  background(fetchTools(conn, cred.userId).then((tools) => cacheTools(conn, tools)))
  return { connectionId: conn.id, workspaceId: conn.workspaceId, name: conn.name }
}

async function markStatus(conn: ConnRow, status: ConnRow['status'], message: string | null) {
  await getDb().update(connection).set({ status, statusMessage: message, updatedAt: new Date() }).where(eq(connection.id, conn.id))
}

// ---------------------------------------------------------------------------
// Talking to upstream servers

async function connectClient(conn: ConnRow, key: string) {
  const { data } = await loadCredential(conn, key)
  const headers = data.headers ?? {}
  const provider = conn.authType === 'oauth' ? new DbOAuthProvider(conn, key, data, await staticClientFor(conn)) : undefined
  const url = new URL(conn.url)
  const client = new Client({ name: 'brainspace', version: '1.0.0' })
  const timeout = AbortSignal.timeout(60_000)
  try {
    await client.connect(
      new StreamableHTTPClientTransport(url, { authProvider: provider, requestInit: { headers, signal: timeout } }),
    )
    return client
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err
    const msg = String((err as Error)?.message ?? err)
    if (!/40[45]|Method Not Allowed|Not Found/i.test(msg)) throw err
    const fallback = new Client({ name: 'brainspace', version: '1.0.0' })
    await fallback.connect(new SSEClientTransport(url, { authProvider: provider, requestInit: { headers } }))
    return fallback
  }
}

function upstreamError(conn: ConnRow, err: unknown, _actor?: Actor) {
  if (err instanceof UnauthorizedError || /401|unauthori[sz]ed|invalid_token/i.test(String(err))) {
    return new AppError('unauthorized', `${conn.name} rejected Brainspace's credentials.`, {
      hint:
        conn.authType === 'oauth'
          ? `Re-authorize with connection_authorize("${conn.slug}"), then retry.`
          : 'An admin needs to update the token with connection_update.',
    })
  }
  return new AppError('upstream', `${conn.name} failed: ${String((err as Error)?.message ?? err).slice(0, 500)}`)
}

async function fetchTools(conn: ConnRow, key: string): Promise<CachedTool[]> {
  const client = await connectClient(conn, key)
  try {
    const tools: CachedTool[] = []
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const res = await client.listTools(cursor ? { cursor } : undefined)
      for (const t of res.tools) {
        tools.push({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, Json>,
          annotations: t.annotations as Record<string, Json> | undefined,
        })
      }
      cursor = res.nextCursor
      if (!cursor) break
    }
    return tools
  } finally {
    await client.close().catch(() => {})
  }
}

async function cacheTools(conn: ConnRow, tools: CachedTool[]) {
  await getDb()
    .update(connection)
    .set({ toolsCache: tools, toolsCachedAt: new Date(), status: 'active', statusMessage: null })
    .where(eq(connection.id, conn.id))
}

export async function refreshTools(actor: Actor, connOrId: ConnRow | string) {
  const conn = typeof connOrId === 'string' ? await requireConn(actor, connOrId) : connOrId
  if (conn.type === 'http') return httpTools(conn)
  try {
    const tools = await fetchTools(conn, credentialKey(conn, actor.userId))
    await cacheTools(conn, tools)
    return tools
  } catch (err) {
    const e = upstreamError(conn, err, actor)
    if (conn.credentialMode === 'shared') {
      await markStatus(conn, e.code === 'unauthorized' ? 'needs_auth' : 'error', e.message)
    }
    throw e
  }
}

function httpTools(conn: ConnRow): CachedTool[] {
  return [
    {
      name: 'request',
      description: `Send an HTTP request to ${conn.name} (${conn.url}). Auth headers are added by Brainspace. ${conn.instructions ?? ''}`.trim(),
      inputSchema: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
          path: { type: 'string', description: `Path relative to ${conn.url}, e.g. /v1/things` },
          query: { type: 'object', additionalProperties: { type: 'string' } },
          body: { description: 'JSON body for POST/PUT/PATCH' },
        },
        required: ['path'],
      },
      annotations: { readOnlyHint: false },
    },
  ]
}

/** Tools an actor may see for a connection, with the stale cache refreshed in the background. */
export async function toolsFor(actor: Actor, conn: ConnRow): Promise<CachedTool[]> {
  const all = conn.type === 'http' ? httpTools(conn) : (conn.toolsCache ?? [])
  if (conn.type === 'mcp' && conn.status === 'active' && (!conn.toolsCachedAt || Date.now() - conn.toolsCachedAt.getTime() > TOOLS_TTL_MS)) {
    background(refreshTools(actor, conn).catch(() => {}))
  }
  return all.filter((t) => toolAllowed(conn, t.name)).filter((t) => actor.role !== 'viewer' || isReadOnlyTool(conn, t, t.name) || conn.type === 'http')
}

export async function usableConnections(actor: Actor) {
  const rows = await getDb().select().from(connection).where(eq(connection.workspaceId, actor.workspaceId))
  const access = await accessSets(rows.map((r) => r.id))
  return rows.filter((c) => canUseConnection(actor, c, access.get(c.id) ?? new Set()))
}

export function proxiedToolName(conn: ConnRow, tool: string) {
  const name = `${conn.slug}${TOOL_SEP}${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  return name.length <= 64 ? name : name.slice(0, 64)
}

export async function listToolsFor(actor: Actor, idOrSlug: string) {
  const conn = await requireConn(actor, idOrSlug)
  const access = await accessSets([conn.id])
  if (!canUseConnection(actor, conn, access.get(conn.id) ?? new Set())) {
    throw forbidden(`You don't have access to ${conn.name}.`, 'Ask an admin to grant you access.')
  }
  if (conn.type === 'mcp' && !conn.toolsCache) await refreshTools(actor, conn).catch(() => {})
  const fresh = await requireConn(actor, conn.id)
  return {
    connection: { slug: fresh.slug, name: fresh.name, status: fresh.status, instructions: fresh.instructions },
    tools: (await toolsFor(actor, fresh)).map((t) => ({ ...t, proxiedName: fresh.exposeTools ? proxiedToolName(fresh, t.name) : undefined })),
  }
}

export async function callConnectionTool(actor: Actor, idOrSlug: string, toolName: string, args: Record<string, unknown> = {}) {
  const conn = await requireConn(actor, idOrSlug)
  const access = await accessSets([conn.id])
  if (!canUseConnection(actor, conn, access.get(conn.id) ?? new Set())) {
    throw forbidden(`You don't have access to ${conn.name}.`, 'Ask an admin to grant you access.')
  }
  if (!toolAllowed(conn, toolName)) throw forbidden(`${toolName} is turned off for ${conn.name} in this workspace.`)
  const cached = (conn.toolsCache ?? []).find((t) => t.name === toolName)
  if (actor.role === 'viewer') {
    const readOnly = conn.type === 'http' ? String(args.method ?? 'GET').toUpperCase() === 'GET' : isReadOnlyTool(conn, cached, toolName)
    if (!readOnly) {
      throw forbidden(
        `Your role (${ROLE_LABEL.viewer}) can only use read-only tools, and ${toolName} may change data.`,
        'Ask an admin to mark it read-only for this connection, or to upgrade your role.',
      )
    }
  }

  const started = Date.now()
  let ok = true
  try {
    if (conn.type === 'http') return await callHttp(conn, args)
    const key = credentialKey(conn, actor.userId)
    const client = await connectClient(conn, key)
    try {
      return await client.callTool({ name: toolName, arguments: args }, { timeout: 120_000 } as never)
    } finally {
      await client.close().catch(() => {})
    }
  } catch (err) {
    ok = false
    const e = upstreamError(conn, err, actor)
    if (e.code === 'unauthorized' && conn.credentialMode === 'shared') await markStatus(conn, 'needs_auth', e.message)
    throw e
  } finally {
    background(
      logActivity(actor, 'connection_call', {
        details: { connection: conn.slug, tool: toolName, ok, ms: Date.now() - started },
      }),
    )
  }
}

async function callHttp(conn: ConnRow, args: Record<string, unknown>) {
  const { data } = await loadCredential(conn, '')
  const method = String(args.method ?? 'GET').toUpperCase()
  const path = String(args.path ?? '/')
  const base = new URL(conn.url)
  const target = new URL(path.replace(/^\//, ''), base.toString().endsWith('/') ? base : new URL(base.toString() + '/'))
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname.replace(/\/$/, ''))) {
    throw invalid(`Path must stay under ${conn.url}.`)
  }
  const q = (args.query ?? {}) as Record<string, string>
  for (const [k, v] of Object.entries(q)) target.searchParams.set(k, String(v))
  const res = await fetch(target, {
    method,
    headers: { ...(data.headers ?? {}), ...(args.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: args.body !== undefined && method !== 'GET' ? JSON.stringify(args.body) : undefined,
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  const clipped = text.length > 100_000 ? text.slice(0, 100_000) + '\n…[truncated]' : text
  return {
    content: [{ type: 'text' as const, text: `HTTP ${res.status} ${res.statusText}\n\n${clipped}` }],
    isError: !res.ok,
  }
}

export async function testConnection(actor: Actor, idOrSlug: string) {
  const conn = await requireConn(actor, idOrSlug)
  if (conn.type === 'http') return { ok: true, tools: 1 }
  const tools = await refreshTools(actor, conn)
  return { ok: true, tools: tools.length }
}
