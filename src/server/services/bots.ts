import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM, requireRole } from '../actor'
import type { BrainBot } from '../bots/agent'
import { BOT_TOOL_NAMES, type BotScope } from '../bots/tools'
import { newId, randomToken, sha256Hex } from '../crypto'
import { bot, botRun, botRunEvent, getDb, user, type BotPaths, type BotRunStatus } from '../db'
import { appUrl, getEnv } from '../env'
import { AppError, forbidden, invalid, notFound } from '../errors'
import { publishSystemChange } from '../live'
import { displayPath, parsePath } from '../paths'
import { logActivity } from './activity'
import { aiSettings } from './ai'
import { listConnections } from './connections'
import { checkCron, describeCron, nextRun } from './flows'
import { actorFor } from './workspaces'

/**
 * Bots: agents that run on a schedule. A person's agent sets one up (what to
 * do, how often, which model, what it may touch) and Brainspace runs it from
 * then on. Each bot is a Durable Object built on the Cloudflare Agents SDK
 * (src/server/bots/agent.ts). This file is everything around it: the rows the
 * app and agents list, who may see and change a bot, and the run history.
 */

export type BotRow = typeof bot.$inferSelect
export type BotRunRow = typeof botRun.$inferSelect

const MAX_BOTS = 50
/** A run that has been going this long is treated as lost, so the bot isn't stuck behind it. */
export const STALE_RUN_MS = 20 * 60_000
const MAX_EVENT_TEXT = 6000
/** The most a webhook or a flow can hand a run. */
export const MAX_INPUT_BYTES = 100_000
const MAX_WEBHOOK_RUNS_PER_HOUR = 120
const WEBHOOK_PREFIX = 'bbh_'

// ------------------------------------------------------------------ access

const canSee = (actor: Actor, b: BotRow) => b.workspaceId === actor.workspaceId && (b.visibility === 'team' || b.ownerId === actor.userId)

/** Private bots are only their owner's business. */
const audienceOf = (b: Pick<BotRow, 'visibility' | 'ownerId'>) => (b.visibility === 'team' ? null : [b.ownerId])

function notify(b: Pick<BotRow, 'workspaceId' | 'visibility' | 'ownerId'>, action: string) {
  publishSystemChange(b.workspaceId, { spaceId: b.visibility === 'team' ? TEAM : b.ownerId, path: null, action, scope: 'bots' })
}

async function visibleBots(actor: Actor) {
  return getDb()
    .select()
    .from(bot)
    .where(and(eq(bot.workspaceId, actor.workspaceId), or(eq(bot.visibility, 'team'), eq(bot.ownerId, actor.userId))))
    .orderBy(bot.name)
}

export async function findBot(actor: Actor, ref: string): Promise<BotRow> {
  const key = String(ref ?? '').trim()
  const all = await visibleBots(actor)
  const k = key.toLowerCase()
  const hit =
    all.find((b) => b.id === key) ??
    // Your own bot wins over a teammate's with the same name.
    all.find((b) => b.ownerId === actor.userId && b.name.toLowerCase() === k) ??
    all.find((b) => b.name.toLowerCase() === k)
  if (!hit) throw notFound(`Bot "${ref}"`, 'Use bots_list to see the bots you can use.')
  return hit
}

function requireOwner(actor: Actor, b: BotRow, doing: string) {
  if (b.ownerId !== actor.userId) {
    throw forbidden(`Only the person a bot runs as can ${doing}.`, 'This bot acts with its owner\'s access, so its owner decides what it does. Admins can pause or delete it.')
  }
}

// ------------------------------------------------------------------ the agent behind a bot

/** The Durable Object for a bot. Its name is the bot's id. */
async function agent(botId: string): Promise<DurableObjectStub<BrainBot>> {
  // Loaded here, not at the top, so tools that only describe bots don't pull in the Agents SDK.
  const { getAgentByName } = await import('agents')
  return getAgentByName(getEnv().BOTS as unknown as DurableObjectNamespace<BrainBot>, botId)
}

/** The actor a run acts as: the bot's owner, marked as the bot. */
export async function botActor(b: BotRow): Promise<Actor> {
  const [u] = await getDb().select().from(user).where(eq(user.id, b.ownerId))
  if (!u) throw forbidden('The person this bot runs as no longer exists.')
  let a: Actor
  try {
    a = await actorFor(u, b.workspaceId, 'bot', b.name)
  } catch {
    throw forbidden(`${u.name} is no longer in this workspace, so this bot can't run as them.`)
  }
  if (a.role === 'viewer') throw forbidden(`${u.name} is read-only now, so this bot can't run as them.`)
  return a
}

