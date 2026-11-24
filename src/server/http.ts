import { and, eq } from 'drizzle-orm'
import { canReadSpace } from './actor'
import { getAuth } from './auth'
import { hmacVerify } from './crypto'
import { getDb, node, nodeVersion, user } from './db'
import { appUrl, getEnv } from './env'
import { AppError } from './errors'
import { handleMcp } from './mcp/handler'
import { clientMetadataDocument, finishOAuth } from './services/connections'
import { signedPayload, upload } from './services/files'
import { connectLive } from './live'
import { receiveUpload } from './services/upload-links'
import { sessionUser, webActor } from './web-actor'
import { actorFor } from './services/workspaces'
import { accessView, canSee, canSeeTrashed } from './services/access'

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

  // Signed links (handed to agents) name the person they were made for. Either
  // way, check that person can still see the file right now.
  let who: { id: string; name: string; email: string } | null = null
  if (exp && sig) {
    const uid = url.searchParams.get('u')
    const valid =
      !!uid && !!v && Number(exp) * 1000 > Date.now() && (await hmacVerify(signedPayload(id, v, exp, uid), sig))
    if (valid) {
      const [u] = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.id, uid!))
      who = u ?? null
    }
  } else {
    who = await sessionUser(req.headers)
  }
  let allowed = false
  if (who) {
    try {
      const actor = await actorFor(who, n.workspaceId, 'web')
      const view = await accessView(actor)
      allowed = canReadSpace(actor, n.spaceId) && (n.deletedAt ? canSeeTrashed(view, n) : canSee(view, n.spaceId, n.path))
    } catch {
      allowed = false
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

/**
 * Uploads through an upload link. Agents use `curl -T file "<url>?name=file"`
 * (PUT, raw body); the upload page posts multipart forms with relPath.
 */
async function handleLinkUpload(req: Request, token: string) {
  const url = new URL(req.url)
  if (req.method === 'PUT') {
    const name = url.searchParams.get('name') ?? decodeURIComponent(url.pathname.split('/').slice(4).join('/') || '')
    const type = req.headers.get('content-type')
    const res = await receiveUpload(token, {
      data: await req.arrayBuffer(),
      relPath: name,
      mimeType: type && !/octet-stream|x-www-form-urlencoded/.test(type) ? type : undefined,
    })
    return json(res)
  }
  if (req.method === 'POST') {
    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') throw new AppError('invalid', 'No file in the upload.')
    const res = await receiveUpload(token, {
      data: await file.arrayBuffer(),
      relPath: String(form.get('relPath') || file.name),
      mimeType: file.type || undefined,
    })
    return json(res)
  }
  return json({ error: 'Use PUT (curl -T) or POST a multipart form.' }, 405)
}

/**
 * The page an OAuth sign-in returns to. The welcome flow sets a short-lived cookie so people come
 * back to it; anything else, or anything that isn't a path on this site, goes to Connections.
 */
function connectReturn(req: Request, query: string) {
  const raw = /(?:^|;\s*)bs_connect_return=([^;]*)/.exec(req.headers.get('cookie') ?? '')?.[1]
  let back = '/app/connections'
  try {
    const p = raw ? decodeURIComponent(raw) : ''
    if (/^\/(?!\/)[^\\\s]*$/.test(p)) back = p
  } catch {}
  const headers = new Headers({ Location: `${appUrl()}${back}${back.includes('?') ? '&' : '?'}${query}` })
  if (raw !== undefined) headers.append('Set-Cookie', 'bs_connect_return=; Path=/; Max-Age=0; SameSite=Lax')
  return new Response(null, { status: 302, headers })
}

async function handleCallback(req: Request) {
  const url = new URL(req.url)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  if (error || !state || !code) {
    return connectReturn(req, `error=${encodeURIComponent(url.searchParams.get('error_description') ?? error ?? 'Authorization was cancelled')}`)
  }
  try {
    const who = await sessionUser(req.headers).catch(() => null)
    const r = await finishOAuth(state, code, { userId: who?.id, iss: url.searchParams.get('iss') ?? undefined })
    return connectReturn(req, `connected=${encodeURIComponent(r.name)}`)
  } catch (err) {
    return connectReturn(req, `error=${encodeURIComponent(String((err as Error).message ?? err))}`)
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
  // Pasting both plugin commands at once makes Claude Code request
  // "/marketplace.json /plugin install ...". Send it to the real file.
  if (p.startsWith('/marketplace.json') && p !== '/marketplace.json') {
    return Response.redirect(`${url.origin}/marketplace.json`, 302)
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
    const dbExport = p.match(/^\/api\/db\/([A-Za-z0-9_-]+)\/export$/)
    if (dbExport && req.method === 'GET') {
      const { exportCsv } = await import('./services/databases')
      const csv = await exportCsv(await webActor(req.headers), dbExport[1]!, url.searchParams.get('table') ?? '')
      return new Response(csv.body, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(csv.filename)}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    const linkUpload = p.match(/^\/api\/u\/([A-Za-z0-9_-]+)(\/.*)?$/)
    if (linkUpload) return await handleLinkUpload(req, linkUpload[1]!)
    if (p === '/api/live') {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a websocket' }, 426)
      return connectLive(req, await webActor(req.headers))
    }
    if (p === '/api/connections/callback') return await handleCallback(req)
    if (p === '/api/slack/events' && req.method === 'POST') return await (await import('./services/slack-bots')).handleSlackEvents(req)
    const hook = p.match(/^\/api\/flows\/hook\/(bsh_[A-Za-z0-9_-]+)$/)
    if (hook) {
      if (req.method !== 'POST') return json({ error: 'POST JSON inputs to this URL to start a run.' }, 405)
      let text = await req.text()
      // Slack posts button clicks and other interactions as a form with the JSON in one field, `payload`.
      const form = (req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')
      if (form) text = new URLSearchParams(text).get('payload') ?? ''
      let body: unknown = {}
      if (text.trim()) {
        try {
          body = JSON.parse(text)
        } catch {
          return json({ error: 'invalid', message: form ? 'Send JSON in a form field named payload.' : 'Send a JSON body.' }, 400)
        }
      }
      // Slack sends an event again when it isn't answered within three seconds. The first delivery already started a run.
      if (req.headers.get('x-slack-retry-num')) return json({ status: 'duplicate' }, 200)
      const { handleWebhook } = await import('./services/flows')
      const started = await handleWebhook(hook[1]!, body)
      if ('challenge' in started) return new Response(started.challenge, { headers: { 'Content-Type': 'text/plain' } })
      // Slack shows the person an error unless an interaction is answered with a plain, empty 200.
      if (form) return new Response('', { status: 200 })
      return json(started, 202)
    }
    const botHook = p.match(/^\/api\/bots\/hook\/(bbh_[A-Za-z0-9_-]+)$/)
    if (botHook) {
      if (req.method !== 'POST') return json({ error: 'POST an event (JSON or text) to this URL to wake the bot.' }, 405)
      const { handleWebhook, MAX_INPUT_BYTES } = await import('./services/bots')
      if (Number(req.headers.get('content-length') ?? 0) > MAX_INPUT_BYTES) return json({ error: 'too_large', message: `Send at most ${MAX_INPUT_BYTES / 1000} KB.` }, 413)
      return json(await handleWebhook(botHook[1]!, await req.text()), 202)
    }
  } catch (err) {
    return errorResponse(err)
  }
  return undefined
}
