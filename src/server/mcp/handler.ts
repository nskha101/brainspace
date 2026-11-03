import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'
import { Server, createMcpHandler } from '@modelcontextprotocol/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Actor } from '../actor'
import { getAuth } from '../auth'
import { getDb, oauthClient, oauthConsent, user } from '../db'
import { appUrl } from '../env'
import { AppError } from '../errors'
import * as conns from '../services/connections'
import { getSkill, listSkills } from '../services/skills'
import * as files from '../services/files'
import { actorFor, authenticateApiKey, defaultWorkspaceId, listWorkspaces } from '../services/workspaces'
import { AGENT_SKILLS, INSTRUCTIONS, skillDescription } from './guide'
import { errorResult, toolResult, visibleTools, type ToolDef } from './tools'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
}

function withCors(res: Response) {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v)
  return out
}

function unauthorized(message: string) {
  return withCors(
    new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${appUrl()}/.well-known/oauth-protected-resource/mcp"`,
      },
    }),
  )
}

let jwks: { at: number; set: ReturnType<typeof createLocalJWKSet> } | undefined

async function verifyJwt(token: string) {
  if (!jwks || Date.now() - jwks.at > 5 * 60_000) {
    const keys = (await getAuth().api.getJwks()) as unknown as JSONWebKeySet
    jwks = { at: Date.now(), set: createLocalJWKSet(keys) }
  }
  const { payload } = await jwtVerify(token, jwks.set, { audience: `${appUrl()}/mcp` })
  return payload
}

async function authenticate(req: Request): Promise<Actor | Response> {
  const header = req.headers.get('authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) return unauthorized('Sign in to Brainspace to use this MCP server.')
  const clientName = req.headers.get('x-brainspace-client') ?? undefined
  const wsOverride = req.headers.get('x-brainspace-workspace')

  if (token.startsWith('bs_')) {
    const key = await authenticateApiKey(token)
    if (!key) return unauthorized('That API key is invalid or revoked.')
    try {
      return await actorFor(key.user, key.workspaceId, 'mcp', clientName ?? key.keyName)
    } catch {
      return unauthorized('The owner of this API key is no longer in its workspace.')
    }
  }

  let claims
  try {
    claims = await verifyJwt(token)
  } catch {
    return unauthorized('Access token is invalid or expired.')
  }
  const userId = String(claims.sub ?? '')
  const [u] = await getDb().select().from(user).where(eq(user.id, userId))
  if (!u) return unauthorized('Unknown user.')
  const clientId = String(claims.azp ?? claims.client_id ?? '')
  let oauthClientName: string | undefined
  if (clientId) {
    const [c] = await getDb().select({ name: oauthClient.name }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1)
    oauthClientName = c?.name ?? undefined
    // Disconnecting an agent in the app deletes its consent; honor that before the token expires.
    const [consent] = await getDb()
      .select({ id: oauthConsent.id })
      .from(oauthConsent)
      .where(and(eq(oauthConsent.userId, u.id), eq(oauthConsent.clientId, clientId)))
      .limit(1)
    if (!consent) return unauthorized('This agent was disconnected. Sign in again.')
  }
  let workspaceId: string | undefined
  if (wsOverride) {
    const all = await listWorkspaces(u.id)
    workspaceId = all.find((w) => w.slug === wsOverride || w.id === wsOverride)?.id
  }
  workspaceId ??= await defaultWorkspaceId(u.id)
  if (!workspaceId) {
    return withCors(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32002, message: `You're not in a Brainspace workspace yet. Open ${appUrl()} to create one or accept an invite.` },
          id: null,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    )
  }
  return actorFor(u, workspaceId, 'mcp', clientName ?? oauthClientName ?? (clientId || undefined))
}

type ProxyTool = { conn: Awaited<ReturnType<typeof conns.usableConnections>>[number]; tool: string }