export function scopeOf(b: BotRow): BotScope {
  return { team: b.visibility === 'team', paths: b.paths, tools: b.tools, connections: b.connections }
}

export async function loadBot(id: string) {
  const [b] = await getDb().select().from(bot).where(eq(bot.id, id))
  return b
}

// ------------------------------------------------------------------ validation

export type BotInput = {
  name?: string
  description?: string | null
  instructions?: string
  visibility?: 'private' | 'team'
  model?: string | null
  cron?: string | null
  timezone?: string
  tools?: string[] | null
  connections?: string[] | null
  paths?: { read?: string[]; write?: string[] } | null
  enabled?: boolean
  /** true makes a new webhook URL (replacing any old one), false removes it. */
  webhook?: boolean
}

function defaultPaths(visibility: 'private' | 'team'): BotPaths {
  const all = visibility === 'team' ? ['/team'] : ['/team', '/me']
  return { read: all, write: all }
}

function cleanPaths(actor: Actor, visibility: 'private' | 'team', input: BotInput['paths']): BotPaths {
  if (!input) return defaultPaths(visibility)
  const norm = (list: string[] | undefined, fallback: string[]) =>
    list === undefined
      ? fallback
      : [...new Set(list.map((raw) => {
          const p = parsePath(actor, raw)
          const shown = displayPath(actor, p.spaceId, p.path)
          if (visibility === 'team' && p.spaceId !== TEAM) {
            throw invalid(`A team bot can't use ${shown}.`, 'Team bots work in /team only. Make the bot private to let it use your /me space.')
          }
          return shown
        }))]
  const d = defaultPaths(visibility)
  return { read: norm(input.read, d.read), write: norm(input.write, d.write) }
}

function cleanTools(tools: string[] | null | undefined) {
  if (tools == null) return null
  const unknown = tools.filter((t) => !BOT_TOOL_NAMES.includes(t))
  if (unknown.length) throw invalid(`Bots have no ${unknown.map((t) => `"${t}"`).join(', ')} tool.`, `Choose from: ${BOT_TOOL_NAMES.join(', ')}.`)
  return [...new Set(tools)]
}

async function cleanConnections(actor: Actor, slugs: string[] | null | undefined) {
  if (slugs == null) return null
  const usable = (await listConnections(actor, { usableOnly: true })).map((c) => c.slug)
  const out = [...new Set(slugs.map((s) => s.trim().toLowerCase()))]
  const missing = out.filter((s) => !usable.includes(s))
  if (missing.length) throw invalid(`You can't use ${missing.join(', ')}.`, usable.length ? `Connections you can use: ${usable.join(', ')}.` : 'There are no connections you can use yet.')
  return out
}

function cleanModel(model: string | null | undefined) {
  const m = model?.trim()
  if (!m) return null
  if (!/^[a-z0-9-]+\/[A-Za-z0-9._:-]+$/.test(m)) throw invalid(`"${m}" doesn't look like an AI Gateway model id.`, 'Use provider/model, like anthropic/claude-sonnet-5.5. workspace_ai with listModels shows them all.')
  return m
}

function cleanName(name: string | undefined) {
  const n = (name ?? '').trim().replace(/\s+/g, ' ')
  if (!n || n.length > 60) throw invalid('Give the bot a name of 60 characters or fewer.', 'Something a person would recognize in a list, like "Monday competitor digest".')
  return n
}

function cleanInstructions(text: string | undefined) {
  const t = (text ?? '').trim()
  if (t.length < 10) throw invalid('Say what the bot should do on each run.', 'Write instructions the way you would brief a colleague: what to check, where to write, when to stay quiet.')
  if (t.length > 12_000) throw invalid('Keep the instructions under 12,000 characters.', 'Put long reference material in a doc and tell the bot to read it.')
  return t
}

function schedule(cron: string | null | undefined, timezone: string) {
  const c = cron?.trim() || null
  if (c) checkCron(c, timezone)
  return c
}

// ------------------------------------------------------------------ read APIs

async function names(ids: string[]) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return new Map<string, string>()
  const rows = await getDb().select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, uniq))
  return new Map(rows.map((r) => [r.id, r.name]))
}

