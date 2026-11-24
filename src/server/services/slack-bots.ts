import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm'
import type { Actor } from '../actor'
import { bot, botRun, botSlackThread, getDb, member, user, type Role } from '../db'
import { background, getEnv } from '../env'
import { invalid } from '../errors'
import { newId } from '../crypto'
import type { BotRow } from './bots'
import { slackAppFor, usableConnections } from './connections'
import {
  SLACK_BOTS_SCOPES,
  SlackApiError,
  cleanSlackHandle,
  nameResolver,
  slackApi,
  slackHandleFrom,
  slackLine,
  slackMentions,
} from './slack'

/**
 * Bots in Slack. Each bot that is turned on for Slack gets a Slack user group
 * as its handle, so people type @monday-digest the way they'd mention a person.
 * The one Brainspace app reads the channels it is in, and a message that
 * mentions a bot's group (or "@Brainspace <bot name>", where user groups aren't
 * available) starts a run of that bot. The run's answer is posted back in the
 * thread under the bot's name, and the person who asked can keep going in that
 * thread without mentioning it again.
 *
 * A bot acts with its owner's access, so only people in its Brainspace
 * workspace, matched by email, can ask it things, and only its owner can ask a
 * private one.
 */

type Obj = Record<string, any>
type BotSlackFields = Pick<typeof bot.$inferInsert, 'slackEnabled' | 'slackConnectionId' | 'slackTeamId' | 'slackGroupId' | 'slackHandle'>

/** How long a thread keeps going to the same bot without a mention. */
const THREAD_TTL_MS = 7 * 86_400_000
const MAX_SLACK_RUNS_PER_HOUR = 120

// ------------------------------------------------------------------ handles

const groupName = (b: Pick<BotRow, 'name'>) => `${b.name} (bot)`
const GROUP_DESCRIPTION = 'A Brainspace bot. Mention it in a channel the Brainspace app is in to ask it something.'

/** Errors that mean this Slack workspace can't give the app user groups, so the bot goes without a handle. */
const NO_GROUPS = new Set(['paid_teams_only', 'permission_denied', 'no_permission', 'missing_scope', 'not_allowed_token_type', 'restricted_action'])

function noGroupsNote(code: string) {
  return code === 'paid_teams_only'
    ? "This Slack workspace is on Slack's free plan, which has no user groups, so the bot has no @handle of its own."
    : `Slack didn't let the app create a user group (${code}). A Slack admin can allow it under Settings & permissions → Permissions → User Groups.`
}

/** The Slack connection a bot answers through, if its owner may still use it. */
async function appForOwner(owner: Actor, b: Pick<BotRow, 'workspaceId' | 'slackConnectionId'>, pick?: boolean) {
  const usable = (await usableConnections(owner)).filter((c) => c.type === 'slack')
  for (const c of b.slackConnectionId ? usable.filter((x) => x.id === b.slackConnectionId) : pick ? usable : []) {
    const app = await slackAppFor(b.workspaceId, c.id)
    if (app) return app
  }
  return null
}

/** Whether the bot's owner may still use its Slack connection. Checked before each Slack run. */
export async function ownerCanUseSlack(owner: Actor, b: Pick<BotRow, 'workspaceId' | 'slackConnectionId'>) {
  return !!b.slackConnectionId && !!(await appForOwner(owner, b))
}

/**
 * A disabled group this app made for a bot that's gone, holding the handle we want.
 * Deleting a bot only disables its group (Slack has no delete), so without this a
 * new bot with the same name could never have its handle.
 */
async function leftoverGroup(api: (m: string, a: Obj) => Promise<Obj>, handle: string, appUserId: string | undefined, botId: string) {
  if (!appUserId) return null
  const list = await api('usergroups.list', { include_disabled: true }).catch(() => null)
  const g = ((list?.usergroups ?? []) as Obj[]).find((x) => x.handle === handle && x.created_by === appUserId && x.date_delete)
  if (!g) return null
  const [used] = await getDb().select({ id: bot.id }).from(bot).where(and(eq(bot.slackGroupId, String(g.id)), ne(bot.id, botId)))
  return used ? null : String(g.id)
}

/**
 * Turn Slack on for a bot, or change its handle: create (or bring back) its user
 * group. Where user groups aren't available it still works as "@Brainspace <name>".
 * `owner` is the bot's owner, who has to be allowed to use the Slack connection.
 */
