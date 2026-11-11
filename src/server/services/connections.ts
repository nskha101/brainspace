import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  auth as mcpAuth,
  type DiscoverResult,
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
import { appUrl, background, getEnv } from '../env'
import { AppError, forbidden, invalid, notFound } from '../errors'
import { presetById } from '../../lib/presets'
import { logActivity } from './activity'
import {
  describeSlackToken,
  exchangeSlackCode,
  runSlackTool,
  slackAuthorizeUrl,
  slackToolDefs,
  type SlackInstall,
} from './slack'

type ConnRow = typeof connection.$inferSelect

type CredentialData = {
  headers?: Record<string, string>
  tokens?: StoredOAuthTokens
  clientInformation?: StoredOAuthClientInformation
  codeVerifier?: string
  discoveryState?: OAuthDiscoveryState
  authorizationServerUrl?: string
  resourceUrl?: string
  /** The Slack workspace a Slack connection is installed in. */
  slack?: SlackInstall
  /** Who started a pending Slack install, and when. Only they can finish it, within an hour. */
  slackInstallBy?: string
  slackInstallAt?: number
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
      const all = builtinTools(c) ?? c.toolsCache ?? []
      const tools = all.filter((t) => toolAllowed(c, t.name))
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
        toolMode: c.toolMode,
        effectiveToolMode: effectiveToolMode(c),
        upstreamInstructions: c.upstreamInstructions,
        toolAllowlist: c.toolAllowlist,
        readOnlyTools: c.readOnlyTools,
        instructions: c.instructions,
        status,
        statusMessage: c.statusMessage,
        toolCount: tools.length,
        totalToolCount: all.length,
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
  type?: 'mcp' | 'http' | 'slack'
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
  toolMode?: 'auto' | 'direct' | 'search'
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
  let url = validateUrl(input.url || preset?.url || '')
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
  // Slack: check the bot token (or that there's an app to install) before saving anything.
  let slackInstall: SlackInstall | undefined
  if (type === 'slack') {
    if (authType === 'bearer') {
      if (!input.token) throw invalid('Pass the Slack bot token (xoxb-...).')
      slackInstall = await describeSlackToken(input.token.replace(/^Bearer\s+/i, ''))
      url = slackInstall.url ?? url
    } else if (authType === 'oauth') {
      if (!(await slackClient(oauthClient))) throw slackAppMissing()
    } else {
      throw invalid('Slack connects with Add to Slack (authType "oauth") or a bot token (authType "bearer").')
    }
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
    credentialMode: type === 'slack' ? 'shared' : (input.credentialMode ?? 'shared'),
    oauthClient,
    oauthScope: input.oauthScope ?? null,
    minRole: input.minRole ?? 'viewer',
    accessMode: input.accessMode ?? 'all',
    exposeTools: input.exposeTools ?? true,
    toolMode: input.toolMode ?? 'auto',
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
    await saveCredential(conn, '', { headers, ...(slackInstall ? { slack: slackInstall } : {}) })
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
  if (input.toolMode) set.toolMode = input.toolMode
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
  if (conn.type === 'slack' && input.token) {
    const token = input.token.replace(/^Bearer\s+/i, '')
    const install = await describeSlackToken(token)
    await saveCredential(conn, '', { headers: { Authorization: `Bearer ${token}` }, slack: install })
    await db
      .update(connection)
      .set({ authType: 'bearer', status: 'active', statusMessage: null, ...(install.url ? { url: install.url } : {}) })
      .where(eq(connection.id, conn.id))
  } else if (input.token || input.headers) {
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
  // Slack connections aren't revoked in Slack: one Slack workspace's installs of the app share a
  // bot token, so revoking it here could cut off other connections using the same token.
  await getDb().delete(connection).where(eq(connection.id, conn.id))
  await logActivity(actor, 'connection_remove', { details: { name: conn.name, slug: conn.slug } })
  return { removed: conn.slug }
}

// ---------------------------------------------------------------------------
// OAuth

export async function startOAuth(actor: Actor, connOrId: ConnRow | string) {
  const conn = typeof connOrId === 'string' ? await requireConn(actor, connOrId) : connOrId
  if (conn.type === 'slack') return startSlackInstall(actor, conn)
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

/** `userId` is whoever is signed in to Brainspace in the browser that came back from the provider. */
export async function finishOAuth(state: string, code: string, opts: { userId?: string } = {}) {
  const db = getDb()
  const [cred] = await db.select().from(connectionCredential).where(eq(connectionCredential.oauthState, state))
  if (!cred) throw invalid('This authorization link expired. Start the connection again.')
  const [conn] = await db.select().from(connection).where(eq(connection.id, cred.connectionId))
  if (!conn) throw notFound('Connection')
  if (conn.type === 'slack') return finishSlackInstall(conn, cred.data, code, opts.userId)
  const provider = await makeProvider(conn, cred.userId)
  await mcpAuth(provider, { serverUrl: conn.url, authorizationCode: code, scope: conn.oauthScope ?? undefined })
  await db
    .update(connectionCredential)
    .set({ oauthState: null })
    .where(and(eq(connectionCredential.connectionId, conn.id), eq(connectionCredential.userId, cred.userId)))
  if (conn.credentialMode === 'shared') await markStatus(conn, 'active', null)
  background(fetchTools(conn, cred.userId).then((fetched) => cacheTools(conn, fetched)))
  return { connectionId: conn.id, workspaceId: conn.workspaceId, name: conn.name }
}

async function markStatus(conn: ConnRow, status: ConnRow['status'], message: string | null) {
  await getDb().update(connection).set({ status, statusMessage: message, updatedAt: new Date() }).where(eq(connection.id, conn.id))
}

// ---------------------------------------------------------------------------
// Slack: a built-in connection. Its tools run here (./slack.ts) with the bot
// token from "Add to Slack", or a bot token someone pasted in.

/** The Slack app to install: the connection's own, or this server's (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET). */
async function slackClient(encryptedClient: string | null) {
  const own = await decryptJson<{ clientId: string; clientSecret?: string }>(encryptedClient)
  if (own?.clientId && own.clientSecret) return { clientId: own.clientId, clientSecret: own.clientSecret }
  const env = getEnv()
  return env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET ? { clientId: env.SLACK_CLIENT_ID, clientSecret: env.SLACK_CLIENT_SECRET } : undefined
}

/** Whether "Add to Slack" works on this server without bringing your own app. */
export function slackAppReady() {
  const env = getEnv()
  return !!(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET)
}

function slackAppMissing() {
  return invalid(
    "This Brainspace server doesn't have a Slack app set up, so Add to Slack isn't available.",
    'Connect with a bot token instead (authType "bearer", token "xoxb-..."), or pass oauthClientId and oauthClientSecret from your own Slack app. Setup: docs/slack-app.md.',
  )
}

async function storedSlackToken(conn: ConnRow) {
  const { data } = await loadCredential(conn, '')
  return (data.headers?.Authorization ?? '').replace(/^Bearer\s+/i, '') || undefined
}

async function startSlackInstall(actor: Actor, conn: ConnRow) {
  requireRole(actor, 'member', 'install Slack')
  const client = await slackClient(conn.oauthClient)
  if (!client) throw slackAppMissing()
  const state = randomToken(24)
  // Keep the current token, if any, so posts keep working until the new install lands.
  const { data } = await loadCredential(conn, '')
  await saveCredential(conn, '', { ...data, slackInstallBy: actor.userId, slackInstallAt: Date.now() }, state)
  return slackAuthorizeUrl(client.clientId, callbackUrl(), state)
}

async function finishSlackInstall(conn: ConnRow, encrypted: string | null, code: string, userId: string | undefined) {
  // Tie the install to the browser that started it, so an Add to Slack link can't be
  // passed to someone in another company to connect their Slack to this workspace.
  const pending = (await decryptJson<CredentialData>(encrypted)) ?? {}
  if (!userId || userId !== pending.slackInstallBy) {
    throw forbidden('Finish adding Slack in the browser where you started it, signed in to Brainspace as the same person.')
  }
  if (!pending.slackInstallAt || Date.now() - pending.slackInstallAt > 60 * 60 * 1000) {
    throw invalid('This Add to Slack link expired. Start again from Connections.')
  }
  // They may have been removed or made read-only since they started.
  const [m] = await getDb()
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.workspaceId, conn.workspaceId), eq(member.userId, userId)))
  if (!m || ROLE_RANK[m.role] < ROLE_RANK.member) throw forbidden('Only members and admins of this Brainspace workspace can add Slack.')
  const client = await slackClient(conn.oauthClient)
  if (!client) throw slackAppMissing()
  const got = await exchangeSlackCode(client, code, callbackUrl())
  const install = { ...(await describeSlackToken(got.token)), appId: got.appId, scope: got.scope }
  await saveCredential(conn, '', { headers: { Authorization: `Bearer ${got.token}` }, slack: install }, null)
  await getDb()
    .update(connection)
    .set({ authType: 'oauth', status: 'active', statusMessage: null, updatedAt: new Date(), ...(install.url ? { url: install.url } : {}) })
    .where(eq(connection.id, conn.id))
  return { connectionId: conn.id, workspaceId: conn.workspaceId, name: `${conn.name} (${install.teamName})` }
}

