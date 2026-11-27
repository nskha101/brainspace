/**
 * The Brainspace Slack app: a built-in connection whose tools run here, with
 * the bot token a workspace gets from "Add to Slack" (or a bot token pasted in).
 * Flows, flow destinations and agents reach it like any other connection, as
 * slack__post_message and friends.
 *
 * Kept free of D1 and Worker imports so it can be exercised with a stub fetch.
 */
import { AppError, invalid } from '../errors'
import type { CachedTool, Json } from '../db/app-schema'

/** Bot scopes requested on install. Keep in step with docs/slack-app.md. */
export const SLACK_BOT_SCOPES = [
  'chat:write',
  'chat:write.public',
  'chat:write.customize',
  'files:write',
  'channels:read',
  'groups:read',
  'channels:join',
  'im:write',
  'users:read',
  'users:read.email',
  // Bots in Slack: each bot's @handle is a user group, and the app reads the
  // channels it is in for mentions of them and the threads it answers in.
  'usergroups:write',
  'usergroups:read',
  'channels:history',
  'groups:history',
]

/** Scopes an install needs before bots can be asked things in Slack. Older installs lack them until reinstalled. */
export const SLACK_BOTS_SCOPES = ['usergroups:write', 'usergroups:read', 'channels:history', 'groups:history']

/**
 * User scopes a person grants when they connect their own Slack account: read the
 * conversations they are in, search, open files, and post as them. Keep in step
 * with docs/slack-app.md.
 */
export const SLACK_USER_SCOPES = [
  'channels:history',
  'groups:history',
  'im:history',
  'mpim:history',
  'channels:read',
  'groups:read',
  'im:read',
  'mpim:read',
  'users:read',
  'search:read',
  'files:read',
  'chat:write',
]

/** A user group handle from a bot's name: "Monday digest" -> "monday-digest". */
export function slackHandleFrom(name: string) {
  return (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-._]+|[-._]+$/g, '')
      // Slack's limit is 21 characters. Cut at a word where one is close.
      .replace(/^(.{21}).+$/, (_, head: string) => (head.lastIndexOf('-') >= 8 ? head.slice(0, head.lastIndexOf('-')) : head))
      .replace(/[-._]+$/g, '') || 'bot'
  )
}

/** Clean a handle someone typed, or say what's wrong with it. */
export function cleanSlackHandle(raw: string) {
  const h = raw.trim().replace(/^@/, '').toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{0,20}$/.test(h)) {
    throw invalid(`"${raw}" can't be a Slack handle.`, 'Use up to 21 lowercase letters, numbers, dots, dashes or underscores, like "research-bot".')
  }
  return h
}

/** The user groups (<!subteam^S123|@x>) and people (<@U123>) a message mentions. */
export function slackMentions(text: string) {
  return {
    groups: [...new Set([...text.matchAll(/<!subteam\^([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]!))],
    users: [...new Set([...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]!))],
  }
}

/** What we learn about the Slack workspace at install, kept with the token. */
export type SlackInstall = {
  teamId: string
  teamName: string
  url?: string
  botUserId?: string
  botName?: string
  appId?: string
  scope?: string
}

const MARKDOWN_LIMIT = 12_000
const UPLOAD_LIMIT = 100 * 1024 * 1024

export class SlackApiError extends Error {
  constructor(
    public method: string,
    public code: string,
    public needed?: string,
  ) {
    super(`Slack ${method}: ${code}`)
  }
}

type Fetch = typeof fetch
type Obj = Record<string, any>

export async function slackApi<T extends Obj = Obj>(token: string, method: string, args: Obj = {}, f: Fetch = fetch): Promise<T> {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined && v !== null) body.set(k, typeof v === 'string' ? v : JSON.stringify(v))
  }
  for (let attempt = 0; ; attempt++) {
    const res = await f(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 429) {
      // Slack hasn't acted on a rate-limited call, so one short wait and retry can't post twice.
      const wait = Number(res.headers.get('Retry-After') ?? '1')
      if (attempt === 0 && wait <= 10) {
        await new Promise((r) => setTimeout(r, wait * 1000))
        continue
      }
      throw new SlackApiError(method, 'ratelimited')
    }
    const j = (await res.json().catch(() => null)) as Obj | null
    if (!j) throw new SlackApiError(method, `http_${res.status}`)
    if (!j.ok) throw new SlackApiError(method, String(j.error ?? 'unknown_error'), j.needed)
    return j as T
  }
}