function botInfo(actor: Actor, b: BotRow, people: Map<string, string>) {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    visibility: b.visibility,
    owner: people.get(b.ownerId) ?? 'Someone',
    mine: b.ownerId === actor.userId,
    schedule: b.cron ? describeCron(b.cron, b.timezone) : null,
    cron: b.cron,
    timezone: b.timezone,
    model: b.model,
    enabled: b.enabled,
    pausedReason: b.pausedReason,
    webhook: !!b.webhookTokenHash,
    nextRunAt: b.enabled && b.nextRunAt ? b.nextRunAt.getTime() : null,
    lastRun: b.lastRunId ? { id: b.lastRunId, status: b.lastStatus, at: b.lastRunAt?.getTime() ?? null } : null,
  }
}

export async function listBots(actor: Actor) {
  const rows = await visibleBots(actor)
  const people = await names(rows.map((b) => b.ownerId))
  return rows.map((b) => botInfo(actor, b, people))
}

function runInfo(r: BotRunRow, people: Map<string, string>) {
  return {
    id: r.id,
    status: r.status,
    trigger: r.trigger,
    startedBy: r.startedBy ? (people.get(r.startedBy) ?? 'Someone') : null,
    prompt: r.prompt,
    input: r.input,
    flowRunId: r.flowRunId,
    model: r.model,
    summary: r.summary,
    error: r.error,
    steps: r.steps,
    tokens: r.tokens,
    createdAt: r.createdAt.getTime(),
    startedAt: r.startedAt?.getTime() ?? null,
    finishedAt: r.finishedAt?.getTime() ?? null,
  }
}

export async function getBot(actor: Actor, ref: string) {
  const b = await findBot(actor, ref)
  await failStale(b.id)
  const runs = await getDb().select().from(botRun).where(eq(botRun.botId, b.id)).orderBy(desc(botRun.createdAt)).limit(30)
  const [people, ai, memory] = await Promise.all([
    names([b.ownerId, ...runs.map((r) => r.startedBy ?? '')]),
    aiSettings(b.workspaceId),
    // The bot's own notes live with its agent. Only its owner reads them.
    b.ownerId === actor.userId ? agent(b.id).then((a) => a.memory()).catch(() => '') : Promise.resolve(undefined),
  ])
  return {
    ...botInfo(actor, b, people),
    instructions: b.instructions,
    tools: b.tools,
    allTools: BOT_TOOL_NAMES,
    connections: b.connections,
    paths: b.paths,
    effectiveModel: b.model ?? ai.model,
    aiConfigured: !!ai.key,
    memory,
    canEdit: b.ownerId === actor.userId && actor.role !== 'viewer',
    canRun: actor.role !== 'viewer',
    canManage: (b.ownerId === actor.userId || actor.role === 'admin') && actor.role !== 'viewer',
    runs: runs.map((r) => runInfo(r, people)),
  }
}

export async function listRuns(actor: Actor, opts: { bot?: string; status?: BotRunStatus; limit?: number } = {}) {
  const bots = opts.bot ? [await findBot(actor, opts.bot)] : await visibleBots(actor)
  if (!bots.length) return []
  const rows = await getDb()
    .select()
    .from(botRun)
    .where(and(inArray(botRun.botId, bots.map((b) => b.id)), ...(opts.status ? [eq(botRun.status, opts.status)] : [])))
    .orderBy(desc(botRun.createdAt))
    .limit(Math.min(opts.limit ?? 30, 200))
  const people = await names(rows.map((r) => r.startedBy ?? ''))
  const byId = new Map(bots.map((b) => [b.id, b.name]))
  return rows.map((r) => ({ bot: byId.get(r.botId) ?? '', botId: r.botId, ...runInfo(r, people) }))
}

async function requireRun(actor: Actor, runId: string) {
  const [r] = await getDb().select().from(botRun).where(and(eq(botRun.id, runId), eq(botRun.workspaceId, actor.workspaceId)))
  const b = r ? await loadBot(r.botId) : undefined
  if (!r || !b || !canSee(actor, b)) throw notFound(`Run "${runId}"`, 'Use bot_runs to list recent runs.')
  return { run: r, bot: b }
}