export async function enableSlack(owner: Actor, b: BotRow, opts: { handle?: string | null; name?: string } = {}): Promise<{ set: BotSlackFields; note?: string }> {
  const app = (await appForOwner(owner, b)) ?? (await appForOwner(owner, { workspaceId: b.workspaceId, slackConnectionId: null }, true))
  if (!app) {
    throw invalid(
      (await slackAppFor(b.workspaceId)) ? "You can't use this workspace's Slack connection." : 'This workspace has no Slack connection yet.',
      (await slackAppFor(b.workspaceId)) ? 'Ask an admin to give you access to it under Connections.' : 'Add Slack under Connections first, then turn Slack on for the bot.',
    )
  }
  const granted = app.install.scope?.split(',')
  if (granted && SLACK_BOTS_SCOPES.some((s) => !granted.includes(s))) {
    throw invalid(`${app.name} was installed before bots could be asked things in Slack.`, `Open Connections and use Reinstall in Slack on ${app.name}, then turn Slack on again.`)
  }
  const name = opts.name ?? b.name
  const handle = opts.handle ? cleanSlackHandle(opts.handle) : (b.slackHandle ?? slackHandleFrom(name))
  const sameTeam = b.slackTeamId === app.install.teamId
  const base = { slackEnabled: true, slackConnectionId: app.connectionId, slackTeamId: app.install.teamId }
  const api = (method: string, args: Obj) => slackApi(app.token, method, args)
  const fields = { name: groupName({ name }), handle, description: GROUP_DESCRIPTION }
  /** Bring back a group we made, with this bot's name and handle. False when Slack no longer has it. */
  const revive = async (id: string) => {
    try {
      await api('usergroups.enable', { usergroup: id })
    } catch (err) {
      if (!(err instanceof SlackApiError)) throw err
      if (err.code === 'no_such_subteam' || err.code === 'subteam_not_found') return false
      if (err.code !== 'already_enabled') throw err
    }
    await api('usergroups.update', { usergroup: id, ...fields })
    return true
  }
  let groupId = sameTeam ? b.slackGroupId : null
  try {
    if (groupId && !(await revive(groupId))) groupId = null
    if (!groupId) {
      try {
        groupId = String((await api('usergroups.create', fields)).usergroup?.id ?? '') || null
      } catch (err) {
        const left = err instanceof SlackApiError && /exists|taken|duplicate/.test(err.code) ? await leftoverGroup(api, handle, app.install.botUserId, b.id) : null
        if (!left || !(await revive(left))) throw err
        groupId = left
      }
    }
    return { set: { ...base, slackGroupId: groupId, slackHandle: handle } }
  } catch (err) {
    if (!(err instanceof SlackApiError)) throw err
    if (NO_GROUPS.has(err.code)) {
      return { set: { ...base, slackGroupId: sameTeam ? b.slackGroupId : null, slackHandle: null }, note: `${noGroupsNote(err.code)} People can still ask it with @${app.install.botName ?? 'Brainspace'} ${name}.` }
    }
    if (/exists|taken|duplicate/.test(err.code)) {
      throw invalid(`@${handle} is already taken in ${app.install.teamName}.`, 'Pick another handle. It has to differ from every person, channel and user group there.')
    }
    if (/invalid_(handle|name)/.test(err.code)) throw invalid(`Slack won't take @${handle} as a handle (${err.code}).`, 'Try a shorter one with only lowercase letters, numbers and dashes.')
    throw invalid(`Slack couldn't set up @${handle}: ${err.code}.`)
  }
}

/** Turn Slack off. The user group is disabled, not deleted, so turning it back on keeps the handle. */
export async function disableSlack(b: BotRow): Promise<BotSlackFields> {
  if (b.slackGroupId && b.slackTeamId) {
    const app = await slackAppFor(b.workspaceId, b.slackConnectionId)
    if (app?.install.teamId === b.slackTeamId) {
      await slackApi(app.token, 'usergroups.disable', { usergroup: b.slackGroupId }).catch((err) => console.warn('[slack-bots] disable group failed', b.id, (err as Error).message))
    }
  }
  return { slackEnabled: false }
}