const AUTH_CODES = new Set(['invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive', 'no_permission', 'ekm_access_denied', 'team_access_not_granted'])

export function isSlackAuthFailure(err: unknown) {
  return err instanceof SlackApiError && AUTH_CODES.has(err.code)
}

/** Turn a Slack error code into something an agent (or the person reading a run) can act on. */
export function slackFailure(err: unknown, botName = 'Brainspace', target?: string): Error {
  if (!(err instanceof SlackApiError)) return err as Error
  const invite = `In Slack, open the channel and type /invite @${botName}. Private and Slack Connect channels need this; public ones don't.`
  const where = target ? ` ${target}` : ''
  switch (err.code) {
    case 'invalid_auth':
    case 'not_authed':
    case 'token_revoked':
    case 'token_expired':
    case 'account_inactive':
    case 'team_access_not_granted':
      return new AppError('unauthorized', `Slack rejected Brainspace's token (${err.code}). The app may have been removed from the Slack workspace.`, {
        hint: 'An admin or member needs to reconnect Slack from Connections in Brainspace, or call connection_authorize("slack") and open the link.',
      })
    case 'missing_scope':
      return new AppError('forbidden', `The Slack app doesn't have the ${err.needed ?? 'needed'} permission for ${err.method}.`, {
        hint: 'Reconnect Slack from Connections in Brainspace so the app gets its current permissions.',
      })
    case 'channel_not_found':
      return invalid(`Slack couldn't find the channel${where}, or the app can't see it.`, `Check the ID with list_channels. ${invite}`)
    case 'not_in_channel':
      return invalid(`The app isn't in the channel${where}.`, invite)
    case 'is_archived':
      return invalid(`The channel${where} is archived.`)
    case 'msg_too_long':
      return invalid('The message is too long for Slack.', 'Shorten it, split it over several messages, or send the full text with upload_file.')
    case 'users_not_found':
      return invalid('No Slack user has that email.', 'Use find_user with part of their name instead.')
    case 'cannot_dm_bot':
      return invalid("Slack doesn't allow DMs to that account.")
    case 'ratelimited':
      return new AppError('upstream', 'Slack is rate limiting the app right now.', { hint: 'Wait a minute and try again.' })
    default:
      return new AppError('upstream', `Slack ${err.method} failed: ${err.code}`)
  }
}

// ---------------------------------------------------------------------------
// Tool definitions

const channelArg = {
  type: 'string',
  description:
    'Where to post: a channel ID (C0123ABCD), a channel name (#growth), or a person for a DM, by Slack user ID (U0123ABCD) or email.',
}
const contentArgs = {
  markdown: {
    type: 'string',
    description: `The message in standard Markdown (**bold**, [link](https://...), lists, headings). Up to ${MARKDOWN_LIMIT.toLocaleString()} characters. Use this or text.`,
  },
  text: {
    type: 'string',
    description: 'The message in Slack mrkdwn (*bold*, _italic_, <https://example.com|link>, <@U0123ABCD> to mention someone). With blocks, the notification fallback.',
  },
  blocks: { type: 'array', items: { type: 'object' }, description: 'Optional Block Kit blocks, for layouts Markdown can\'t express.' },
}

