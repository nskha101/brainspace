import { z } from 'zod'
import type { Actor } from '../actor'
import { TEAM } from '../actor'
import { eq } from 'drizzle-orm'
import { bot, botRun, flow, flowRun, getDb, type BotPaths } from '../db'
import { AppError, forbidden } from '../errors'
import { displayPath, parsePath } from '../paths'
import { accessView, effectiveAudience } from '../services/access'
import type { ToolImage, ToolSpec } from '../services/ai'
import { restrictedSlugs } from '../services/connections'
import { findFlow } from '../services/flows'
import { TOOLS, type ToolDef } from '../mcp/tools'

/**
 * What a bot can call. Bots use the same tools agents get over MCP, run as the
 * bot's owner, minus anything that deletes, shares, or manages the workspace.
 * Every path a tool takes is checked against the bot's own paths first, so a
 * bot can do less than its owner, never more.
 */

type Guard = {
  /** Arguments holding paths the tool reads. */
  read?: string[]
  /** Arguments holding paths the tool changes. */
  write?: string[]
  /** Result rows carry a `path`: keep only the ones the bot may read. */
  filter?: boolean
  /** Takes a connection slug in `connection`. */
  connection?: boolean
  /** Takes a flow in `flow`. */
  flow?: boolean
  /** Takes a bot in `bot`. */
  bot?: boolean
}

const GUARDS: Record<string, Guard> = {
  list: { read: ['path'] },
  read: { read: ['path'] },
  read_many: { read: ['paths'] },
  search: { read: ['pathPrefix'], filter: true },
  recent: { filter: true },
  history: { read: ['path'] },
  diff: { read: ['path'] },
  write: { write: ['path'] },
  edit: { write: ['path'] },
  append: { write: ['path'] },
  mkdir: { write: ['path'] },
  describe: { write: ['path'] },
  move: { write: ['from', 'to'] },
  copy: { read: ['from'], write: ['to'] },
  db_list: { read: ['pathPrefix'], filter: true },
  db_schema: { read: ['path'] },
  db_query: { read: ['path'] },
  db_create: { write: ['path'] },
  db_exec: { write: ['path'] },
  db_insert: { write: ['path'] },
  skills_list: {},
  skill_get: {},
  connections_list: {},
  connection_tools: { connection: true },
  connection_describe: { connection: true },
  connection_call: { connection: true },
  connection_result: {},
  flows_list: {},
  flow_get: { flow: true },
  flow_run: { flow: true },
  flow_run_get: {},
}

/**
 * What the workspace's own bot has on top: making flows and bots, and changing
 * bots, itself included. It acts as the person who asked, in the team space, so
 * everything here is kept to team flows and team bots.
 */
const BUILDER_GUARDS: Record<string, Guard> = {
  folder_notes: { write: ['path'] },
  flow_templates: {},
  flow_create: {},
  flow_test: { flow: true },
  flow_triggers_list: { flow: true },
  flow_trigger_set: { flow: true },
  bots_list: {},
  bot_get: { bot: true },
  bot_create: {},
  bot_update: { bot: true },
  bot_run: { bot: true },
  bot_run_get: {},
}

/** Tools only a bot has, handled by the agent itself. */
export const OWN_TOOLS: ToolSpec[] = [
  {
    name: 'remember',
    description:
      'Replace your memory: short notes that are shown to you at the start of every later run. Use it for what the next run needs, like what you already reported or where you left off. Pass the whole memory each time, 4,000 characters at most.',
    parameters: { type: 'object', properties: { memory: { type: 'string' } }, required: ['memory'], additionalProperties: false },
  },
  {
    name: 'run_subagents',
    description:
      'Hand independent pieces of work to subagents that run at the same time, each with a fresh context and the same tools and access as you. Give each a short name and a task that stands on its own: it sees nothing of this conversation. Returns each one\'s report. Use it when the job splits cleanly (one per competitor, one per folder), not for a single small step.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Short label, e.g. "linear".' }, task: { type: 'string' } },
            required: ['name', 'task'],
            additionalProperties: false,
          },
        },
      },
      required: ['tasks'],
      additionalProperties: false,
    },
  },
]

export const BOT_TOOL_NAMES = [...Object.keys(GUARDS), ...OWN_TOOLS.map((t) => t.name)]