async function callSlack(actor: Actor, conn: ConnRow, tool: string, args: Record<string, unknown>): Promise<CallResult> {
  const { data } = await loadCredential(conn, '')
  const token = (data.headers?.Authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!token) {
    throw new AppError('unauthorized', `${conn.name} isn't installed in a Slack workspace yet.`, { hint: reauthHint(conn) })
  }
  const files = await import('./files')
  const result = await runSlackTool({ token, botName: data.slack?.botName, readFile: (p) => files.readBytes(actor, p) }, tool, args)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result }
}

/** Tools defined by Brainspace itself rather than listed by an upstream server. */
function builtinTools(conn: ConnRow): CachedTool[] | null {
  if (conn.type === 'http') return httpTools(conn)
  if (conn.type === 'slack') return slackToolDefs().map((t) => ({ ...t, exposedName: `${conn.slug}${TOOL_SEP}${t.name}` }))
  return null
}

// ---------------------------------------------------------------------------
// Talking to upstream servers

const SEARCH_MODE_THRESHOLD = 30
const RESULT_CHAR_LIMIT = 40_000
const MODERN_SESSION_TTL_MS = 1000 * 60 * 60 * 24
const LEGACY_SESSION_TTL_MS = 1000 * 60 * 60

/**
 * What we learned from the last handshake with an upstream, so later calls can
 * skip it. Stored per credential (never shared across credentials).
 */
