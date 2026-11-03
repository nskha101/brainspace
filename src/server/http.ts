import { and, eq } from 'drizzle-orm'
import { canReadDrive } from './actor'
import { getAuth } from './auth'
import { hmacVerify } from './crypto'
import { getDb, node, nodeVersion } from './db'
import { appUrl, getEnv } from './env'
import { AppError } from './errors'
import { handleMcp } from './mcp/handler'
import { clientMetadataDocument, finishOAuth } from './services/connections'
import { upload } from './services/files'
import { connectLive } from './live'
import { sessionUser, webActor } from './web-actor'
import { actorFor } from './services/workspaces'

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })

function errorResponse(err: unknown) {
  if (err instanceof AppError) return json(err.toJSON(), err.status)
  console.error('[http]', err)
  return json({ error: 'internal', message: String((err as Error)?.message ?? err) }, 500)
}

async function serveFile(req: Request, id: string) {
  const url = new URL(req.url)
  const v = url.searchParams.get('v')
  const exp = url.searchParams.get('exp')
  const sig = url.searchParams.get('sig')
  const db = getDb()
  const [n] = await db.select().from(node).where(eq(node.id, id))
  if (!n) return json({ error: 'not_found' }, 404)

  let allowed = false
  if (exp && sig) {
    allowed = Number(exp) * 1000 > Date.now() && (await hmacVerify(`${id}:${v ?? ''}:${exp}`, sig))
  } else {
    const u = await sessionUser(req.headers)
    if (u) {
      try {
        const actor = await actorFor(u, n.workspaceId, 'web')
        allowed = canReadDrive(actor, n.driveId)
      } catch {
        allowed = false
      }
    }
  }
  if (!allowed || (n.deletedAt && !v)) return json({ error: 'not_found' }, 404)

  let key = n.r2Key
  let text = n.content
  if (v && Number(v) !== n.version) {
    const [ver] = await db
      .select()
      .from(nodeVersion)
      .where(and(eq(nodeVersion.nodeId, n.id), eq(nodeVersion.version, Number(v))))
    if (!ver) return json({ error: 'not_found' }, 404)
    key = ver.r2Key
    text = ver.content
  }
  const headers: Record<string, string> = {
    'Content-Type': n.mimeType ?? 'application/octet-stream',
    'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="${encodeURIComponent(n.name)}"`,
    'Cache-Control': 'private, max-age=300',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  }
  if (n.kind === 'doc') return new Response(text ?? '', { headers })
  if (!key) return json({ error: 'not_found' }, 404)
  const obj = await getEnv().FILES.get(key)
  if (!obj) return json({ error: 'not_found' }, 404)
  return new Response(obj.body, { headers: { ...headers, 'Content-Length': String(obj.size) } })
}

async function handleUpload(req: Request) {
  const actor = await webActor(req.headers)
  const form = await req.formData()
  const file = form.get('file')
  const path = String(form.get('path') ?? '')
  if (!file || typeof file === 'string') throw new AppError('invalid', 'No file in the upload.')
  const res = await upload(actor, path, await file.arrayBuffer(), {
    mimeType: file.type || undefined,
    message: String(form.get('message') ?? '') || undefined,
  })
  return json(res)
}

async function handleCallback(req: Request) {
  const url = new URL(req.url)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  if (error || !state || !code) {
    return Response.redirect(`${appUrl()}/app/connections?error=${encodeURIComponent(url.searchParams.get('error_description') ?? error ?? 'Authorization was cancelled')}`, 302)
  }
  try {
    const r = await finishOAuth(state, code)
    return Response.redirect(`${appUrl()}/app/connections?connected=${encodeURIComponent(r.name)}`, 302)
  } catch (err) {
    return Response.redirect(`${appUrl()}/app/connections?error=${encodeURIComponent(String((err as Error).message ?? err))}`, 302)
  }
}

/** Routes that bypass TanStack Start. Returns undefined to fall through. */
export async function handleRaw(req: Request): Promise<Response | undefined> {
  const url = new URL(req.url)
  const p = url.pathname
  if (url.hostname.startsWith('www.')) {
    url.hostname = url.hostname.slice(4)
    return Response.redirect(url.toString(), 301)
  }
  try {
    if (p === '/mcp' || p === '/mcp/') return await handleMcp(req)
    if (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/openid-configuration') {
      // Older MCP clients look here instead of the issuer-path location.
      const alias = new URL(p === '/.well-known/openid-configuration' ? '/api/auth/.well-known/openid-configuration' : `${p}/api/auth`, url)
      return await getAuth().handler(new Request(alias, req))
    }
    if (p.startsWith('/api/auth/') || (p.startsWith('/.well-known/') && !p.startsWith('/.well-known/agent-skills'))) {
      return await getAuth().handler(req)
    }
    if (p === '/oauth/client-metadata.json') {
      return json(clientMetadataDocument(), 200, { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' })
    }
    if (p.startsWith('/api/files/') && req.method === 'GET') return await serveFile(req, p.slice('/api/files/'.length))
    if (p === '/api/upload' && req.method === 'POST') return await handleUpload(req)
    if (p === '/api/live') {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a websocket' }, 426)
      return connectLive(req, await webActor(req.headers))
    }
    if (p === '/api/connections/callback') return await handleCallback(req)
  } catch (err) {
    return errorResponse(err)
  }
  return undefined
}
