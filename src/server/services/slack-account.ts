import { and, eq, inArray, lt } from 'drizzle-orm'
import type { Actor } from '../actor'
import { requireRole } from '../actor'
import { decryptJson, encryptJson, hmacSign, hmacVerify, newId } from '../crypto'
import { flowTrigger, getDb, slackAccount, slackPost } from '../db'
import { appUrl, background, getEnv } from '../env'
import { forbidden, invalid } from '../errors'
import { logActivity } from './activity'
import { slackAppFor } from './connections'
import { exchangeSlackUserCode, SLACK_USER_SCOPES, slackApi, SlackApiError, slackUserAuthorizeUrl } from './slack'

/**
 * A person's own Slack account, connected through the Brainspace Slack app.
 *
 * Connecting does three things for that person, and only for them:
 *  - their flows and private bots can read Slack and post as them, with the
 *    token standing in for a personal secret named SLACK_USER_TOKEN;
 *  - new messages they can see start their flows' Slack triggers;
 *  - a click on a button the app posted for them starts their Slack triggers
 *    that listen for that button.
 *
 * Slack delivers every message any connected person can see to one endpoint,
 * POST /api/slack/events, and every click to POST /api/slack/interactions.
 * Nothing from either is stored: a payload is handed to the flow runs it
 * starts, or dropped.
 */

type AccountRow = typeof slackAccount.$inferSelect
type Obj = Record<string, any>

export function accountCallbackUrl() {
  return `${appUrl()}/api/slack/account/callback`
}

async function myRow(who: { workspaceId: string; userId: string }) {
  const [row] = await getDb().select().from(slackAccount).where(and(eq(slackAccount.workspaceId, who.workspaceId), eq(slackAccount.userId, who.userId)))
  return row
}

/** The person's Slack user token, if they connected their account. */
export async function accountToken(workspaceId: string, userId: string) {
  const row = await myRow({ workspaceId, userId })
  return row ? ((await decryptJson<string>(row.token)) ?? undefined) : undefined
}

export async function hasAccount(workspaceId: string, userId: string) {
  return !!(await myRow({ workspaceId, userId }))
}

export async function accountStatus(actor: Actor) {
  const [row, app] = await Promise.all([myRow(actor), slackAppFor(actor.workspaceId)])
  const granted = (row?.scope ?? '').split(',').filter(Boolean)
  return {
    /** What has to be true before anyone can connect: the workspace's Slack connection, and events set up on the server. */
    slackConnected: !!app?.install,
    slackWorkspace: app?.install?.teamName ?? null,
    serverReady: !!getEnv().SLACK_SIGNING_SECRET && !!app?.client,
    connected: !!row,
    slackUserId: row?.slackUserId ?? null,
    /** Connected before the app asked for a scope it needs now. Connecting again fixes it. */
    needsReconnect: !!row && SLACK_USER_SCOPES.some((s) => !granted.includes(s)),
    lastEventAt: row?.lastEventAt?.getTime() ?? null,
    canConnect: actor.role !== 'viewer',
  }
}

/** The Slack page where the person approves Brainspace acting as them. */
export async function startConnect(actor: Actor) {
  requireRole(actor, 'member', 'connect a Slack account')
  const app = await slackAppFor(actor.workspaceId)
  if (!app?.install) throw invalid('This workspace has no Slack connection yet.', 'Add Slack under Connections first. Your account connects through that app.')
  if (!app.client || !getEnv().SLACK_SIGNING_SECRET) {
    throw invalid("This Brainspace server's Slack app isn't set up for personal accounts.", 'See docs/slack-app.md: the app needs user scopes, event subscriptions and the SLACK_SIGNING_SECRET secret.')
  }
  const exp = Date.now() + 15 * 60_000
  const payload = `${actor.workspaceId}.${actor.userId}.${exp}`
  const state = `${payload}.${await hmacSign(`slackaccount:${payload}`)}`
  return { url: slackUserAuthorizeUrl(app.client.clientId, accountCallbackUrl(), state, app.install.teamId) }
}