type UpstreamSession =
  | { kind: 'modern'; discover: DiscoverResult; at: number }
  | { kind: 'legacy'; sessionId?: string; protocolVersion?: string; at: number }
  | { kind: 'sse'; at: number }

type CredentialWithSession = CredentialData & { session?: UpstreamSession }

async function saveSession(conn: ConnRow, key: string, session: UpstreamSession | undefined) {
  const { data } = await loadCredential(conn, key)
  const next = { ...(data as CredentialWithSession), session }
  await saveCredential(conn, key, next)
}

function freshSession(s: UpstreamSession | undefined) {
  if (!s) return undefined
  const ttl = s.kind === 'modern' ? MODERN_SESSION_TTL_MS : LEGACY_SESSION_TTL_MS
  return Date.now() - s.at < ttl ? s : undefined
}

async function connectClient(conn: ConnRow, key: string, opts: { fresh?: boolean } = {}) {
  const { data } = await loadCredential(conn, key)
  const headers = data.headers ?? {}
  const provider = conn.authType === 'oauth' ? new DbOAuthProvider(conn, key, data, await staticClientFor(conn)) : undefined
  const url = new URL(conn.url)
  const cached = opts.fresh ? undefined : freshSession((data as CredentialWithSession).session)
  const requestInit = { headers, signal: AbortSignal.timeout(120_000) }

  if (cached?.kind === 'sse') {
    const client = new Client({ name: 'brainspace', version: '1.0.0' })
    await client.connect(new SSEClientTransport(url, { authProvider: provider, requestInit: { headers } }))
    return { client, reused: false }
  }

  const client = new Client({ name: 'brainspace', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } } as never)
  const transport = new StreamableHTTPClientTransport(url, {
    authProvider: provider,
    requestInit,
    ...(cached?.kind === 'legacy' && cached.sessionId ? { sessionId: cached.sessionId } : {}),
  })
  try {
    if (cached?.kind === 'modern') {
      await client.connect(transport, { prior: { kind: 'modern', discover: cached.discover } })
      return { client, reused: true }
    }
    if (cached?.kind === 'legacy' && cached.sessionId) {
      if (cached.protocolVersion) transport.setProtocolVersion(cached.protocolVersion)
      await client.connect(transport, { prior: { kind: 'legacy' } })
      return { client, reused: true }
    }
    await client.connect(transport)
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err
    const msg = String((err as Error)?.message ?? err)
    if (!/40[45]|Method Not Allowed|Not Found/i.test(msg)) throw err
    const fallback = new Client({ name: 'brainspace', version: '1.0.0' })
    await fallback.connect(new SSEClientTransport(url, { authProvider: provider, requestInit: { headers } }))
    background(saveSession(conn, key, { kind: 'sse', at: Date.now() }))
    return { client: fallback, reused: false }
  }
  const discover = client.getDiscoverResult()
  const session: UpstreamSession = discover
    ? { kind: 'modern', discover, at: Date.now() }
    : { kind: 'legacy', sessionId: transport.sessionId, protocolVersion: client.getNegotiatedProtocolVersion(), at: Date.now() }
  background(saveSession(conn, key, session))
  return { client, reused: false }
}