async function buildServer(actor: Actor, clientInfoName?: string) {
  if (clientInfoName && !actor.clientName) actor.clientName = clientInfoName
  const server = new Server(
    { name: 'brainspace', version: '1.0.0', title: 'Brainspace' },
    { capabilities: { tools: {}, prompts: {}, resources: {} }, instructions: INSTRUCTIONS },
  )
  const own = visibleTools(actor)
  const byName = new Map<string, ToolDef>(own.map((t) => [t.name, t]))

  // Connections in "direct" mode list their tools here as <slug>__<tool>. Big ones
  // ("search" mode) stay out of the list; agents find them with connection_tools.
  const proxies = new Map<string, ProxyTool>()
  const proxyDefs: Record<string, unknown>[] = []
  for (const conn of await conns.usableConnections(actor)) {
    if (conn.status !== 'active' || conns.effectiveToolMode(conn) !== 'direct') continue
    for (const t of await conns.toolsFor(actor, conn)) {
      const name = conns.proxiedToolName(conn, t)
      if (byName.has(name) || proxies.has(name)) continue
      proxies.set(name, { conn, tool: t.name })
      proxyDefs.push({
        name,
        title: `${conn.name}: ${t.title ?? t.name}`,
        description: `[${conn.name}] ${t.description ?? ''}${conn.instructions ? `\n\nTeam note: ${conn.instructions}` : ''}`.slice(0, 4000),
        inputSchema: t.inputSchema,
        ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
        annotations: t.annotations,
      })
    }
  }

  server.setRequestHandler('tools/list', async () => ({
    tools: [
      ...own.map((t) => {
        const schema = z.toJSONSchema(t.schema, { io: 'input' }) as Record<string, unknown>
        delete schema.$schema
        return {
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: schema as { type: 'object' },
          annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false },
        }
      }),
      ...(proxyDefs as never[]),
    ],
  }))

  server.setRequestHandler('tools/call', async (req) => {
    const { name, arguments: args = {} } = req.params
    const def = byName.get(name)
    try {
      if (def) {
        const parsed = def.schema.parse(args)
        return toolResult(await def.run(actor, parsed)) as never
      }
      const proxy = proxies.get(name)
      if (proxy) return (await conns.callConnectionTool(actor, proxy.conn.id, proxy.tool, args as Record<string, unknown>)) as never
      throw new AppError('not_found', `Unknown tool "${name}".`, { hint: 'Call tools/list again; your role or connections may have changed.' })
    } catch (err) {
      return errorResult(err) as never
    }
  })

  server.setRequestHandler('prompts/list', async () => {
    const skills = await listSkills(actor)
    return {
      prompts: [
        { name: 'brainspace', title: 'Use Brainspace', description: 'Orientation: how to work with the team brain.' },
        // The agent skills that ship with Brainspace, for clients without skill support.
        ...Object.entries(AGENT_SKILLS)
          .filter(([n]) => n !== 'brainspace')
          .map(([n, md]) => ({ name: n, title: n.replace('brainspace-', 'Brainspace: '), description: skillDescription(md) })),
        ...skills.map((s) => ({
          name: `skill_${s.name}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
          title: `Skill: ${s.name}${s.drive === 'me' ? ' (private)' : ''}`,
          description: s.description,
        })),
      ],
    }
  })

  server.setRequestHandler('prompts/get', async (req) => {
    const name = req.params.name
    if (name === 'brainspace') {
      return { messages: [{ role: 'user', content: { type: 'text', text: `${INSTRUCTIONS}\n\n${AGENT_SKILLS['brainspace'] ?? ''}` } }] }
    }
    if (AGENT_SKILLS[name]) {
      return {
        description: skillDescription(AGENT_SKILLS[name]!),
        messages: [{ role: 'user', content: { type: 'text', text: `Follow this Brainspace skill:\n\n${AGENT_SKILLS[name]}` } }],
      }
    }
    const skills = await listSkills(actor)
    const s = skills.find((x) => `skill_${x.name}`.replace(/[^a-zA-Z0-9_-]/g, '_') === name)
    if (!s) throw new Error(`Unknown prompt ${name}`)
    const full = await getSkill(actor, s.name)
    return {
      description: s.description,
      messages: [{ role: 'user', content: { type: 'text', text: `Follow this team skill (${full.path}):\n\n${full.content}` } }],
    }
  })

  server.setRequestHandler('resources/templates/list', async () => ({
    resourceTemplates: [
      { uriTemplate: 'brain://team/{+path}', name: 'Team drive file', mimeType: 'text/markdown' },
      { uriTemplate: 'brain://me/{+path}', name: 'Private drive file', mimeType: 'text/markdown' },
    ],
  }))

  server.setRequestHandler('resources/list', async () => {
    const recent = await files.recent(actor, { limit: 50 })
    return {
      resources: recent
        .filter((r) => r.kind === 'doc')
        .map((r) => ({ uri: `brain:/${r.path}`, name: r.path, mimeType: r.mimeType ?? 'text/markdown', description: r.description ?? undefined })),
    }
  })

  server.setRequestHandler('resources/read', async (req) => {
    const p = req.params.uri.replace(/^brain:\/\//, '/')
    const r = await files.read(actor, p)
    if ('content' in r) return { contents: [{ uri: req.params.uri, mimeType: r.mimeType ?? 'text/markdown', text: r.content ?? '' }] }
    if ('downloadUrl' in r) return { contents: [{ uri: req.params.uri, mimeType: 'text/plain', text: `Download: ${r.downloadUrl}` }] }
    return { contents: [{ uri: req.params.uri, mimeType: 'text/plain', text: 'Folder' }] }
  })

  return server
}

export async function handleMcp(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method === 'GET' && !(req.headers.get('accept') ?? '').includes('text/event-stream')) {
    return withCors(
      new Response(
        JSON.stringify({
          name: 'Brainspace MCP',
          endpoint: `${appUrl()}/mcp`,
          auth: 'OAuth 2.1 (discovery via /.well-known/oauth-protected-resource) or Authorization: Bearer bs_<api key>',
          docs: `${appUrl()}/docs`,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    )
  }
  const actor = await authenticate(req)
  if (actor instanceof Response) return actor
  const handler = createMcpHandler(() => buildServer(actor), {
    onerror: (err: unknown) => console.error('[mcp]', err),
  } as never)
  try {
    return withCors(await handler.fetch(req))
  } catch (err) {
    console.error('[mcp] handler failed', err)
    return withCors(
      new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }
}
