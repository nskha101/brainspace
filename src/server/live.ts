import { DurableObject } from 'cloudflare:workers'
import type { Actor } from './actor'
import { TEAM } from './actor'
import { background, getEnv } from './env'

/** What changed. Clients refetch what they show; the event itself carries no content. */
export type LiveEvent = {
  type: 'change'
  scope: 'files' | 'members' | 'connections' | 'workspace'
  /** "team", or the owner's user id for a private drive. Null for workspace-level changes. */
  driveId: string | null
  path: string | null
  action: string
  actorId: string
  actorName: string
  via: 'web' | 'mcp'
  client: string | null
  at: number
}

type ControlMessage = { type: 'kick'; userId: string }

/**
 * One instance per workspace. Browsers hold a hibernatable WebSocket here, and
 * every change in the workspace is fanned out to them. Sockets are tagged with
 * the user id so private-drive events only reach their owner.
 */
export class WorkspaceLive extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/connect') {
      const userId = url.searchParams.get('userId')
      if (!userId || req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a websocket', { status: 426 })
      const pair = new WebSocketPair()
      this.ctx.acceptWebSocket(pair[1], [userId])
      pair[1].send(JSON.stringify({ type: 'hello', at: Date.now() }))
      return new Response(null, { status: 101, webSocket: pair[0] })
    }
    if (url.pathname === '/publish' && req.method === 'POST') {
      const msg = (await req.json()) as LiveEvent | ControlMessage
      if (msg.type === 'kick') {
        for (const ws of this.ctx.getWebSockets(msg.userId)) ws.close(4001, 'Removed from workspace')
        return new Response('ok')
      }
      const payload = JSON.stringify(msg)
      const targets = !msg.driveId || msg.driveId === TEAM ? this.ctx.getWebSockets() : this.ctx.getWebSockets(msg.driveId)
      for (const ws of targets) {
        try {
          ws.send(payload)
        } catch {
          // Socket already gone; hibernation cleans it up.
        }
      }
      return new Response('ok')
    }
    return new Response('Not found', { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === 'ping') ws.send('pong')
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, 'closing')
    } catch {
      // already closed
    }
  }
}

function stub(workspaceId: string) {
  const ns = getEnv().LIVE
  return ns.get(ns.idFromName(workspaceId))
}

/** Tell every open browser in the workspace that something changed. Runs after the response. */
export function publishChange(
  actor: Actor,
  change: { scope?: LiveEvent['scope']; driveId?: string | null; path?: string | null; action: string },
) {
  const event: LiveEvent = {
    type: 'change',
    scope: change.scope ?? 'files',
    driveId: change.driveId ?? null,
    path: change.path ?? null,
    action: change.action,
    actorId: actor.userId,
    actorName: actor.userName,
    via: actor.via,
    client: actor.clientName ?? null,
    at: Date.now(),
  }
  background(
    stub(actor.workspaceId).fetch('https://live/publish', { method: 'POST', body: JSON.stringify(event) }).then(() => undefined),
  )
}

/** Close a removed member's live connections. */
export function kickFromLive(workspaceId: string, userId: string) {
  background(
    stub(workspaceId)
      .fetch('https://live/publish', { method: 'POST', body: JSON.stringify({ type: 'kick', userId } satisfies ControlMessage) })
      .then(() => undefined),
  )
}

/** Browser → /api/live. Authenticated by the caller; forwarded to the workspace's object. */
export function connectLive(req: Request, actor: Actor) {
  const url = new URL('https://live/connect')
  url.searchParams.set('userId', actor.userId)
  return stub(actor.workspaceId).fetch(new Request(url, req))
}

/** For changes made by Brainspace itself (for example, text extraction finishing). */
export function publishSystemChange(workspaceId: string, change: { driveId: string; path: string; action: string }) {
  const event: LiveEvent = {
    type: 'change',
    scope: 'files',
    driveId: change.driveId,
    path: change.path,
    action: change.action,
    actorId: 'system',
    actorName: 'Brainspace',
    via: 'web',
    client: null,
    at: Date.now(),
  }
  background(stub(workspaceId).fetch('https://live/publish', { method: 'POST', body: JSON.stringify(event) }).then(() => undefined))
}