/** Keep the user group's name in step with the bot's. */
export async function renameSlackGroup(b: BotRow, name: string) {
  if (!b.slackEnabled || !b.slackGroupId) return
  const app = await slackAppFor(b.workspaceId, b.slackConnectionId)
  if (!app || app.install.teamId !== b.slackTeamId) return
  await slackApi(app.token, 'usergroups.update', { usergroup: b.slackGroupId, name: groupName({ name }) }).catch((err) => console.warn('[slack-bots] rename group failed', b.id, (err as Error).message))
}

/** What the bot page shows about Slack. */
export async function slackStatus(b: BotRow) {
  const app = await slackAppFor(b.workspaceId, b.slackEnabled ? b.slackConnectionId : null).catch(() => null)
  const granted = app?.install.scope?.split(',')
  return {
    enabled: b.slackEnabled,
    handle: b.slackEnabled ? b.slackHandle : null,
    /** What people type when the bot has no handle. */
    mention: `@${app?.install.botName ?? 'Brainspace'} ${b.name}`,
    team: app?.install.teamName ?? null,
    connected: !!app,
    needsReinstall: !!granted && SLACK_BOTS_SCOPES.some((s) => !granted.includes(s)),
    suggestedHandle: b.slackHandle ?? slackHandleFrom(b.name),
    eventsReady: !!getEnv().SLACK_SIGNING_SECRET,
  }
}

// ------------------------------------------------------------------ events