const guardsFor = (scope: Pick<BotScope, 'builder'>) => (scope.builder ? { ...GUARDS, ...BUILDER_GUARDS } : GUARDS)

/** Every tool a bot of this kind can be given. */
export const toolNamesFor = (scope: Pick<BotScope, 'builder'>) => (scope.builder ? [...Object.keys(GUARDS), ...Object.keys(BUILDER_GUARDS), ...OWN_TOOLS.map((t) => t.name)] : BOT_TOOL_NAMES)

// Built on first use: this file and the MCP tool list import each other.
let defs: Map<string, ToolDef> | undefined
const byName = { get: (name: string) => (defs ??= new Map(TOOLS.map((t) => [t.name, t]))).get(name) }

export type BotScope = {
  team: boolean
  paths: BotPaths
  tools: string[] | null
  /** The connections it was given. A bot has none until some are added. */
  connections: string[]
  /** The workspace's own bot: it also makes flows and bots, and can change itself. */
  builder?: boolean
  botId?: string
  /** Someone other than the bot's owner asked for this run. It still acts as the owner, so it stays out of restricted connections. */
  guest?: boolean
}

export function covered(list: string[], p: string) {
  return list.some((q) => q === '/' || p === q || p.startsWith(q.endsWith('/') ? q : q + '/'))
}

/** A path as the bot wrote it, checked and normalized to /team/... or /me/... */
function checkPath(actor: Actor, scope: BotScope, input: unknown, write: boolean): string {
  if (typeof input !== 'string' || !input) throw new AppError('invalid', 'Pass a path like /team/reports/weekly.md.')
  const p = parsePath(actor, input)
  const shown = displayPath(actor, p.spaceId, p.path)
  if (scope.team && p.spaceId !== TEAM) throw forbidden(`Team bots can't use personal spaces (${shown}).`)
  const ok = write ? covered(scope.paths.write, shown) : covered(scope.paths.read, shown) || covered(scope.paths.write, shown)
  if (!ok) {
    const allowed = write ? scope.paths.write : [...new Set([...scope.paths.read, ...scope.paths.write])]
    throw forbidden(
      `This bot isn't allowed to ${write ? 'change' : 'read'} ${shown}.`,
      allowed.length ? `It may ${write ? 'change' : 'read'}: ${allowed.join(', ')}.` : `It has no ${write ? 'write' : 'read'} access at all.`,
    )
  }
  return shown
}

function checkConnection(scope: BotScope, slug: unknown, closed: Set<string>) {
  if (typeof slug === 'string' && closed.has(slug.toLowerCase())) {
    throw forbidden(`The ${slug} connection is restricted, so this bot only uses it when its owner is the one asking.`, 'Tell the person that only the bot\'s owner can ask for this.')
  }
  if (typeof slug !== 'string' || !scope.connections.includes(slug.toLowerCase())) {
    throw forbidden(
      `This bot isn't allowed to use the ${String(slug ?? '')} connection.`,
      scope.connections.length ? `It may use: ${scope.connections.join(', ')}.` : 'It has no connections. Its owner can add some to it.',
    )
  }
}

/** A flow has its own access. A bot may only run one that stays inside the bot's. */
async function checkFlow(actor: Actor, scope: BotScope, ref: unknown, closed: Set<string>) {
  const f = await findFlow(actor, String(ref ?? ''))
  if (scope.team && f.spaceId !== TEAM) throw forbidden(`Team bots can only use team flows, and ${f.name} is private.`)
  const uses = f.manifest?.uses
  if (!uses) return
  const shut = uses.connections.filter((c) => closed.has(c.toLowerCase()))
  if (shut.length) throw forbidden(`The ${f.name} flow uses a restricted connection (${shut.join(', ')}), so this bot only runs it when its owner is the one asking.`)
  const beyond = [
    ...uses.read.filter((p) => !covered(scope.paths.read, p) && !covered(scope.paths.write, p)).map((p) => `reads ${p}`),
    ...uses.write.filter((p) => !covered(scope.paths.write, p)).map((p) => `writes ${p}`),
    ...uses.connections.filter((c) => !scope.connections.includes(c.toLowerCase())).map((c) => `uses ${c}`),
  ]
  if (beyond.length) throw forbidden(`The ${f.name} flow reaches past what this bot may touch (${beyond.join(', ')}).`, 'Widen the bot\'s paths or connections, or use a flow that stays inside them.')
}