/** Slack sent the person back with a code. `sessionUserId` is who is signed in to Brainspace in that browser. */
export async function finishConnect(state: string, code: string, sessionUserId: string | undefined) {
  const [workspaceId, userId, exp, sig] = state.split('.')
  if (!workspaceId || !userId || !exp || !sig || !(await hmacVerify(`slackaccount:${workspaceId}.${userId}.${exp}`, sig))) {
    throw invalid('That link is not valid. Start again from Connections.')
  }
  if (Number(exp) < Date.now()) throw invalid('That link expired. Start again from Connections.')
  if (sessionUserId !== userId) throw forbidden('Finish connecting Slack in the browser where you started, signed in to Brainspace as the same person.')
  const app = await slackAppFor(workspaceId)
  if (!app?.install || !app.client) throw invalid('This workspace has no Slack connection.')
  const got = await exchangeSlackUserCode(app.client, code, accountCallbackUrl())
  if (got.teamId !== app.install.teamId) {
    throw invalid(`That account is in ${got.teamName ?? 'another Slack workspace'}, and this workspace's Slack connection is ${app.install.teamName}.`, 'Connect the account you use in that Slack workspace.')
  }
  const values = { slackTeamId: got.teamId, slackTeamName: got.teamName ?? null, slackUserId: got.slackUserId, token: await encryptJson(got.token), scope: got.scope ?? null }
  await getDb()
    .insert(slackAccount)
    .values({ id: newId('sla'), workspaceId, userId, ...values })
    .onConflictDoUpdate({ target: [slackAccount.workspaceId, slackAccount.userId], set: values })
  return { workspaceId }
}

export async function disconnect(actor: Actor) {
  const row = await myRow(actor)
  if (!row) return accountStatus(actor)
  const token = await decryptJson<string>(row.token)
  // Hand the token back to Slack, so it is gone there too.
  if (token) await slackApi(token, 'auth.revoke').catch(() => {})
  await getDb().delete(slackAccount).where(eq(slackAccount.id, row.id))
  await logActivity(actor, 'slack_account_disconnect', { audience: [actor.userId] })
  return accountStatus(actor)
}

// ------------------------------------------------------------------ messages

/**
 * Whether this person is in the conversation. Slack names one install per event,
 * so for everyone else connected in that workspace we ask, and remember the
 * answer for ten minutes: this runs for every message any of them can see.
 */
async function canSee(a: AccountRow, channel: string) {
  const key = new Request(`https://slack-membership.brainspace.internal/${a.id}/${channel}`)
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default
  try {
    const hit = await cache?.match(key)
    if (hit) return (await hit.text()) === '1'
  } catch {}
  const token = await decryptJson<string>(a.token)
  if (!token) return false
  let sees = false
  try {
    const ch = (await slackApi(token, 'conversations.info', { channel })).channel as Obj | undefined
    sees = !!(ch?.is_member || ch?.is_im || ch?.is_mpim)
  } catch (err) {
    // Not found means a private conversation they aren't in. Anything else (rate limits, an outage) isn't an answer worth keeping.
    if (!(err instanceof SlackApiError) || err.code !== 'channel_not_found') return false
  }
  try {
    await cache?.put(key, new Response(sees ? '1' : '0', { headers: { 'Cache-Control': 'max-age=600' } }))
  } catch {}
  return sees
}