export async function getRun(actor: Actor, runId: string) {
  const { run: r, bot: b } = await requireRun(actor, runId)
  const [events, people] = await Promise.all([
    getDb().select().from(botRunEvent).where(eq(botRunEvent.runId, r.id)).orderBy(botRunEvent.id).limit(1000),
    names([r.startedBy ?? '', b.ownerId]),
  ])
  return {
    bot: b.name,
    botId: b.id,
    runsAs: people.get(b.ownerId) ?? 'Someone',
    ...runInfo(r, people),
    canCancel: actor.role !== 'viewer' && (b.ownerId === actor.userId || actor.role === 'admin' || r.startedBy === actor.userId),
    events: events.map((e) => ({ id: e.id, at: e.at.getTime(), kind: e.kind, agent: e.agent, name: e.name, input: e.input, output: e.output, ok: e.ok })),
  }
}

// ------------------------------------------------------------------ changes

export async function createBot(actor: Actor, input: BotInput) {
  requireRole(actor, 'member', 'create bots')
  const db = getDb()
  const visibility = input.visibility === 'team' ? 'team' : 'private'
  const name = cleanName(input.name)
  const timezone = input.timezone?.trim() || 'UTC'
  const values = {
    id: newId('bot'),
    workspaceId: actor.workspaceId,
    name,
    description: input.description?.trim().slice(0, 300) || null,
    instructions: cleanInstructions(input.instructions),
    visibility,
    ownerId: actor.userId,
    model: cleanModel(input.model),
    cron: schedule(input.cron, timezone),
    timezone,
    tools: cleanTools(input.tools),
    connections: await cleanConnections(actor, input.connections),
    paths: cleanPaths(actor, visibility, input.paths),
    enabled: input.enabled !== false,
  } satisfies typeof bot.$inferInsert

  const [count] = await db.select({ n: sql<number>`count(*)` }).from(bot).where(eq(bot.workspaceId, actor.workspaceId))
  if ((count?.n ?? 0) >= MAX_BOTS) throw new AppError('conflict', `This workspace already has ${MAX_BOTS} bots.`, { hint: 'Delete ones nobody uses with bot_delete.' })
  const [taken] = await db.select({ id: bot.id }).from(bot).where(and(eq(bot.workspaceId, actor.workspaceId), eq(bot.ownerId, actor.userId), sql`lower(${bot.name}) = ${name.toLowerCase()}`))
  if (taken) throw new AppError('conflict', `You already have a bot called "${name}".`, { hint: 'Change that one with bot_update, or pick another name.' })

  await db.insert(bot).values(values)
  const hook = input.webhook ? await newWebhook(values.id) : undefined
  await (await agent(values.id)).sync()
  await logActivity(actor, 'bot_create', { details: { bot: name, botId: values.id, schedule: values.cron ? describeCron(values.cron, timezone) : 'on demand' }, audience: audienceOf(values) })
  notify(values, 'bot_create')
  const ai = await aiSettings(actor.workspaceId)
  return {
    ...(await getBot(actor, values.id)),
    runs: undefined,
    ...hook,
    note: ai.key ? undefined : 'AI is not set up for this workspace yet, so runs will fail until an admin adds a Vercel AI Gateway key in Settings → AI.',
  }
}