const TOOLS: Omit<CachedTool, 'exposedName'>[] = [
  {
    name: 'post_message',
    title: 'Post a message',
    description:
      'Post a message to a Slack channel or DM as the Brainspace app. Public channels work without inviting the app; private and Slack Connect channels need it invited first. Returns the message ts and a permalink.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: channelArg,
        ...contentArgs,
        thread_ts: { type: 'string', description: 'Reply in the thread of this message ts.' },
        reply_broadcast: { type: 'boolean', description: 'With thread_ts, also show the reply in the channel.' },
        username: { type: 'string', description: 'Post under this name instead of the app name, e.g. "Competitor digest".' },
        icon_emoji: { type: 'string', description: 'Emoji to use as the avatar, e.g. ":chart_with_upwards_trend:".' },
        icon_url: { type: 'string', description: 'Image URL to use as the avatar.' },
        unfurl_links: { type: 'boolean', description: 'Show link previews. Off by default.' },
      },
      required: ['channel'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'update_message',
    title: 'Edit a message',
    description: 'Replace the text of a message the app posted earlier. Pass the channel and ts that post_message returned.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel ID the message is in (the channel post_message returned).' },
        ts: { type: 'string', description: 'The message ts.' },
        ...contentArgs,
      },
      required: ['channel', 'ts'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'upload_file',
    title: 'Upload a file',
    description:
      'Share a file in a Slack channel or DM: a file or doc from Brainspace by path (/team/... or /me/...), or text you pass as content. An optional comment is posted with it.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: channelArg,
        path: { type: 'string', description: 'A Brainspace file or doc to send, e.g. /team/reports/q3.pdf.' },
        content: { type: 'string', description: 'Text to send as a file instead of a path, e.g. a long report or CSV.' },
        filename: { type: 'string', description: 'File name in Slack. Defaults to the Brainspace name, or file.txt for content.' },
        title: { type: 'string' },
        comment: { type: 'string', description: 'Message posted with the file, in Slack mrkdwn.' },
        thread_ts: { type: 'string', description: 'Share the file as a reply in this thread.' },
      },
      required: ['channel'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'list_channels',
    title: 'List channels',
    description:
      'Find Slack channels and their IDs. Lists public channels and the private ones the app has been invited to, with whether the app is a member.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Part of the channel name, topic or purpose.' },
        limit: { type: 'number', description: 'Most channels to return (default 100, max 1000).' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'find_user',
    title: 'Find a person',
    description: 'Look up a Slack user by email or by part of their name, to DM them or mention them as <@ID>.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        query: { type: 'string', description: 'Part of their name or display name.' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'read_messages',
    title: 'Read messages as you',
    description:
      'Read a Slack conversation as the person you act for, with their own Slack account: a channel, a DM or one thread, newest last. It sees whatever they can see, including private channels, DMs and forwarded messages. They have to have connected their own Slack account first (the Slack card under Connections, or slack_account). Not available to flows or team bots.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Conversation ID (C…, G… or D…), as given in a Slack event or a permalink.' },
        thread_ts: { type: 'string', description: 'Read this thread instead of the conversation itself.' },
        limit: { type: 'number', description: 'Most messages to return (default 30, max 200).' },
        before: { type: 'string', description: 'Only messages before this ts, to page back.' },
      },
      required: ['channel'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'view_file',
    title: 'Open a Slack file as you',
    description:
      'Open a file someone shared in Slack, as the person you act for: a screenshot, a photo, or a text file. Pass the file id (F…) that read_messages lists under a message\'s files. An image comes back as an image you can look at; a text file comes back as text. They have to have connected their own Slack account first. Not available to flows or team bots.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'File id, like F0ABC123.' } },
      required: ['file'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'search_messages',
    title: 'Search Slack as you',
    description:
      'Search Slack messages as the person you act for, across everything they can see. Takes Slack search syntax (in:#channel, from:@name, before:2026-11-01, "exact phrase"). They have to have connected their own Slack account first (the Slack card under Connections, or slack_account). Not available to flows or team bots.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Most results (default 20, max 50).' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
]

/** Tools that run with a person's own Slack token instead of the app's. */
export const SLACK_USER_TOOLS = ['read_messages', 'search_messages', 'view_file']

export function slackToolDefs(): Omit<CachedTool, 'exposedName'>[] {
  return TOOLS.map((t) => ({ ...t, inputSchema: t.inputSchema as Record<string, Json> }))
}

// ---------------------------------------------------------------------------
// Running tools

export type SlackDeps = {
  token: string
  botName?: string
  /** The caller's own Slack user token, when they connected their account and the caller may use it. */
  userToken?: string
  /** Read a Brainspace file or doc as the caller, checking their access. */
  readFile: (path: string) => Promise<{ name: string; mimeType?: string | null; data: ArrayBuffer }>
  fetch?: Fetch
}

type Ctx = SlackDeps & { api: <T extends Obj = Obj>(method: string, args?: Obj) => Promise<T> }

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

function required(a: Obj, key: string) {
  const v = str(a[key])
  if (!v) throw invalid(`Pass ${key}.`)
  return v
}

async function openDm(c: Ctx, userId: string) {
  const r = await c.api('conversations.open', { users: userId })
  return { id: r.channel.id as string, label: `DM with ${userId}` }
}

async function* channelPages(c: Ctx) {
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const r = await c.api('conversations.list', { types: 'public_channel,private_channel', exclude_archived: true, limit: 1000, cursor })
    yield (r.channels ?? []) as Obj[]
    cursor = r.response_metadata?.next_cursor || undefined
    if (!cursor) return
  }
}