/** Run something against an upstream, reusing the cached handshake and retrying once if it went stale. */
async function withClient<T>(conn: ConnRow, key: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const { client, reused } = await connectClient(conn, key)
  try {
    return await fn(client)
  } catch (err) {
    if (!reused || err instanceof UnauthorizedError || /401|unauthori[sz]ed|invalid_token/i.test(String(err))) throw err
    // A cached session can expire upstream (404) or the server can have upgraded.
    await client.close().catch(() => {})
    const again = await connectClient(conn, key, { fresh: true })
    try {
      return await fn(again.client)
    } finally {
      await again.client.close().catch(() => {})
    }
  } finally {
    await client.close().catch(() => {})
  }
}

const AUTH_FAILURE = /\b401\b|unauthori[sz]ed|invalid[_ ]token|token (has )?expired|expired token|authentication (failed|required)/i

function upstreamError(conn: ConnRow, err: unknown, _actor?: Actor) {
  if (err instanceof AppError) return err
  if (err instanceof UnauthorizedError || AUTH_FAILURE.test(String(err))) {
    return new AppError('unauthorized', `${conn.name} rejected Brainspace's credentials.`, { hint: reauthHint(conn) })
  }
  return new AppError('upstream', `${conn.name} failed: ${String((err as Error)?.message ?? err).slice(0, 500)}`)
}

function reauthHint(conn: ConnRow) {
  if (conn.type === 'slack') return `An admin or member needs to reinstall Slack: call connection_authorize("${conn.slug}") and give them the link, or use Connections in Brainspace.`
  if (conn.authType !== 'oauth') return 'An admin or member needs to update the token with connection_update.'
  return conn.credentialMode === 'per_user'
    ? `Call connection_authorize("${conn.slug}") and give the user the link to reconnect their own account, then retry.`
    : `Call connection_authorize("${conn.slug}") and give the user the link to re-authorize the team's account, then retry.`
}

function fnv(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36).padStart(6, '0').slice(-6)
}