export async function updateBot(actor: Actor, ref: string, input: BotInput) {
  const b = await findBot(actor, ref)
  requireRole(actor, 'member', 'change bots')
  const onlyPausing = Object.keys(input).every((k) => k === 'enabled' || (input as Record<string, unknown>)[k] === undefined)
  // Admins can stop a team bot, but what it does is up to the person it runs as.
  if (!(onlyPausing && input.enabled === false && actor.role === 'admin')) requireOwner(actor, b, 'change it')

  const visibility = input.visibility ?? b.visibility
  const timezone = input.timezone?.trim() || b.timezone
  const set: Partial<typeof bot.$inferInsert> = { updatedAt: new Date() }
  if (input.name !== undefined) set.name = cleanName(input.name)
  if (input.description !== undefined) set.description = input.description?.trim().slice(0, 300) || null
  if (input.instructions !== undefined) set.instructions = cleanInstructions(input.instructions)
  if (input.model !== undefined) set.model = cleanModel(input.model)
  if (input.tools !== undefined) set.tools = cleanTools(input.tools)
  if (input.connections !== undefined) set.connections = await cleanConnections(actor, input.connections)
  if (input.cron !== undefined || input.timezone !== undefined) {
    set.cron = schedule(input.cron !== undefined ? input.cron : b.cron, timezone)
    set.timezone = timezone
  }
  if (input.visibility !== undefined) set.visibility = visibility
  if (input.paths !== undefined) set.paths = cleanPaths(actor, visibility, input.paths)
  else if (visibility === 'team' && b.visibility !== 'team') {
    // Sharing a bot takes it out of its owner's personal space.
    const keep = (list: string[]) => list.filter((p) => p.startsWith('/team'))
    const paths = { read: keep(b.paths.read), write: keep(b.paths.write) }
    set.paths = paths.read.length || paths.write.length ? paths : defaultPaths('team')
  }
  if (input.enabled !== undefined) {
    set.enabled = input.enabled
    set.pausedReason = null
  }
  if (input.webhook === false) set.webhookTokenHash = null
  if (set.name && set.name.toLowerCase() !== b.name.toLowerCase()) {
    const [taken] = await getDb().select({ id: bot.id }).from(bot).where(and(eq(bot.workspaceId, b.workspaceId), eq(bot.ownerId, b.ownerId), sql`lower(${bot.name}) = ${set.name.toLowerCase()}`))
    if (taken) throw new AppError('conflict', `You already have a bot called "${set.name}".`)
  }
  await getDb().update(bot).set(set).where(eq(bot.id, b.id))
  const hook = input.webhook ? await newWebhook(b.id) : undefined
  await (await agent(b.id)).sync()
  const after = { ...b, ...set } as BotRow
  const action = onlyPausing && input.enabled !== undefined ? (input.enabled ? 'bot_resume' : 'bot_pause') : 'bot_update'
  // Someone a bot was just hidden from should still see that it changed.
  await logActivity(actor, action, { details: { bot: after.name, botId: b.id, changed: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined) }, audience: audienceOf(after) })
  notify(b, action)
  if (after.visibility !== b.visibility) notify(after, action)
  return { ...(await getBot(actor, b.id)), runs: undefined, ...hook }
}

export async function deleteBot(actor: Actor, ref: string) {
  const b = await findBot(actor, ref)
  requireRole(actor, 'member', 'delete bots')
  if (b.ownerId !== actor.userId && actor.role !== 'admin') throw forbidden('Only the bot\'s owner or an admin can delete it.')
  // Stop the agent first: once the row is gone nothing would ever cancel its schedule.
  await (await agent(b.id)).remove().catch((err) => console.error('[bots] remove agent failed', b.id, err))
  await getDb().delete(bot).where(eq(bot.id, b.id))
  await logActivity(actor, 'bot_delete', { details: { bot: b.name, botId: b.id }, audience: audienceOf(b) })
  notify(b, 'bot_delete')
  return { deleted: b.name }
}

// ------------------------------------------------------------------ runs

/** Mark runs that never finished (the agent was evicted mid-run) so they don't block the next one. */
async function failStale(botId: string) {
  const lost = await getDb()
    .update(botRun)
    .set({ status: 'failed', error: 'The run stopped before it finished.', finishedAt: new Date() })
    .where(and(eq(botRun.botId, botId), inArray(botRun.status, ['queued', 'running']), sql`${botRun.createdAt} < ${Date.now() - STALE_RUN_MS}`))
    .returning({ id: botRun.id, flowRunId: botRun.flowRunId })
  if (lost.length) await getDb().update(bot).set({ lastStatus: 'failed' }).where(and(eq(bot.id, botId), inArray(bot.lastRunId, lost.map((r) => r.id))))
  for (const r of lost) await tellFlow(r, 'failed')
}

/**
 * Record a new run, or return null when the bot is already running. Called by
 * the agent for scheduled runs and by runBot for manual ones.
 */
export async function beginRun(
  b: BotRow,
  opts: { trigger: BotRunRow['trigger']; startedBy?: string | null; prompt?: string | null; input?: string | null; flowRunId?: string | null; id?: string },
) {
  await failStale(b.id)
  const db = getDb()
  const [active] = await db.select({ id: botRun.id }).from(botRun).where(and(eq(botRun.botId, b.id), inArray(botRun.status, ['queued', 'running']))).limit(1)
  if (active) return null
  const id = opts.id ?? newId('brun')
  await db.insert(botRun).values({
    id,
    botId: b.id,
    workspaceId: b.workspaceId,
    status: 'queued',
    trigger: opts.trigger,
    startedBy: opts.startedBy ?? null,
    prompt: opts.prompt ?? null,
    input: opts.input ?? null,
    flowRunId: opts.flowRunId ?? null,
  })
  await db.update(bot).set({ lastRunId: id, lastRunAt: new Date(), lastStatus: 'queued' }).where(eq(bot.id, b.id))
  notify(b, 'bot_run')
  return id
}