export async function resolveChannel(c: Ctx, raw: string): Promise<{ id: string; label: string }> {
  let s = raw.trim()
  // Slack's own link format: <#C0123ABCD|name> or <@U0123ABCD>
  const linked = s.match(/^<[#@]([A-Z0-9]+)(\|[^>]*)?>$/)
  if (linked) s = linked[1]!
  if (/^[CGD][A-Z0-9]{6,}$/.test(s)) return { id: s, label: s }
  if (/^[UW][A-Z0-9]{6,}$/.test(s)) return openDm(c, s)
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    const u = await c.api('users.lookupByEmail', { email: s })
    return openDm(c, u.user.id)
  }
  const name = s.replace(/^#/, '').toLowerCase()
  if (!name) throw invalid('Pass a channel.')
  for await (const page of channelPages(c)) {
    const hit = page.find((ch) => String(ch.name).toLowerCase() === name)
    if (hit) return { id: hit.id, label: `#${hit.name}` }
  }
  throw invalid(
    `No channel named #${name} that the app can see.`,
    `Check the name with list_channels, or pass the channel ID. A private channel only shows up once the app is invited: type /invite @${c.botName ?? 'Brainspace'} in it.`,
  )
}

/** Retry once after joining, for public channels the app isn't in yet. */
async function withJoin<T>(c: Ctx, channel: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (!(err instanceof SlackApiError) || err.code !== 'not_in_channel' || !channel.startsWith('C')) throw err
    try {
      await c.api('conversations.join', { channel })
    } catch {
      throw err
    }
    return fn()
  }
}

function messageContent(a: Obj): Obj {
  const markdown = str(a.markdown)
  const text = typeof a.text === 'string' && a.text.trim() ? a.text : undefined
  const blocks = Array.isArray(a.blocks) && a.blocks.length ? a.blocks : undefined
  if (markdown) {
    if (text || blocks) throw invalid('Pass markdown on its own, or text (with optional blocks). Slack takes one or the other.')
    if (markdown.length > MARKDOWN_LIMIT) {
      throw invalid(`The markdown is ${markdown.length.toLocaleString()} characters. Slack allows ${MARKDOWN_LIMIT.toLocaleString()}.`, 'Shorten it, split it over several messages, or send the full text with upload_file.')
    }
    return { markdown_text: markdown }
  }
  if (blocks) return { blocks, text: text ?? 'New message' }
  if (text) return { text }
  throw invalid('Pass markdown or text.', 'markdown takes standard Markdown; text takes Slack mrkdwn.')
}

async function permalink(c: Ctx, channel: string, ts: string) {
  try {
    return (await c.api('chat.getPermalink', { channel, message_ts: ts })).permalink as string
  } catch {
    return undefined
  }
}

async function postMessage(c: Ctx, a: Obj) {
  const ch = await resolveChannel(c, required(a, 'channel'))
  const args = {
    channel: ch.id,
    ...messageContent(a),
    thread_ts: str(a.thread_ts),
    reply_broadcast: a.reply_broadcast === true ? true : undefined,
    username: str(a.username),
    icon_emoji: str(a.icon_emoji),
    icon_url: str(a.icon_url),
    unfurl_links: a.unfurl_links === true,
    unfurl_media: a.unfurl_links === true,
  }
  try {
    const r = await withJoin(c, ch.id, () => c.api('chat.postMessage', args))
    return { ok: true, channel: r.channel as string, ts: r.ts as string, permalink: await permalink(c, r.channel, r.ts) }
  } catch (err) {
    throw slackFailure(err, c.botName, ch.label)
  }
}

async function updateMessage(c: Ctx, a: Obj) {
  const channel = required(a, 'channel')
  const ts = required(a, 'ts')
  try {
    const r = await c.api('chat.update', { channel, ts, ...messageContent(a) })
    return { ok: true, channel: r.channel as string, ts: r.ts as string, permalink: await permalink(c, r.channel, r.ts) }
  } catch (err) {
    if (err instanceof SlackApiError && err.code === 'cant_update_message') {
      throw invalid("The app can only edit messages it posted.")
    }
    if (err instanceof SlackApiError && err.code === 'message_not_found') throw invalid(`No message ${ts} in ${channel}.`)
    throw slackFailure(err, c.botName, channel)
  }
}

async function uploadFile(c: Ctx, a: Obj) {
  const ch = await resolveChannel(c, required(a, 'channel'))
  let data: ArrayBuffer
  let filename: string
  if (str(a.path)) {
    const file = await c.readFile(str(a.path)!)
    data = file.data
    filename = str(a.filename) ?? file.name
  } else if (typeof a.content === 'string' && a.content.length) {
    data = new TextEncoder().encode(a.content).buffer as ArrayBuffer
    filename = str(a.filename) ?? 'file.txt'
  } else {
    throw invalid('Pass path (a Brainspace file) or content (text to send as a file).')
  }
  if (data.byteLength > UPLOAD_LIMIT) throw new AppError('too_large', `That file is over ${UPLOAD_LIMIT / 1024 / 1024} MB.`, { hint: 'Share a link to it instead.' })
  if (!data.byteLength) throw invalid('That file is empty.')
  try {
    const up = await c.api('files.getUploadURLExternal', { filename, length: String(data.byteLength) })
    const put = await (c.fetch ?? fetch)(up.upload_url, { method: 'POST', body: data, signal: AbortSignal.timeout(120_000) })
    if (!put.ok) throw new AppError('upstream', `Slack didn't accept the file upload (HTTP ${put.status}).`)
    const done = await withJoin(c, ch.id, () =>
      c.api('files.completeUploadExternal', {
        files: [{ id: up.file_id, title: str(a.title) ?? filename }],
        channel_id: ch.id,
        initial_comment: typeof a.comment === 'string' && a.comment.trim() ? a.comment : undefined,
        thread_ts: str(a.thread_ts),
      }),
    )
    return { ok: true, channel: ch.id, file: up.file_id as string, name: filename, bytes: data.byteLength, permalink: done.files?.[0]?.permalink as string | undefined }
  } catch (err) {
    throw slackFailure(err, c.botName, ch.label)
  }
}

async function listChannels(c: Ctx, a: Obj) {
  const q = str(a.query)?.toLowerCase().replace(/^#/, '')
  const limit = Math.min(Math.max(Number(a.limit) || 100, 1), 1000)
  const out: Obj[] = []
  let more = false
  try {
    for await (const page of channelPages(c)) {
      for (const ch of page) {
        const hay = `${ch.name} ${ch.topic?.value ?? ''} ${ch.purpose?.value ?? ''}`.toLowerCase()
        if (q && !hay.includes(q)) continue
        if (out.length >= limit) {
          more = true
          break
        }
        out.push({
          id: ch.id,
          name: `#${ch.name}`,
          private: !!ch.is_private,
          slackConnect: !!ch.is_ext_shared,
          appIsMember: !!ch.is_member,
          members: ch.num_members,
          topic: ch.topic?.value || undefined,
        })
      }
      if (more) break
    }
  } catch (err) {
    throw slackFailure(err, c.botName)
  }
  return {
    channels: out,
    more,
    note: 'Private channels only appear once the app is invited. The app can post in any public channel without joining.',
  }
}

function userSummary(u: Obj) {
  return {
    id: u.id as string,
    name: (u.profile?.real_name || u.real_name || u.name) as string,
    displayName: u.profile?.display_name || undefined,
    email: u.profile?.email || undefined,
    title: u.profile?.title || undefined,
    mention: `<@${u.id}>`,
  }
}

async function findUser(c: Ctx, a: Obj) {
  const email = str(a.email)
  const q = str(a.query)?.toLowerCase().replace(/^@/, '')
  if (!email && !q) throw invalid('Pass email or query.')
  try {
    if (email) {
      const r = await c.api('users.lookupByEmail', { email })
      return { users: [userSummary(r.user)] }
    }
    const users: Obj[] = []
    let cursor: string | undefined
    for (let page = 0; page < 20 && users.length < 20; page++) {
      const r = await c.api('users.list', { limit: 500, cursor })
      for (const u of r.members ?? []) {
        if (u.deleted || u.is_bot || u.id === 'USLACKBOT') continue
        const hay = `${u.name} ${u.real_name ?? ''} ${u.profile?.display_name ?? ''} ${u.profile?.email ?? ''}`.toLowerCase()
        if (hay.includes(q!)) users.push(userSummary(u))
      }
      cursor = r.response_metadata?.next_cursor || undefined
      if (!cursor) break
    }
    return { users: users.slice(0, 20) }
  } catch (err) {
    throw slackFailure(err, c.botName)
  }
}

// A Map, so a tool name like "constructor" can't reach Object.prototype.
// ---------------------------------------------------------------------------
// Reading Slack as a person (their user token)

/** One Slack message as plain data: who, when, what, and anything forwarded or attached. */
export type SlackLine = { ts: string; at: string; user?: string; name: string; text: string; forwarded?: { from?: string; text: string }[]; files?: { id?: string; name: string; type?: string }[]; thread_ts?: string; replies?: number }

/** Looks up display names once per call. */
export function nameResolver(token: string, f?: Fetch) {
  const cache = new Map<string, Promise<string>>()
  return (id: string | undefined) => {
    if (!id) return Promise.resolve('someone')
    let p = cache.get(id)
    if (!p) {
      p = slackApi(token, 'users.info', { user: id }, f)
        .then((r) => String(r.user?.profile?.display_name || r.user?.real_name || r.user?.name || id))
        .catch(() => id)
      cache.set(id, p)
    }
    return p
  }
}

/** Swap <@U123> for @Name so a message reads the way a person sees it. */
async function nameMentions(text: string, nameOf: (id: string) => Promise<string>) {
  const ids = [...new Set([...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]!))]
  const names = await Promise.all(ids.map((id) => nameOf(id)))
  return ids.reduce((t, id, i) => t.replace(new RegExp(`<@${id}(?:\\|[^>]*)?>`, 'g'), `@${names[i]}`), text)
}

export async function slackLine(m: Obj, nameOf: (id: string | undefined) => Promise<string>): Promise<SlackLine> {
  const attachments = (Array.isArray(m.attachments) ? m.attachments : []) as Obj[]
  const forwarded = attachments
    .filter((a) => a.text || a.fallback)
    .map((a) => ({ from: (a.author_name || a.author_subname || a.title || undefined) as string | undefined, text: String(a.text || a.fallback).slice(0, 4000) }))
  // The id is what view_file takes to open one.
  const files = ((Array.isArray(m.files) ? m.files : []) as Obj[]).map((x) => ({ id: str(x.id), name: String(x.title || x.name || 'file'), type: str(x.mimetype) }))
  return {
    ts: String(m.ts),
    at: new Date(Number(m.ts) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    user: m.user,
    name: m.user ? await nameOf(m.user) : String(m.username || m.bot_profile?.name || 'an app'),
    text: await nameMentions(String(m.text ?? ''), nameOf),
    ...(forwarded.length ? { forwarded } : {}),
    ...(files.length ? { files } : {}),
    ...(m.thread_ts && m.thread_ts !== m.ts ? { thread_ts: m.thread_ts } : {}),
    ...(m.reply_count ? { replies: m.reply_count } : {}),
  }
}

/** A conversation or one thread, oldest first, read with a user token. */
export async function readConversation(token: string, opts: { channel: string; thread_ts?: string; limit?: number; before?: string }, f?: Fetch) {
  const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 200)
  const r = opts.thread_ts
    ? await slackApi(token, 'conversations.replies', { channel: opts.channel, ts: opts.thread_ts, limit, ...(opts.before ? { latest: opts.before } : {}) }, f)
    : await slackApi(token, 'conversations.history', { channel: opts.channel, limit, ...(opts.before ? { latest: opts.before } : {}) }, f)
  const raw = ((r.messages ?? []) as Obj[]).slice().sort((a, b) => Number(a.ts) - Number(b.ts))
  const nameOf = nameResolver(token, f)
  return Promise.all(raw.map((m) => slackLine(m, nameOf)))
}

function userToken(c: Ctx) {
  if (!c.userToken) {
    throw new AppError('forbidden', "This reads Slack as a person, and there is no Slack user token to do it with here.", {
      hint: 'They connect their own Slack account on the Connections page in Brainspace (or ask their agent to call slack_account). Flows and team bots can\'t read Slack as a person through these tools.',
    })
  }
  return c.userToken
}

async function readMessages(c: Ctx, a: Obj) {
  const token = userToken(c)
  const channel = required(a, 'channel')
  const messages = await readConversation(token, { channel, thread_ts: str(a.thread_ts), limit: a.limit, before: str(a.before) }, c.fetch)
  return { channel, messages, note: messages.length ? undefined : 'No messages there.' }
}

async function searchMessages(c: Ctx, a: Obj) {
  const token = userToken(c)
  const count = Math.min(Math.max(Number(a.limit) || 20, 1), 50)
  const r = await slackApi(token, 'search.messages', { query: required(a, 'query'), count, sort: 'timestamp' }, c.fetch)
  const matches = ((r.messages?.matches ?? []) as Obj[]).map((m) => ({
    channel: m.channel?.id,
    channelName: m.channel?.name,
    ts: m.ts,
    at: new Date(Number(m.ts) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    name: m.username || m.user,
    text: String(m.text ?? '').slice(0, 2000),
    permalink: m.permalink,
  }))
  return { total: r.messages?.total ?? matches.length, matches }
}

const MAX_IMAGE_BYTES = 4_000_000

function base64(bytes: Uint8Array) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** The result carries `image` when the file is a picture; the caller turns that into an image the model can see. */
async function viewFile(c: Ctx, a: Obj) {
  const token = userToken(c)
  const info = await slackApi(token, 'files.info', { file: required(a, 'file') }, c.fetch)
  const f = (info.file ?? {}) as Obj
  const meta = { id: f.id as string, name: String(f.title || f.name || 'file'), type: String(f.mimetype ?? ''), size: Number(f.size ?? 0) }
  const get = async (url: string) => {
    const res = await (c.fetch ?? fetch)(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
    // Without files:read Slack answers with its sign-in page instead of the file.
    if (!res.ok || (res.headers.get('content-type') ?? '').startsWith('text/html')) {
      throw new AppError('forbidden', "Slack wouldn't hand over that file.", { hint: 'Their Slack account needs the files:read permission. Reconnecting it under Connections grants the current ones.' })
    }
    return res
  }
  if (meta.type.startsWith('image/')) {
    // A scaled copy is plenty to read a screenshot, and far smaller.
    const url = str(f.thumb_1024) ?? str(f.thumb_960) ?? str(f.thumb_720) ?? str(f.url_private_download) ?? str(f.url_private)
    if (!url) throw invalid('Slack has no download for that file.')
    const res = await get(url)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length > MAX_IMAGE_BYTES) return { file: meta, note: 'That image is too large to open here.' }
    return { file: meta, image: { mimeType: (res.headers.get('content-type') ?? meta.type).split(';')[0]!, data: base64(bytes) } }
  }
  if (meta.type.startsWith('text/') || /json|xml|csv|javascript|yaml/.test(meta.type)) {
    const url = str(f.url_private_download) ?? str(f.url_private)
    if (!url) throw invalid('Slack has no download for that file.')
    const text = await (await get(url)).text()
    return { file: meta, text: text.slice(0, 50_000), ...(text.length > 50_000 ? { note: 'Cut off at 50,000 characters.' } : {}) }
  }
  return { file: meta, note: `This tool opens images and text files. This one is ${meta.type || 'an unknown type'}.` }
}

const RUNNERS = new Map<string, (c: Ctx, a: Obj) => Promise<unknown>>([
  ['post_message', postMessage],
  ['update_message', updateMessage],
  ['upload_file', uploadFile],
  ['list_channels', listChannels],
  ['find_user', findUser],
  ['read_messages', readMessages],
  ['search_messages', searchMessages],
  ['view_file', viewFile],
])

export async function runSlackTool(deps: SlackDeps, tool: string, args: Obj) {
  const c: Ctx = { ...deps, api: (method, a) => slackApi(deps.token, method, a, deps.fetch) }
  const run = RUNNERS.get(tool)
  if (!run) throw invalid(`Slack has no tool "${tool}".`, `Use one of: ${TOOLS.map((t) => t.name).join(', ')}.`)
  try {
    return await run(c, args)
  } catch (err) {
    // Tools translate errors that need the channel name; this catches the rest (resolving a DM, say).
    throw slackFailure(err, c.botName)
  }
}

// ---------------------------------------------------------------------------
// Install

export function slackAuthorizeUrl(clientId: string, redirectUri: string, state: string) {
  const u = new URL('https://slack.com/oauth/v2/authorize')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('scope', SLACK_BOT_SCOPES.join(','))
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('state', state)
  return u.toString()
}

/** Swap the install code for a bot token. */
export async function exchangeSlackCode(client: { clientId: string; clientSecret: string }, code: string, redirectUri: string, f: Fetch = fetch) {
  const res = await f('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, code, redirect_uri: redirectUri }).toString(),
    signal: AbortSignal.timeout(30_000),
  })
  const j = (await res.json().catch(() => null)) as Obj | null
  if (!j?.ok) throw new AppError('upstream', `Slack didn't finish the install: ${j?.error ?? `HTTP ${res.status}`}.`, { hint: 'Try adding Slack again.' })
  if (!j.access_token || j.token_type !== 'bot') throw new AppError('upstream', "Slack didn't return a bot token.")
  return { token: j.access_token as string, scope: j.scope as string | undefined, appId: j.app_id as string | undefined }
}

/** Where a person goes to connect their own Slack account. Asks for user scopes only. */
export function slackUserAuthorizeUrl(clientId: string, redirectUri: string, state: string, teamId?: string) {
  const u = new URL('https://slack.com/oauth/v2/authorize')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('user_scope', SLACK_USER_SCOPES.join(','))
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('state', state)
  if (teamId) u.searchParams.set('team', teamId)
  return u.toString()
}

/** Swap the code for the person's user token. */
export async function exchangeSlackUserCode(client: { clientId: string; clientSecret: string }, code: string, redirectUri: string, f: Fetch = fetch) {
  const res = await f('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, code, redirect_uri: redirectUri }).toString(),
    signal: AbortSignal.timeout(30_000),
  })
  const j = (await res.json().catch(() => null)) as Obj | null
  if (!j?.ok) throw new AppError('upstream', `Slack didn't finish connecting your account: ${j?.error ?? `HTTP ${res.status}`}.`, { hint: 'Try connecting again.' })
  const u = j.authed_user as Obj | undefined
  if (!u?.access_token || !u.id) throw new AppError('upstream', "Slack didn't return a token for your account.")
  return { token: u.access_token as string, scope: u.scope as string | undefined, slackUserId: u.id as string, teamId: j.team?.id as string, teamName: j.team?.name as string | undefined }
}

/** Whether Block Kit blocks hold anything a person can click or type into. */
export function hasInteractiveBlocks(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false
  return blocks.some((b: Obj) => b?.type === 'actions' || b?.type === 'input' || !!b?.accessory?.action_id)
}

/** Check a bot token and learn which workspace it belongs to. */
export async function describeSlackToken(token: string, f: Fetch = fetch): Promise<SlackInstall> {
  try {
    const me = await slackApi(token, 'auth.test', {}, f)
    if (!me.bot_id) {
      throw invalid('That is a user token, so posts would come from that person.', 'Use a bot token (xoxb-...) from the Slack app, or add Slack with the Add to Slack button.')
    }
    return { teamId: me.team_id, teamName: me.team, url: me.url, botUserId: me.user_id, botName: me.user }
  } catch (err) {
    throw slackFailure(err)
  }
}