/** Give every tool a unique, valid (<=64 chars, [A-Za-z0-9_-]) name agents can call. */
function assignExposedNames(conn: ConnRow, tools: CachedTool[]): CachedTool[] {
  const used = new Set<string>()
  return tools.map((t) => {
    let name = `${conn.slug}${TOOL_SEP}${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_')
    if (name.length > 64 || used.has(name)) {
      const room = 64 - conn.slug.length - TOOL_SEP.length - 7
      name = `${conn.slug}${TOOL_SEP}${t.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, room)}_${fnv(t.name)}`
    }
    used.add(name)
    return { ...t, exposedName: name }
  })
}

function cleanSchema(schema: unknown): Record<string, Json> {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} }
  const { $schema: _drop, ...rest } = schema as Record<string, Json>
  return rest.type === 'object' ? rest : { type: 'object', properties: {} }
}

async function fetchTools(conn: ConnRow, key: string) {
  return withClient(conn, key, async (client) => {
    const tools: CachedTool[] = []
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const res = await client.listTools(cursor ? { cursor } : undefined, { cacheMode: 'bypass' } as never)
      for (const t of res.tools) {
        tools.push({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: cleanSchema(t.inputSchema),
          ...(t.outputSchema ? { outputSchema: cleanSchema(t.outputSchema) } : {}),
          annotations: t.annotations as Record<string, Json> | undefined,
        })
      }
      cursor = res.nextCursor
      if (!cursor) break
    }
    return { tools: assignExposedNames(conn, tools), instructions: client.getInstructions() ?? null }
  })
}

async function cacheTools(conn: ConnRow, fetched: { tools: CachedTool[]; instructions: string | null }) {
  await getDb()
    .update(connection)
    .set({
      toolsCache: fetched.tools,
      toolsCachedAt: new Date(),
      upstreamInstructions: fetched.instructions?.slice(0, 4000) ?? null,
      status: 'active',
      statusMessage: null,
    })
    .where(eq(connection.id, conn.id))
}

export async function refreshTools(actor: Actor, connOrId: ConnRow | string) {
  const conn = typeof connOrId === 'string' ? await requireConn(actor, connOrId) : connOrId
  const builtin = builtinTools(conn)
  if (builtin) return builtin
  try {
    const fetched = await fetchTools(conn, credentialKey(conn, actor.userId))
    await cacheTools(conn, fetched)
    return fetched.tools
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
      exposedName: `${conn.slug}${TOOL_SEP}request`,
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
  const all = builtinTools(conn) ?? conn.toolsCache ?? []
  if (conn.type === 'mcp' && conn.status === 'active' && (!conn.toolsCachedAt || Date.now() - conn.toolsCachedAt.getTime() > TOOLS_TTL_MS)) {
    background(refreshTools(actor, conn).catch(() => {}))
  }
  const named = all.some((t) => !t.exposedName) ? assignExposedNames(conn, all) : all
  return named
    .filter((t) => toolAllowed(conn, t.name))
    .filter((t) => actor.role !== 'viewer' || isReadOnlyTool(conn, t, t.name) || conn.type === 'http')
}

/** Whether a connection's tools are listed directly, or found through connection_tools. */
export function effectiveToolMode(conn: ConnRow): 'direct' | 'search' {
  if (!conn.exposeTools) return 'search'
  if (conn.toolMode !== 'auto') return conn.toolMode
  return (conn.toolsCache?.length ?? 0) > SEARCH_MODE_THRESHOLD ? 'search' : 'direct'
}

export async function usableConnections(actor: Actor) {
  const rows = await getDb().select().from(connection).where(eq(connection.workspaceId, actor.workspaceId))
  const access = await accessSets(rows.map((r) => r.id))
  return rows.filter((c) => canUseConnection(actor, c, access.get(c.id) ?? new Set()))
}

function oneLine(desc: string | undefined, max = 180) {
  const first = (desc ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? ''
  return first.length > max ? first.slice(0, max - 1) + '…' : first
}

const tokenize = (s: string) =>
  s
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)

/** BM25 over tool names and descriptions. Plenty for a few hundred cached tools. */
function rankTools<T extends { text: string }>(items: T[], query: string, limit: number) {
  const q = [...new Set(tokenize(query))]
  if (!q.length) return items.slice(0, limit)
  const docs = items.map((i) => tokenize(i.text))
  const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, docs.length)
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.includes(t)).length]))
  return items
    .map((item, i) => {
      const d = docs[i]!
      let score = 0
      for (const t of q) {
        const tf = d.filter((x) => x === t).length
        if (!tf) continue
        const idf = Math.log(1 + (items.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
        score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.length / avg))))
      }
      return { item, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item)
}

/** Search (or list) tools across every connection the actor can use. */
export async function searchTools(actor: Actor, opts: { query?: string; connection?: string; limit?: number } = {}) {
  let conns = await usableConnections(actor)
  if (opts.connection) {
    const key = opts.connection.toLowerCase()
    conns = conns.filter((c) => c.id === opts.connection || c.slug === key)
    if (!conns.length) throw notFound(`Connection "${opts.connection}"`, 'Use connections_list to see what you can use.')
  }
  const items = []
  for (const c of conns) {
    if (c.type === 'mcp' && !c.toolsCache && c.status === 'active') await refreshTools(actor, c).catch(() => {})
    for (const t of await toolsFor(actor, c)) {
      items.push({
        connection: c.slug,
        tool: t.name,
        callAs: effectiveToolMode(c) === 'direct' && c.status === 'active' ? t.exposedName : undefined,
        summary: oneLine(t.description),
        readOnly: isReadOnlyTool(c, t, t.name),
        text: `${t.name} ${t.title ?? ''} ${t.description ?? ''} ${c.name}`,
      })
    }
  }
  const limit = Math.min(opts.limit ?? (opts.query ? 15 : 200), 200)
  const ranked = opts.query ? rankTools(items, opts.query, limit) : items.slice(0, limit)
  return {
    connections: conns.map((c) => ({
      slug: c.slug,
      name: c.name,
      status: c.status,
      mode: effectiveToolMode(c),
      instructions: [c.instructions, c.upstreamInstructions].filter(Boolean).join('\n\n') || undefined,
    })),
    tools: ranked.map(({ text: _text, ...rest }) => rest),
    next: 'Call connection_describe for the full input schema, then connection_call (or the callAs name when present).',
  }
}

export async function describeTools(actor: Actor, idOrSlug: string, names: string[]) {
  const conn = await requireConn(actor, idOrSlug)
  const access = await accessSets([conn.id])
  if (!canUseConnection(actor, conn, access.get(conn.id) ?? new Set())) {
    throw forbidden(`You don't have access to ${conn.name}.`, 'Ask an admin to grant you access.')
  }
  const tools = await toolsFor(actor, conn)
  return names.slice(0, 10).map((n) => {
    const t = tools.find((x) => x.name === n || x.exposedName === n)
    if (!t) return { tool: n, error: `Not found on ${conn.slug}. Use connection_tools to search.` }
    return {
      connection: conn.slug,
      tool: t.name,
      callAs: effectiveToolMode(conn) === 'direct' ? t.exposedName : undefined,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      readOnly: isReadOnlyTool(conn, t, t.name),
    }
  })
}