export async function runBot(actor: Actor, ref: string, opts: { prompt?: string } = {}) {
  const b = await findBot(actor, ref)
  requireRole(actor, 'member', 'run bots')
  const prompt = opts.prompt?.trim() || null
  // A run acts with the owner's access, so only the owner gets to steer it.
  if (prompt && b.ownerId !== actor.userId) throw forbidden('Only the bot\'s owner can add a request to a run.', 'Run it without one, or ask the owner.')
  if (prompt && prompt.length > 4000) throw invalid('Keep the request under 4,000 characters.')
  await botActor(b)
  const runId = await beginRun(b, { trigger: 'manual', startedBy: actor.userId, prompt })
  if (!runId) throw new AppError('conflict', `${b.name} is already running.`, { hint: 'Wait for it to finish (bot_runs), or cancel it with bot_run_cancel.' })
  await (await agent(b.id)).start(runId)
  return { runId, bot: b.name, status: 'queued' as const, next: 'Runs take a minute or more. Check on it with bot_run_get.' }
}

export async function cancelRun(actor: Actor, runId: string) {
  const { run: r, bot: b } = await requireRun(actor, runId)
  requireRole(actor, 'member', 'cancel runs')
  if (b.ownerId !== actor.userId && actor.role !== 'admin' && r.startedBy !== actor.userId) throw forbidden('Only the bot\'s owner, an admin or whoever started the run can cancel it.')
  if (r.status !== 'queued' && r.status !== 'running') return { runId, status: r.status }
  await finishRun(b, runId, { status: 'cancelled', error: `Cancelled by ${actor.userName}.` })
  await (await agent(b.id)).cancel(runId).catch(() => {})
  return { runId, status: 'cancelled' as const }
}

// ------------------------------------------------------------------ what the agent writes

export async function markRunning(b: BotRow, runId: string, model: string) {
  const claimed = await getDb()
    .update(botRun)
    .set({ status: 'running', startedAt: new Date(), model })
    .where(and(eq(botRun.id, runId), eq(botRun.status, 'queued')))
    .returning({ id: botRun.id })
  if (claimed.length) {
    await getDb().update(bot).set({ lastStatus: 'running' }).where(and(eq(bot.id, b.id), eq(bot.lastRunId, runId)))
    notify(b, 'bot_run_running')
  }
  return claimed.length > 0
}

const clip = (s: string | null | undefined) => (s == null ? null : s.length > MAX_EVENT_TEXT ? `${s.slice(0, MAX_EVENT_TEXT)}… (${s.length.toLocaleString()} characters)` : s)

export async function addEvent(
  b: Pick<BotRow, 'workspaceId' | 'visibility' | 'ownerId'>,
  runId: string,
  e: { kind: 'say' | 'tool' | 'subagent' | 'note'; agent?: string | null; name?: string | null; input?: string | null; output?: string | null; ok?: boolean },
) {
  await getDb().insert(botRunEvent).values({ runId, kind: e.kind, agent: e.agent ?? null, name: e.name ?? null, input: clip(e.input), output: clip(e.output), ok: e.ok !== false })
  notify(b, 'bot_run_event')
}

export async function addUsage(runId: string, tokens: number) {
  await getDb().update(botRun).set({ steps: sql`${botRun.steps} + 1`, tokens: sql`${botRun.tokens} + ${tokens}` }).where(eq(botRun.id, runId))
}

export async function runStatus(runId: string) {
  const [r] = await getDb().select({ status: botRun.status }).from(botRun).where(eq(botRun.id, runId))
  return r?.status
}

/** Close a run. A run that was already closed (cancelled, say) keeps its first ending. */
export async function finishRun(b: BotRow, runId: string, end: { status: 'succeeded' | 'failed' | 'cancelled'; summary?: string | null; error?: string | null }) {
  const closed = await getDb()
    .update(botRun)
    .set({ status: end.status, summary: end.summary ?? null, error: end.error ?? null, finishedAt: new Date() })
    .where(and(eq(botRun.id, runId), inArray(botRun.status, ['queued', 'running'])))
    .returning({ id: botRun.id, flowRunId: botRun.flowRunId })
  if (!closed.length) return false
  await getDb().update(bot).set({ lastStatus: end.status }).where(and(eq(bot.id, b.id), eq(bot.lastRunId, runId)))
  notify(b, `bot_run_${end.status}`)
  await tellFlow(closed[0]!, end.status)
  return true
}