function allowedNames(scope: BotScope) {
  const all = toolNamesFor(scope)
  return scope.tools ? all.filter((n) => scope.tools!.includes(n)) : all
}

/** Where a run's outputs go is access too: a doc the bot may write, or a connection it may call. */
function checkDeliver(scope: BotScope, deliver: unknown, closed: Set<string>) {
  for (const d of Array.isArray(deliver) ? (deliver as Record<string, unknown>[]) : []) {
    if (d?.to === 'space') {
      const p = `/${String(d.path ?? '').replace(/^\/+/, '')}`
      if ((scope.team && !p.startsWith('/team/')) || !covered(scope.paths.write, p)) throw forbidden(`This bot isn't allowed to deliver to ${p}.`, `It may change: ${scope.paths.write.join(', ') || 'nothing'}.`)
    }
    if (d?.to === 'connection') checkConnection(scope, d.connection, closed)
  }
}

/** The workspace's own bot works with team bots only: its runs are open to everyone. */
async function checkBot(actor: Actor, scope: BotScope, name: string, args: Record<string, unknown>) {
  const { findBot } = await import('../services/bots')
  const b = await findBot(actor, String(args.bot ?? ''))
  if (b.visibility !== 'team') throw forbidden(`${b.name} is a private bot, and this bot only works with team bots.`, 'Its owner can use it from their own agent or its page.')
  if (name === 'bot_run' && b.id === scope.botId) throw forbidden("You can't start a run of yourself from inside a run.")
  if (name === 'bot_update' && args.visibility === 'private') throw forbidden("This bot can't make a bot private.", 'Its owner can do that from the bot\'s page.')
  args.bot = b.id
}

/** The tool list sent to the model. Subagents don't get to spawn more subagents or rewrite memory. */
export function toolSpecs(scope: BotScope, opts: { subagent?: boolean } = {}): ToolSpec[] {
  const names = new Set(allowedNames(scope))
  const out: ToolSpec[] = []
  for (const name of Object.keys(guardsFor(scope))) {
    const def = byName.get(name)
    if (!def || !names.has(name)) continue
    const schema = z.toJSONSchema(def.schema, { io: 'input' }) as Record<string, unknown>
    delete schema.$schema
    out.push({ name, description: def.description, parameters: schema })
  }
  if (!opts.subagent) out.push(...OWN_TOOLS.filter((t) => names.has(t.name)))
  return out
}

const MAX_RESULT = 24_000

function text(value: unknown) {
  const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return s.length > MAX_RESULT ? `${s.slice(0, MAX_RESULT)}\n\n[Cut off: ${s.length.toLocaleString()} characters in all. Ask for less at a time (offset and limit, a narrower path, fewer rows).]` : s
}