export function proxiedToolName(conn: ConnRow, tool: CachedTool) {
  return tool.exposedName ?? assignExposedNames(conn, [tool])[0]!.exposedName!
}

export async function listToolsFor(actor: Actor, idOrSlug: string) {
  const conn = await requireConn(actor, idOrSlug)
  const access = await accessSets([conn.id])
  if (!canUseConnection(actor, conn, access.get(conn.id) ?? new Set())) {
    throw forbidden(`You don't have access to ${conn.name}.`, 'Ask an admin to grant you access.')
  }
  if (conn.type === 'mcp' && !conn.toolsCache) await refreshTools(actor, conn).catch(() => {})
  const fresh = await requireConn(actor, conn.id)
  const direct = effectiveToolMode(fresh) === 'direct'
  return {
    connection: { slug: fresh.slug, name: fresh.name, status: fresh.status, mode: effectiveToolMode(fresh), instructions: fresh.instructions, upstreamInstructions: fresh.upstreamInstructions },
    tools: (await toolsFor(actor, fresh)).map((t) => ({ ...t, proxiedName: direct ? proxiedToolName(fresh, t) : undefined })),
  }
}

type CallResult = { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown; [k: string]: unknown }

function resultText(r: CallResult) {
  return (r.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('\n')
}

/** Large upstream results go to R2; the agent gets the head and a handle to page through the rest. */
async function capResult(actor: Actor, conn: ConnRow, tool: string, r: CallResult): Promise<CallResult> {
  const text = resultText(r)
  const structured = r.structuredContent ? JSON.stringify(r.structuredContent) : ''
  if (text.length <= RESULT_CHAR_LIMIT && structured.length <= RESULT_CHAR_LIMIT) return r
  const full = text.length >= structured.length ? text : structured
  const id = newId('res')
  await getEnv().FILES.put(`tmp/results/${actor.workspaceId}/${actor.userId}/${id}.txt`, full, {
    customMetadata: { connection: conn.slug, tool },
  })
  let head = full.slice(0, RESULT_CHAR_LIMIT)
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1)
  return {
    isError: r.isError,
    content: [
      { type: 'text', text: head },
      {
        type: 'text',
        text: `[Brainspace truncated this result: showing ${head.length.toLocaleString()} of ${full.length.toLocaleString()} characters. Call connection_result with id "${id}" and offset ${head.length} to read more. Kept for 24 hours.]`,
      },
    ],
  }
}