async function validSignature(req: Request, raw: string) {
  const secret = getEnv().SLACK_SIGNING_SECRET
  const ts = req.headers.get('x-slack-request-timestamp') ?? ''
  const given = req.headers.get('x-slack-signature') ?? ''
  if (!secret || !ts || !given || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${raw}`)))
  const want = `v0=${[...mac].map((x) => x.toString(16).padStart(2, '0')).join('')}`
  if (want.length !== given.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}

/** POST /api/slack/events: the Brainspace app's event subscription. Answers at once, as Slack requires, and does the work after. */
export async function handleSlackEvents(req: Request): Promise<Response> {
  const raw = await req.text()
  if (!(await validSignature(req, raw))) return new Response('Bad signature', { status: 401 })
  let body: Obj
  try {
    body = JSON.parse(raw) as Obj
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  if (body.type === 'url_verification') return new Response(String(body.challenge ?? ''), { headers: { 'Content-Type': 'text/plain' } })
  // Redeliveries are handled like first deliveries: Slack also retries ones that never got here,
  // and each bot takes a given message once (askSlack keys on channel and ts).
  if (body.type === 'event_callback' && body.event?.type === 'message') {
    background(route(body).catch((err) => console.error('[slack-bots] event failed', body.event_id, err)))
  }
  return new Response('', { status: 200 })
}

const lower = (s: string | null | undefined) => (s ?? '').toLowerCase()

/** "@Brainspace monday digest what changed?" -> the bot whose handle or name the text starts with. */
export function botByName<B extends Pick<BotRow, 'id' | 'name' | 'slackHandle' | 'visibility'>>(bots: B[], text: string) {
  const t = lower(text.replace(/^[\s,:;-]+/, '').replace(/^@/, ''))
  const hits: { b: B; len: number }[] = []
  for (const b of bots) {
    for (const key of [lower(b.slackHandle), lower(b.name)].filter(Boolean)) {
      const k = key.replace(/^@/, '')
      if (t === k || (t.startsWith(k) && /^[\s,:;.!?-]/.test(t.slice(k.length)))) hits.push({ b, len: k.length })
    }
  }
  if (!hits.length) return { found: null, ambiguous: false }
  const best = Math.max(...hits.map((h) => h.len))
  const top = [...new Map(hits.filter((h) => h.len === best).map((h) => [h.b.id, h.b])).values()]
  // The same name twice: a team bot beats someone's private one.
  const team = top.filter((b) => b.visibility === 'team')
  const pick = top.length === 1 ? top : team.length === 1 ? team : null
  return { found: pick?.[0] ?? null, ambiguous: !pick }
}

type Asker = { userId: string; name: string; role: Role }

/** Who a Slack user is in each of these Brainspace workspaces, matched on the email Slack has for them. */
async function askerIn(token: string, slackUserId: string, workspaceIds: string[]): Promise<Map<string, Asker>> {
  const info = await slackApi(token, 'users.info', { user: slackUserId }).catch(() => null)
  const email = lower(info?.user?.profile?.email)
  if (!email || info?.user?.is_bot || !workspaceIds.length) return new Map()
  const rows = await getDb()
    .select({ workspaceId: member.workspaceId, userId: user.id, name: user.name, role: member.role })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .where(and(sql`lower(${user.email}) = ${email}`, inArray(member.workspaceId, workspaceIds)))
  return new Map(rows.map((r) => [r.workspaceId, r]))
}

/**
 * Why this person can't ask this bot, or null when they can. A bot acts with its
 * owner's access, so it only takes requests from members of its workspace, and a
 * private one only from its owner. Checked when they ask, and again before the run.
 */
export function refusal(b: Pick<BotRow, 'name' | 'visibility' | 'ownerId'>, who: Pick<Asker, 'userId' | 'role'> | null | undefined): string | null {
  if (!who) return `${b.name} only takes requests from people in its Brainspace workspace, and Slack's email for you doesn't match anyone there.`
  if (who.role === 'viewer') return `You're read-only in Brainspace, so you can't ask ${b.name} to do things.`
  if (b.visibility === 'private' && who.userId !== b.ownerId) return `${b.name} is a private bot, so it only answers the person who made it.`
  return null
}

/** Someone's role in a workspace right now, for the recheck before a waiting request runs. */
export async function currentRole(workspaceId: string, userId: string) {
  const [m] = await getDb().select({ userId: member.userId, role: member.role }).from(member).where(and(eq(member.workspaceId, workspaceId), eq(member.userId, userId)))
  return m ?? null
}

async function route(body: Obj) {
  const e = body.event as Obj
  // Edits, deletes, joins and anything an app posted (our own answers included) are not someone asking.
  if ((e.subtype && e.subtype !== 'file_share' && e.subtype !== 'thread_broadcast') || e.bot_id || !e.user || e.user === 'USLACKBOT') return
  if (e.channel_type === 'im' || e.channel_type === 'mpim') return
  const teamId = String(body.team_id ?? '')
  const bots = await getDb().select().from(bot).where(and(eq(bot.slackTeamId, teamId), eq(bot.slackEnabled, true)))
  if (!bots.length) return

  const text = String(e.text ?? '')
  const mentioned = slackMentions(text)
  const appUser = ((body.authorizations ?? []) as Obj[]).find((a) => a.is_bot)?.user_id as string | undefined
  const targets = new Map<string, BotRow>()
  for (const b of bots) if (b.slackGroupId && b.slackHandle && mentioned.groups.includes(b.slackGroupId)) targets.set(b.id, b)
  const named = !!appUser && mentioned.users.includes(appUser)
  const inThread = !!e.thread_ts && e.thread_ts !== e.ts
  const followUp = !targets.size && !named && inThread && !mentioned.groups.length && !mentioned.users.length
  if (!targets.size && !named && !followUp) return

  // Any of the app's installs in this Slack workspace can look the person up and talk to them.
  let anyApp: Awaited<ReturnType<typeof slackAppFor>> = null
  for (const b of bots) if ((anyApp = await slackAppFor(b.workspaceId, b.slackConnectionId))) break
  if (!anyApp) return
  const askers = await askerIn(anyApp.token, String(e.user), [...new Set(bots.map((b) => b.workspaceId))])

  if (named) {
    // "@Brainspace <bot> ...": the bot's name comes right after the app's mention. Only bots this person may ask count.
    const theirs = bots.filter((b) => !refusal(b, askers.get(b.workspaceId)))
    const after = text.split(new RegExp(`<@${appUser}(?:\\|[^>]*)?>`)).slice(1).join(' ')
    const { found, ambiguous } = botByName(theirs, after)
    if (found) targets.set(found.id, found)
    else if (!targets.size) {
      const app = anyApp.install.botName ?? 'Brainspace'
      const shown = theirs.map((b) => (b.slackHandle ? `@${b.slackHandle}` : b.name))
      await ephemeral(
        anyApp.token,
        e,
        ambiguous
          ? 'More than one bot has that name. Mention it by its @handle instead.'
          : shown.length
            ? `Which bot? Start with its name, like "@${app} ${theirs[0]!.name} what changed this week?" Bots you can ask here: ${shown.join(', ')}.`
            : "There are no Brainspace bots here that you can ask. A bot's owner turns Slack on for it from its page in Brainspace.",
      )
      return
    }
  }

  // A reply in a thread a bot answered, from the person who asked it, with no one else mentioned.
  if (followUp) {
    const [t] = await getDb()
      .select()
      .from(botSlackThread)
      .where(and(eq(botSlackThread.slackTeamId, teamId), eq(botSlackThread.channel, String(e.channel)), eq(botSlackThread.threadTs, String(e.thread_ts))))
    const b = t && t.slackUserId === e.user && t.updatedAt.getTime() > Date.now() - THREAD_TTL_MS ? bots.find((x) => x.id === t.botId) : undefined
    if (b) targets.set(b.id, b)
  }

  for (const b of targets.values()) {
    await askBot(b, e, teamId, askers.get(b.workspaceId)).catch((err) => console.error('[slack-bots] ask failed', b.id, err))
  }
}

async function ephemeral(token: string, e: Obj, text: string) {
  await slackApi(token, 'chat.postEphemeral', { channel: e.channel, user: e.user, text, ...(e.thread_ts ? { thread_ts: e.thread_ts } : {}) }).catch(() => {})
}

const MAX_CONTEXT_CHARS = 60_000
const THREAD_CONTEXT = 40
const clipText = (t: string) => (t.length > 4000 ? `${t.slice(0, 4000)}… [cut off]` : t)

/** Swap <!subteam^S1|@x> for @x, so the request reads the way the person wrote it. */
const plainGroups = (text: string) => text.replace(/<!subteam\^[A-Z0-9]+\|(@[^>]+)>/g, '$1').replace(/<!subteam\^[A-Z0-9]+>/g, '@group')

/** A thread's first message and its latest replies. Slack lists replies oldest first, so a long thread is paged to its end. */
async function recentThread(token: string, channel: string, ts: string): Promise<Obj[]> {
  const all: Obj[] = []
  let cursor: string | undefined
  for (let page = 0; page < 5; page++) {
    const r = await slackApi(token, 'conversations.replies', { channel, ts, limit: 200, cursor })
    all.push(...((r.messages ?? []) as Obj[]))
    cursor = r.response_metadata?.next_cursor || undefined
    if (!cursor) break
  }
  const sorted = all.sort((a, b) => Number(a.ts) - Number(b.ts))
  return sorted.length <= THREAD_CONTEXT ? sorted : [sorted[0]!, ...sorted.slice(-(THREAD_CONTEXT - 1))]
}

/** The messages just before this one in the channel, oldest first. */
async function recentChannel(token: string, channel: string, before: string): Promise<Obj[]> {
  const r = await slackApi(token, 'conversations.history', { channel, latest: before, limit: 10 })
  return ((r.messages ?? []) as Obj[]).sort((a, b) => Number(a.ts) - Number(b.ts))
}

async function askBot(b: BotRow, e: Obj, teamId: string, who: Asker | undefined) {
  const app = await slackAppFor(b.workspaceId, b.slackConnectionId)
  if (!app || app.install.teamId !== teamId) return
  const tell = (text: string) => ephemeral(app.token, e, text)

  const no = refusal(b, who)
  if (no || !who) return tell(no ?? '')
  if (!b.enabled) return tell(`${b.name} is paused.${b.pausedReason ? ` ${b.pausedReason}` : ''}`)
  const [recent] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(botRun)
    .where(and(eq(botRun.botId, b.id), eq(botRun.trigger, 'slack'), sql`${botRun.createdAt} > ${Date.now() - 3600_000}`))
  if ((recent?.n ?? 0) >= MAX_SLACK_RUNS_PER_HOUR) return tell(`${b.name} has already answered ${MAX_SLACK_RUNS_PER_HOUR} Slack requests in the last hour. Try again later.`)

  const threadTs = String(e.thread_ts ?? e.ts)
  const inThread = !!e.thread_ts && e.thread_ts !== e.ts
  const nameOf = nameResolver(app.token)
  const ask = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null)
  const [message, info, link] = await Promise.all([
    slackLine(e, nameOf),
    ask(slackApi(app.token, 'conversations.info', { channel: e.channel })),
    ask(slackApi(app.token, 'chat.getPermalink', { channel: e.channel, message_ts: e.ts })),
  ])
  const ch = info?.channel as Obj | undefined
  const where = ch?.name ? `#${ch.name}${ch.is_private ? ' (private)' : ''}` : 'a channel'
  // A team bot's runs are open to the whole Brainspace workspace. From a private channel (or one
  // we can't check), it only takes this person's own messages and the bots' answers, not what
  // other people said there.
  const closed = b.visibility === 'team' && (!ch || !!ch.is_private || !!ch.is_mpim)
  // In a thread, the thread is the context. Otherwise it is what was said just before.
  const raw = (await ask(inThread ? recentThread(app.token, String(e.channel), threadTs) : closed ? Promise.resolve([]) : recentChannel(app.token, String(e.channel), String(e.ts)))) ?? []
  const kept = raw.filter((m) => String(m.ts) !== String(e.ts) && (!closed || m.user === e.user || m.bot_id))
  const conversation = (await Promise.all(kept.map((m) => slackLine(m, nameOf)))).map((m) => ({ ...m, text: clipText(plainGroups(m.text)) }))
  // Keep what the run is handed under the bots' input limit, dropping the oldest messages first.
  while (conversation.length && JSON.stringify(conversation).length > MAX_CONTEXT_CHARS) conversation.shift()
  const note = inThread
    ? `The thread so far, oldest first${raw.length > kept.length + 1 && !closed ? ' (its first message and the latest replies)' : ''}. Messages from apps include your own earlier answers.`
    : 'The messages just before this one in the channel, oldest first.'
  const input = {
    from: who.name,
    where,
    permalink: link?.permalink as string | undefined,
    ...(message.files ? { files: message.files } : {}),
    conversationNote: conversation.length ? `${note}${closed ? ` This is a private channel, so only ${who.name}'s messages and the bots' answers are included.` : ''}` : undefined,
    conversation: conversation.length ? conversation : undefined,
  }
  const request = clipText(plainGroups(message.text).trim())

  await getDb()
    .insert(botSlackThread)
    .values({ id: newId('bst'), slackTeamId: teamId, channel: String(e.channel), threadTs, botId: b.id, slackUserId: String(e.user) })
    .onConflictDoUpdate({
      target: [botSlackThread.slackTeamId, botSlackThread.channel, botSlackThread.threadTs],
      set: { botId: b.id, slackUserId: String(e.user), updatedAt: new Date() },
    })
  background(getDb().delete(botSlackThread).where(lt(botSlackThread.updatedAt, new Date(Date.now() - THREAD_TTL_MS))).then(() => {}))

  const { askFromSlack } = await import('./bots')
  await askFromSlack(b, {
    key: `${e.channel}:${e.ts}`,
    connectionId: app.connectionId,
    channel: String(e.channel),
    threadTs,
    slackUserId: String(e.user),
    userId: who.userId,
    request,
    input: JSON.stringify(input, null, 2),
  })
}

// ------------------------------------------------------------------ answering

export type SlackAsk = {
  /** channel:ts of the message, so a redelivered event asks once. */
  key: string
  connectionId: string
  channel: string
  threadTs: string
  slackUserId: string
  /** The Brainspace member who asked. */
  userId: string
  request: string
  input: string
}

/** Slack's limit for markdown_text is 12,000 characters. */
const MAX_ANSWER = 11_500

/** Post, or rewrite, the bot's message in the thread. Returns its ts. */
export async function postInThread(b: Pick<BotRow, 'workspaceId' | 'name'>, a: Pick<SlackAsk, 'connectionId' | 'channel' | 'threadTs'>, markdown: string, replace?: string | null) {
  const app = await slackAppFor(b.workspaceId, a.connectionId)
  if (!app) return null
  const md = markdown.length > MAX_ANSWER ? `${markdown.slice(0, MAX_ANSWER)}…` : markdown
  if (replace) {
    try {
      await slackApi(app.token, 'chat.update', { channel: a.channel, ts: replace, markdown_text: md })
      return replace
    } catch (err) {
      console.warn('[slack-bots] update failed, posting instead', (err as Error).message)
    }
  }
  const r = await slackApi(app.token, 'chat.postMessage', { channel: a.channel, thread_ts: a.threadTs, markdown_text: md, username: b.name, unfurl_links: false, unfurl_media: false })
  return String(r.ts)
}