/** A message event from POST /api/slack/events: start the Slack triggers of everyone connected who can see it. */
export async function deliverEvent(body: Obj) {
  const e = body.event as Obj | undefined
  if (!e?.channel) return
  const auths = (Array.isArray(body.authorizations) ? body.authorizations : []) as Obj[]
  const teamIds = [...new Set([body.team_id, ...auths.map((a) => a.team_id)].filter((x): x is string => typeof x === 'string' && !!x))]
  if (!teamIds.length) return
  const db = getDb()
  const accounts = await db.select().from(slackAccount).where(inArray(slackAccount.slackTeamId, teamIds))
  if (!accounts.length) return
  const triggers = await db
    .select()
    .from(flowTrigger)
    .where(and(eq(flowTrigger.kind, 'slack'), eq(flowTrigger.enabled, true), inArray(flowTrigger.runAsUserId, accounts.map((a) => a.userId))))
  if (!triggers.length) return
  const { startSlackTrigger } = await import('./flows')
  for (const a of accounts) {
    const mine = triggers.filter((t) => t.workspaceId === a.workspaceId && t.runAsUserId === a.userId && t.slack?.messages)
    if (!mine.length) continue
    const named = auths.some((x) => !x.is_bot && x.user_id === a.slackUserId && x.team_id === a.slackTeamId)
    if (!named && !(await canSee(a, String(e.channel)))) continue
    for (const t of mine) await startSlackTrigger(t, body).catch((err) => console.error('[slack-account] could not start', t.id, err))
    // Once a minute is plenty for "last heard from Slack".
    if (!a.lastEventAt || Date.now() - a.lastEventAt.getTime() > 60_000) await db.update(slackAccount).set({ lastEventAt: new Date() }).where(eq(slackAccount.id, a.id))
  }
}

// ------------------------------------------------------------------ buttons

/**
 * Remember a message with buttons that the app posted for someone, so a click on
 * it goes to that person's flows. A card anyone else has the app post never
 * reaches them, whatever its buttons are called.
 */
export async function recordPost(actor: Pick<Actor, 'workspaceId' | 'userId'>, slackTeamId: string, channel: string, ts: string) {
  const db = getDb()
  await db
    .insert(slackPost)
    .values({ slackTeamId, channel, ts, workspaceId: actor.workspaceId, userId: actor.userId })
    .onConflictDoUpdate({ target: [slackPost.slackTeamId, slackPost.channel, slackPost.ts], set: { workspaceId: actor.workspaceId, userId: actor.userId } })
  // A card nobody clicked in half a year is not going to be clicked.
  background(db.delete(slackPost).where(lt(slackPost.createdAt, new Date(Date.now() - 180 * 86_400_000))).then(() => {}))
}

/** POST /api/slack/interactions: a click on something the app posted. Answers at once, as Slack requires. */
export async function handleSlackInteraction(req: Request): Promise<Response> {
  const raw = await req.text()
  const { validSignature } = await import('./slack-bots')
  if (!(await validSignature(req, raw))) return new Response('Bad signature', { status: 401 })
  let payload: Obj
  try {
    payload = JSON.parse(new URLSearchParams(raw).get('payload') ?? '') as Obj
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  if (!req.headers.get('x-slack-retry-num')) {
    background(routeInteraction(payload).catch((err) => console.error('[slack-account] click failed', err)))
  }
  // Slack shows the person an error unless a click is answered with a plain, empty 200.
  return new Response('', { status: 200 })
}

async function routeInteraction(p: Obj) {
  if (p.type !== 'block_actions') return
  const channel = String(p.container?.channel_id ?? p.channel?.id ?? '')
  const ts = String(p.container?.message_ts ?? p.message?.ts ?? '')
  const ids = ((Array.isArray(p.actions) ? p.actions : []) as Obj[]).map((a) => String(a.action_id ?? ''))
  if (!channel || !ts || !ids.length) return
  const db = getDb()
  // Channel ids are unique across Slack, so the team isn't needed to find the card.
  const [post] = await db.select().from(slackPost).where(and(eq(slackPost.channel, channel), eq(slackPost.ts, ts)))
  if (!post) return
  const triggers = await db
    .select()
    .from(flowTrigger)
    .where(and(eq(flowTrigger.kind, 'slack'), eq(flowTrigger.enabled, true), eq(flowTrigger.workspaceId, post.workspaceId), eq(flowTrigger.runAsUserId, post.userId)))
  const { startSlackTrigger } = await import('./flows')
  for (const t of triggers) {
    if (!t.slack?.actions?.some((a) => ids.includes(a))) continue
    await startSlackTrigger(t, p).catch((err) => console.error('[slack-account] could not start', t.id, err))
  }
}