// ------------------------------------------------------------------ webhooks

/** Give a bot a fresh webhook URL. The token is only ever shown here. */
async function newWebhook(botId: string) {
  const token = `${WEBHOOK_PREFIX}${randomToken(24)}`
  await getDb().update(bot).set({ webhookTokenHash: await sha256Hex(token) }).where(eq(bot.id, botId))
  return {
    webhookUrl: `${appUrl()}/api/bots/hook/${token}`,
    webhookNote: 'POST to this URL to wake the bot. The body (JSON or text) reaches the run as data. This is the only time the URL is shown, so save it where the sender needs it. Anyone with the URL can start runs.',
  }
}

/** POST /api/bots/hook/<token>: hand the event to the bot's agent, which runs now or right after its current run. */
export async function handleWebhook(token: string, body: string) {
  const [b] = await getDb().select().from(bot).where(eq(bot.webhookTokenHash, await sha256Hex(token)))
  if (!b) throw notFound('Webhook')
  if (!b.enabled) throw new AppError('conflict', `${b.name} is paused.`, { hint: b.pausedReason ?? 'Resume the bot to start taking events again.' })
  if (new TextEncoder().encode(body).length > MAX_INPUT_BYTES) throw new AppError('too_large', `Send at most ${MAX_INPUT_BYTES / 1000} KB.`, { hint: 'Send a link or an id and let the bot fetch the rest.' })
  const [recent] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(botRun)
    .where(and(eq(botRun.botId, b.id), eq(botRun.trigger, 'webhook'), sql`${botRun.createdAt} > ${Date.now() - 3600_000}`))
  if ((recent?.n ?? 0) >= MAX_WEBHOOK_RUNS_PER_HOUR) {
    throw new AppError('conflict', `${b.name} already ran ${MAX_WEBHOOK_RUNS_PER_HOUR} times from its webhook in the last hour.`, { hint: 'Send events less often, or batch them.' })
  }
  const r = await (await agent(b.id)).wake(body)
  return { ok: true, bot: b.name, ...r }
}

/** A Slack message for the bot's owner arrived (services/slack-inbox.ts). Only their own private bot takes these. */
export async function wakeFromSlack(botId: string, ownerId: string, body: string) {
  const b = await loadBot(botId)
  if (!b || b.ownerId !== ownerId || b.visibility !== 'private' || !b.enabled) return null
  const [recent] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(botRun)
    .where(and(eq(botRun.botId, b.id), eq(botRun.trigger, 'slack'), sql`${botRun.createdAt} > ${Date.now() - 3600_000}`))
  if ((recent?.n ?? 0) >= MAX_WEBHOOK_RUNS_PER_HOUR) return null
  return (await agent(b.id)).wake(body, 'slack')
}

// ------------------------------------------------------------------ bots as flow steps

/** Wake the flow run waiting in bots.run(). It reads the result itself. */
async function tellFlow(r: { id: string; flowRunId: string | null }, status: string) {
  if (!r.flowRunId) return
  try {
    const inst = await getEnv().FLOWS.get(r.flowRunId)
    await inst.sendEvent({ type: `bot-${r.id}`.slice(0, 100), payload: { status } })
  } catch (err) {
    // The flow finished or was cancelled; it has nothing left to wake.
    console.warn('[bots] could not wake flow run', r.flowRunId, (err as Error)?.message)
  }
}

/** Whether the actor owns a bot with this name. A flow may hand a bot input only as its owner. */
export async function ownsBot(actor: Pick<Actor, 'workspaceId' | 'userId'>, name: string) {
  const [b] = await getDb()
    .select({ id: bot.id })
    .from(bot)
    .where(and(eq(bot.workspaceId, actor.workspaceId), eq(bot.ownerId, actor.userId), sql`lower(${bot.name}) = ${name.toLowerCase()}`))
  return !!b
}

/**
 * bots.run() in a flow: start the named bot for the flow run `parent`, which
 * acts as `runAs`. Idempotent per `key`, so a retried step finds the run it
 * already started. A busy bot throws a conflict, which the step retries.
 */