/** Run one of the shared tools for a bot. Throws AppError for anything outside its scope. */
export async function callTool(actor: Actor, scope: BotScope, name: string, raw: unknown): Promise<{ text: string; images: ToolImage[] }> {
  const guard = guardsFor(scope)[name]
  const def = byName.get(name)
  if (!guard || !def || !allowedNames(scope).includes(name)) {
    throw new AppError('not_found', `There is no "${name}" tool.`, { hint: 'Use only the tools you were given.' })
  }
  const args = def.schema.parse(raw ?? {}) as Record<string, unknown>
  // Everyone can read a team bot's runs, so it stays out of folders that only some people can open.
  const view = scope.team ? await accessView(actor) : null
  const restricted = (shown: string) => !!view && effectiveAudience(view, shown.replace(/^\/team/, '') || '/') !== null
  const check = (p: unknown, write: boolean) => {
    const shown = checkPath(actor, scope, p, write)
    if (restricted(shown)) throw forbidden(`${shown} is restricted to certain people, and a team bot's runs are open to everyone.`, 'Make the bot private to let it work there.')
    return shown
  }
  for (const [keys, write] of [[guard.read ?? [], false], [guard.write ?? [], true]] as const) {
    for (const key of keys) {
      const v = args[key]
      if (v === undefined) continue
      args[key] = Array.isArray(v) ? v.map((p) => check(p, write)) : check(v, write)
    }
  }
  const closed = scope.guest ? await restrictedSlugs(actor.workspaceId) : new Set<string>()
  if (guard.connection && (args.connection !== undefined || name !== 'connection_tools')) checkConnection(scope, args.connection, closed)
  if (scope.team && name === 'connection_call' && ['read_messages', 'search_messages', 'view_file', 'slack__read_messages', 'slack__search_messages', 'slack__view_file'].includes(String(args.tool))) {
    throw forbidden("A team bot's runs are open to everyone, so it can't read Slack as its owner.", 'Make the bot private to let it read your Slack.')
  }
  if (guard.flow) await checkFlow(actor, scope, args.flow, closed)
  if (guard.bot) await checkBot(actor, scope, name, args)
  if (name === 'flow_run' || name === 'flow_test' || name === 'flow_trigger_set') checkDeliver(scope, args.deliver, closed)
  // What it makes goes in the team space, where the person asking and everyone else can see it.
  if (name === 'flow_create') args.space = 'team'
  if (name === 'bot_create') args.visibility = 'team'
  if (name === 'bot_run_get') {
    const [r] = await getDb().select({ visibility: bot.visibility }).from(botRun).innerJoin(bot, eq(bot.id, botRun.botId)).where(eq(botRun.id, String(args.runId)))
    if (r && r.visibility !== 'team') throw forbidden('This bot can only look at runs of team bots.')
  }
  if (scope.team && (name === 'search' || name === 'recent')) args.space = 'team'
  if (scope.team && name === 'flow_run_get') {
    const [r] = await getDb().select({ spaceId: flow.spaceId }).from(flowRun).innerJoin(flow, eq(flow.id, flowRun.flowId)).where(eq(flowRun.id, String(args.runId)))
    if (r && r.spaceId !== TEAM) throw forbidden('Team bots can only look at runs of team flows.')
  }

  let result = await def.run(actor, args)

  const readable = (p: unknown) =>
    typeof p === 'string' && (!scope.team || (p.startsWith('/team') && !restricted(p))) && (covered(scope.paths.read, p) || covered(scope.paths.write, p))
  if (guard.filter && Array.isArray(result)) result = result.filter((r) => readable((r as { path?: unknown }).path))
  if (name === 'db_list') {
    const r = result as { databases: { path: string }[] }
    result = { ...r, databases: r.databases.filter((d) => readable(d.path)) }
  }
  // A folder listing names what's inside, including restricted things the owner can see.
  if (view && (name === 'list' || name === 'read') && result && typeof result === 'object' && Array.isArray((result as { entries?: unknown }).entries)) {
    const r = result as { entries: (string | { path: string })[] }
    result = { ...r, entries: r.entries.filter((e) => !restricted(typeof e === 'string' ? e : e.path)) }
  }
  if (name === 'skills_list' && Array.isArray(result)) result = result.filter((s) => !scope.team || (s as { space?: string }).space !== 'me')
  if (name === 'skill_get' && scope.team && String((result as { path?: unknown })?.path ?? '').startsWith('/me')) throw forbidden("Team bots can't use private skills.")
  if (name === 'bots_list' && Array.isArray(result)) result = result.filter((b) => (b as { visibility?: string }).visibility === 'team')
  if (name === 'flows_list' && Array.isArray(result)) result = result.filter((f) => !scope.team || (f as { space?: string }).space === 'team')
  const usable = (slug: string) => !closed.has(slug) && scope.connections.includes(slug)
  if (name === 'connections_list' && Array.isArray(result)) result = result.filter((c) => usable(String((c as { slug?: unknown }).slug)))
  if (name === 'connection_tools' && Array.isArray((result as { tools?: unknown[] })?.tools)) {
    const r = result as { connections: { slug: string }[]; tools: { connection: string }[] }
    result = { ...r, connections: r.connections.filter((c) => usable(c.slug)), tools: r.tools.filter((t) => usable(t.connection)) }
  }
  // Pictures a connection hands back (a Slack screenshot, say) travel beside the text, for the model to look at.
  const images: ToolImage[] = []
  const blocks = (result as { content?: { type?: string; data?: string; mimeType?: string }[] } | null)?.content
  if (Array.isArray(blocks) && blocks.some((b) => b?.type === 'image')) {
    for (const b of blocks) if (b?.type === 'image' && b.data && b.mimeType) images.push({ mimeType: b.mimeType, data: b.data })
    result = { ...(result as object), content: blocks.filter((b) => b?.type !== 'image') }
  }
  return { text: text(result), images }
}