export async function readStoredResult(actor: Actor, id: string, opts: { offset?: number; limit?: number } = {}) {
  if (!/^res_[a-z0-9]+$/.test(id)) throw invalid('That is not a result id.')
  const obj = await getEnv().FILES.get(`tmp/results/${actor.workspaceId}/${actor.userId}/${id}.txt`)
  if (!obj) throw notFound('That result', 'Results are kept for 24 hours. Call the tool again.')
  const full = await obj.text()
  const offset = Math.max(0, opts.offset ?? 0)
  const limit = Math.min(opts.limit ?? RESULT_CHAR_LIMIT, RESULT_CHAR_LIMIT)
  const chunk = full.slice(offset, offset + limit)
  return {
    id,
    offset,
    returned: chunk.length,
    total: full.length,
    nextOffset: offset + chunk.length < full.length ? offset + chunk.length : null,
    text: chunk,
  }
}

export async function callConnectionTool(actor: Actor, idOrSlug: string, toolName: string, rawArgs: Record<string, unknown> | string = {}) {
  const conn = await requireConn(actor, idOrSlug)
  const access = await accessSets([conn.id])
  if (!canUseConnection(actor, conn, access.get(conn.id) ?? new Set())) {
    throw forbidden(`You don't have access to ${conn.name}.`, 'Ask an admin to grant you access.')
  }
  let args: Record<string, unknown>
  try {
    args = typeof rawArgs === 'string' ? (rawArgs.trim() ? JSON.parse(rawArgs) : {}) : (rawArgs ?? {})
  } catch {
    throw invalid('arguments is not valid JSON.', 'Pass an object, or a JSON string of one.')
  }
  const cachedAll = builtinTools(conn) ?? conn.toolsCache ?? []
  const cached = cachedAll.find((t) => t.name === toolName || t.exposedName === toolName)
  if (cached) toolName = cached.name
  if (!toolAllowed(conn, toolName)) throw forbidden(`${toolName} is turned off for ${conn.name} in this workspace.`)
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
    if (conn.type === 'http') return await capResult(actor, conn, toolName, await callHttp(conn, args))
    if (conn.type === 'slack') return await capResult(actor, conn, toolName, await callSlack(actor, conn, toolName, args))
    const key = credentialKey(conn, actor.userId)
    const result = (await withClient(conn, key, (client) =>
      client.callTool({ name: toolName, arguments: args }, { timeout: 120_000 } as never),
    )) as CallResult
    if (result.isError && AUTH_FAILURE.test(resultText(result).slice(0, 2000))) {
      // Many servers report expired auth as a tool error instead of an HTTP 401.
      ok = false
      if (conn.credentialMode === 'shared') await markStatus(conn, 'needs_auth', `${conn.name} rejected the stored credentials.`)
      return {
        ...result,
        content: [...(result.content ?? []), { type: 'text', text: `[Brainspace: ${conn.name} rejected the credentials. ${reauthHint(conn)}]` }],
      }
    }
    if (result.isError) ok = false
    return await capResult(actor, conn, toolName, result)
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

async function callHttp(conn: ConnRow, args: Record<string, unknown>): Promise<CallResult> {
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
  return {
    content: [{ type: 'text', text: `HTTP ${res.status} ${res.statusText}\n\n${await res.text()}` }],
    isError: !res.ok,
  }
}

export async function testConnection(actor: Actor, idOrSlug: string) {
  const conn = await requireConn(actor, idOrSlug)
  if (conn.type === 'http') return { ok: true, tools: 1 }
  if (conn.type === 'slack') {
    const token = await storedSlackToken(conn)
    if (!token) throw new AppError('unauthorized', `${conn.name} isn't installed in a Slack workspace yet.`, { hint: reauthHint(conn) })
    try {
      const install = await describeSlackToken(token)
      const { data } = await loadCredential(conn, '')
      await saveCredential(conn, '', { ...data, slack: { ...data.slack, ...install } })
      await getDb()
        .update(connection)
        .set({ status: 'active', statusMessage: null, ...(install.url ? { url: install.url } : {}) })
        .where(eq(connection.id, conn.id))
      return { ok: true, tools: slackToolDefs().length, slackWorkspace: install.teamName, postsAs: install.botName }
    } catch (err) {
      const e = upstreamError(conn, err)
      if (e.code === 'unauthorized') await markStatus(conn, 'needs_auth', e.message)
      throw e
    }
  }
  const tools = await refreshTools(actor, conn)
  return { ok: true, tools: tools.length }
}

/**
 * An API key for Context.dev's REST API: the workspace's own Context.dev
 * connection when it uses a key, otherwise the platform key (if configured).
 */
export async function contextDevKeyFor(workspaceId: string): Promise<string | null> {
  const rows = await getDb().select().from(connection).where(eq(connection.workspaceId, workspaceId))
  const ctx = rows.find(
    (c) => (c.presetId === 'context-dev' || /(^|\.)context\.dev/.test(new URL(c.url).hostname)) && c.authType === 'bearer',
  )
  if (ctx) {
    const { data } = await loadCredential(ctx, '')
    const auth = data.headers?.Authorization ?? data.headers?.authorization
    if (auth) return auth.replace(/^Bearer\s+/i, '')
  }
  return getEnv().CONTEXT_DEV_API_KEY ?? null
}

/** For flows: identify a connection and whether a tool call only reads. */
export async function connectionToolInfo(actor: Actor, ref: string, toolName: string, args: Record<string, unknown>) {
  const rows = await getDb().select().from(connection).where(eq(connection.workspaceId, actor.workspaceId))
  const k = ref.trim().toLowerCase()
  const conn = rows.find((r) => r.id === ref || r.slug === k || r.name.toLowerCase() === k || r.presetId === k)
  if (!conn) throw notFound(`Connection "${ref}"`, 'Use connections_list to see what is connected.')
  const cached = (builtinTools(conn) ?? conn.toolsCache ?? []).find((t) => t.name === toolName || t.exposedName === toolName)
  const readOnly = conn.type === 'http' ? String(args.method ?? 'GET').toUpperCase() === 'GET' : isReadOnlyTool(conn, cached, cached?.name ?? toolName)
  return { id: conn.id, slug: conn.slug, name: conn.name, presetId: conn.presetId, type: conn.type, readOnly }
}
