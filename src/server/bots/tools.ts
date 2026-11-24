import { z } from 'zod'
import type { Actor } from '../actor'
import { TEAM } from '../actor'
import { eq } from 'drizzle-orm'
import { flow, flowRun, getDb, type BotPaths } from '../db'
import { AppError, forbidden } from '../errors'
import { displayPath, parsePath } from '../paths'
import { accessView, effectiveAudience } from '../services/access'
import type { ToolSpec } from '../services/ai'
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

// Built on first use: this file and the MCP tool list import each other.
let defs: Map<string, ToolDef> | undefined
const byName = { get: (name: string) => (defs ??= new Map(TOOLS.map((t) => [t.name, t]))).get(name) }

export type BotScope = {
  team: boolean
  paths: BotPaths
  tools: string[] | null
  connections: string[] | null
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

function checkConnection(scope: BotScope, slug: unknown) {
  if (!scope.connections) return
  if (typeof slug !== 'string' || !scope.connections.includes(slug.toLowerCase())) {
    throw forbidden(
      `This bot isn't allowed to use the ${String(slug ?? '')} connection.`,
      scope.connections.length ? `It may use: ${scope.connections.join(', ')}.` : 'It has no connections.',
    )
  }
}

/** A flow has its own access. A bot may only run one that stays inside the bot's. */
async function checkFlow(actor: Actor, scope: BotScope, ref: unknown) {
  const f = await findFlow(actor, String(ref ?? ''))
  if (scope.team && f.spaceId !== TEAM) throw forbidden(`Team bots can only use team flows, and ${f.name} is private.`)
  const uses = f.manifest?.uses
  if (!uses) return
  const beyond = [
    ...uses.read.filter((p) => !covered(scope.paths.read, p) && !covered(scope.paths.write, p)).map((p) => `reads ${p}`),
    ...uses.write.filter((p) => !covered(scope.paths.write, p)).map((p) => `writes ${p}`),
    ...(scope.connections ? uses.connections.filter((c) => !scope.connections!.includes(c.toLowerCase())).map((c) => `uses ${c}`) : []),
  ]
  if (beyond.length) throw forbidden(`The ${f.name} flow reaches past what this bot may touch (${beyond.join(', ')}).`, 'Widen the bot\'s paths or connections, or use a flow that stays inside them.')
}

function allowedNames(scope: BotScope) {
  return scope.tools ? BOT_TOOL_NAMES.filter((n) => scope.tools!.includes(n)) : BOT_TOOL_NAMES
}

/** The tool list sent to the model. Subagents don't get to spawn more subagents or rewrite memory. */
export function toolSpecs(scope: BotScope, opts: { subagent?: boolean } = {}): ToolSpec[] {
  const names = new Set(allowedNames(scope))
  const out: ToolSpec[] = []
  for (const name of Object.keys(GUARDS)) {
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
export async function callTool(actor: Actor, scope: BotScope, name: string, raw: unknown): Promise<string> {
  const guard = GUARDS[name]
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
  if (guard.connection && (args.connection !== undefined || name !== 'connection_tools')) checkConnection(scope, args.connection)
  if (guard.flow) await checkFlow(actor, scope, args.flow)
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
  if (name === 'flows_list' && Array.isArray(result)) result = result.filter((f) => !scope.team || (f as { space?: string }).space === 'team')
  if (name === 'connections_list' && scope.connections && Array.isArray(result)) result = result.filter((c) => scope.connections!.includes(String((c as { slug?: unknown }).slug)))
  if (name === 'connection_tools' && scope.connections && Array.isArray((result as { tools?: unknown[] })?.tools)) {
    const r = result as { connections: { slug: string }[]; tools: { connection: string }[] }
    result = { ...r, connections: r.connections.filter((c) => scope.connections!.includes(c.slug)), tools: r.tools.filter((t) => scope.connections!.includes(t.connection)) }
  }
  return text(result)
}