export async function startFlowRun(runAs: Actor, parent: { id: string; flowName: string; team: boolean }, name: string, input: unknown, key: string) {
  const id = `brun_${(await sha256Hex(`flowbot:${parent.id}:${key}`)).slice(0, 24)}`
  const [existing] = await getDb().select().from(botRun).where(eq(botRun.id, id))
  if (existing) {
    if (existing.flowRunId !== parent.id) throw forbidden('That run belongs to another flow.')
    return { runId: id, finished: existing.status !== 'queued' && existing.status !== 'running' }
  }
  if (runAs.role === 'viewer') throw forbidden('Read-only members can\'t run bots.')
  const k = name.trim().toLowerCase()
  const named = (await visibleBots(runAs)).filter((x) => x.name.toLowerCase() === k)
  // Team flows only run team bots. A private flow prefers its owner's own bot.
  const b = parent.team ? named.find((x) => x.visibility === 'team') : (named.find((x) => x.ownerId === runAs.userId) ?? named[0])
  if (!b) {
    throw notFound(`Bot "${name}"`, parent.team && named.length ? 'Team flows can only run team bots. Share the bot with the team first.' : `${runAs.userName} can't see a bot with that name.`)
  }
  if (!b.enabled) throw invalid(`${b.name} is paused.`, b.pausedReason ?? 'Resume it with bot_update before a flow can run it.')
  const text = input == null ? null : typeof input === 'string' ? input : JSON.stringify(input, null, 2)
  // The bot acts with its owner's access, so only the owner's runs get to hand it anything.
  if (text && b.ownerId !== runAs.userId) {
    throw forbidden(`${parent.flowName} runs as ${runAs.userName}, and only the owner of ${b.name} can pass it input.`, 'Call bots.run without input, or have the bot\'s owner run or schedule this flow.')
  }
  if (text && new TextEncoder().encode(text).length > MAX_INPUT_BYTES) {
    throw new AppError('too_large', `bots.run input is over ${MAX_INPUT_BYTES / 1000} KB.`, { hint: 'Write it to a doc and pass the path.' })
  }
  await botActor(b)
  const runId = await beginRun(b, { trigger: 'flow', startedBy: runAs.userId, input: text, flowRunId: parent.id, id })
  if (!runId) throw new AppError('conflict', `${b.name} is already running.`, { hint: 'It does one run at a time. This step will try again.' })
  await (await agent(b.id)).start(runId)
  return { runId, finished: false }
}

/** How a bot run started by a flow ended, for the flow waiting on it. */
export async function flowRunResult(flowRunId: string, runId: string) {
  const [r] = await getDb().select().from(botRun).where(eq(botRun.id, runId))
  if (!r || r.flowRunId !== flowRunId) throw forbidden('That run was not started by this one.')
  await failStale(r.botId)
  const [now] = await getDb().select().from(botRun).where(eq(botRun.id, runId))
  if (!now || now.status === 'queued' || now.status === 'running') return { done: false as const, status: now?.status ?? 'running' }
  return { done: true as const, status: now.status, error: now.error, summary: now.summary, runId }
}

/** Bot runs still going when the flow that started them ends have no one to report to. */
export async function cancelFlowBotRuns(flowRunId: string, reason: string) {
  const rows = await getDb().select().from(botRun).where(and(eq(botRun.flowRunId, flowRunId), inArray(botRun.status, ['queued', 'running'])))
  for (const r of rows) {
    const b = await loadBot(r.botId)
    if (!b) continue
    // Clear the link first, so closing the run doesn't try to wake the flow that just ended.
    await getDb().update(botRun).set({ flowRunId: null }).where(eq(botRun.id, r.id))
    await finishRun(b, r.id, { status: 'cancelled', error: reason })
    await getDb().update(botRun).set({ flowRunId }).where(eq(botRun.id, r.id))
    await (await agent(b.id)).cancel(r.id).catch(() => {})
  }
}

/** Turn a bot off because it can't run any more (its owner left, say), and say why. */
export async function pauseBot(b: BotRow, reason: string) {
  await getDb().update(bot).set({ enabled: false, pausedReason: reason, nextRunAt: null }).where(eq(bot.id, b.id))
  notify(b, 'bot_pause')
}

export async function setNextRun(b: BotRow, at: Date | null) {
  await getDb().update(bot).set({ nextRunAt: at }).where(eq(bot.id, b.id))
}

/** When a bot is next due, from its schedule. Null for on-demand and paused bots. */
export function nextRunFor(b: Pick<BotRow, 'cron' | 'timezone' | 'enabled'>, from = new Date()) {
  return b.enabled && b.cron ? nextRun(b.cron, b.timezone, from) : null
}

export { audienceOf as botAudience }
