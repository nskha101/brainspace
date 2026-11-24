import { Agent } from 'agents'
import { eq } from 'drizzle-orm'
import { botRun, getDb, user } from '../db'
import { logActivity } from '../services/activity'
import { aiSettings } from '../services/ai'
import {
  addEvent,
  beginRun,
  botActor,
  botAudience,
  finishRun,
  loadBot,
  markRunning,
  nextRunFor,
  pauseBot,
  setNextRun,
  type BotRow,
} from '../services/bots'
import { describeCron } from '../services/flows'
import { errorText, runLoop, type OwnTools } from './loop'

/**
 * A bot, as a Cloudflare Agent: one Durable Object per bot, named by the bot's
 * id. It owns the bot's schedule (its own alarm, not the Worker's cron), runs
 * the model and tool loop, keeps the bot's memory between runs in its state,
 * and hands work to subagents, which are child agents with their own storage.
 * Everything a run changes goes through the same services people and agents
 * use, as the bot's owner, so it is versioned and shows in the activity log.
 */

type State = { memory: string }

const MAX_MEMORY = 4000
const MAX_SUBAGENTS = 4

function now(tz: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(new Date())
}

const RULES = `How to work:
- You run unattended. Nobody answers questions during a run, so decide and act, and say what you assumed.
- Do the work with your tools. Paths start with /team (shared with everyone) or /me (your owner's private space).
- Folders can carry notes on how to use them. list and read show them. Follow them.
- Search before creating a doc, read before changing one, prefer edit over write, and give every change a short message.
- Records that change over time belong in a database (db_query, db_insert, db_exec), not a doc you rewrite.
- If a team skill fits the job (skills_list), load it with skill_get and follow it.
- A tool error tells you what to do next. If something is outside your access, leave it and say so.
- If there is nothing to do this time, change nothing.
- When you are done, reply in plain text with what you did and what you changed, in a few lines. That reply is the run's record.`

function systemPrompt(b: BotRow, owner: string, memory: string) {
  return [
    `You are "${b.name}", a bot in a Brainspace workspace. You act as ${owner}, with only the access this bot was given.`,
    `It is ${now(b.timezone)} (${b.timezone}). ${b.cron ? `You run on a schedule: ${describeCron(b.cron, b.timezone)}.` : 'You run when someone asks.'}`,
    `Your instructions:\n${b.instructions}`,
    RULES,
    memory
      ? `Your memory from earlier runs:\n${memory}\n\nKeep it current with the remember tool.`
      : 'You have no memory from earlier runs yet. Use the remember tool to leave notes for your next run, like what you already covered.',
  ].join('\n\n')
}

function subagentPrompt(b: BotRow, owner: string) {
  return [
    `You are a subagent of "${b.name}", a bot in a Brainspace workspace. You act as ${owner}, with only the access the bot was given.`,
    `It is ${now(b.timezone)} (${b.timezone}).`,
    `What the bot is for:\n${b.instructions}`,
    RULES.replace("That reply is the run's record.", 'That reply goes back to the bot that gave you this task: include everything it needs, since it sees nothing else you did.'),
  ].join('\n\n')
}

async function ownerName(b: BotRow) {
  const [u] = await getDb().select({ name: user.name }).from(user).where(eq(user.id, b.ownerId))
  return u?.name ?? 'someone'
}

export class BrainBot extends Agent<Env, State> {
  initialState: State = { memory: '' }

  /** Line the schedule up with the bot's row. Called whenever the bot is created or changed. */
  async sync() {
    for (const s of await this.listSchedules()) {
      if (s.callback === 'tick') await this.cancelSchedule(s.id)
    }
    const b = await loadBot(this.name)
    if (!b) return
    const next = nextRunFor(b)
    // A date, not the SDK's cron: its cron runs in UTC, and schedules here are in the bot's timezone.
    if (next) await this.schedule(next, 'tick')
    await setNextRun(b, next)
  }

  /** The schedule fired. */
  async tick() {
    const b = await loadBot(this.name)
    if (!b) return
    // From a second ahead, so an alarm that fires a hair early can't land on the same slot again.
    const next = nextRunFor(b, new Date(Date.now() + 1000))
    if (next) await this.schedule(next, 'tick')
    await setNextRun(b, next)
    if (!b.enabled) return
    try {
      await botActor(b)
    } catch (err) {
      // Its owner left or went read-only. Stop until someone looks at it.
      await pauseBot(b, errorText(err))
      await this.sync()
      return
    }
    const runId = await beginRun(b, { trigger: 'schedule' })
    // Null means the last run is still going: skip this slot.
    if (runId) void this.runFiber(`run:${runId}`, () => this.execute(runId))
  }

  /** Start a run that was recorded by the service. Returns at once; the run carries on here. */
  async start(runId: string) {
    void this.runFiber(`run:${runId}`, () => this.execute(runId))
  }

  /** The run's row is already marked cancelled, which stops the loop at its next turn. This stops its subagents too. */
  async cancel(runId: string) {
    for (let i = 0; i < MAX_SUBAGENTS; i++) {
      if (this.dynamicAgents.has(BrainBotWorker, `${runId}-${i}`)) this.dynamicAgents.abort(BrainBotWorker, `${runId}-${i}`, new Error('The run was cancelled.'))
    }
  }

  async memory() {
    return this.state.memory
  }

  /** The bot was deleted: drop its schedule, memory and storage. */
  async remove() {
    await this.destroy()
  }

  private async execute(runId: string) {
    const b = await loadBot(this.name)
    if (!b) return
    const [run] = await getDb().select().from(botRun).where(eq(botRun.id, runId))
    if (!run) return
    try {
      const actor = await botActor(b)
      const ai = await aiSettings(b.workspaceId)
      const model = b.model ?? ai.model
      if (!(await markRunning(b, runId, model))) return
      await logActivity(actor, 'bot_run', { details: { bot: b.name, botId: b.id, runId, trigger: run.trigger }, audience: botAudience(b) })
      const owner = actor.userName
      const own: OwnTools = {
        remember: async (args) => {
          const memory = String(args.memory ?? '').slice(0, MAX_MEMORY)
          this.setState({ memory })
          return 'Saved. You will see this at the start of your next run.'
        },
        run_subagents: (args) => this.fanOut(b, runId, args.tasks),
      }
      const who = run.trigger === 'schedule' ? 'This is a scheduled run.' : 'Someone started this run by hand.'
      const summary = await runLoop({
        bot: b,
        actor,
        runId,
        model,
        system: systemPrompt(b, owner, this.state.memory),
        task: run.prompt ? `${who} For this run, also take this request into account:\n${run.prompt}` : `${who} Carry out your instructions.`,
        own,
      })
      await finishRun(b, runId, { status: 'succeeded', summary })
    } catch (err) {
      const message = errorText(err)
      const failed = await finishRun(b, runId, { status: 'failed', error: message })
      if (failed) {
        await addEvent(b, runId, { kind: 'note', output: message, ok: false }).catch(() => {})
        const actor = await botActor(b).catch(() => null)
        if (actor) await logActivity(actor, 'bot_run_failed', { details: { bot: b.name, botId: b.id, runId, error: message.slice(0, 300) }, audience: botAudience(b) }).catch(() => {})
      }
    }
  }

  /** Run up to four subagents side by side. Each is a child agent with its own context and storage, wiped when it reports back. */
  private async fanOut(b: BotRow, runId: string, raw: unknown) {
    const tasks = (Array.isArray(raw) ? raw : []).slice(0, MAX_SUBAGENTS) as { name?: unknown; task?: unknown }[]
    if (!tasks.length) return 'Pass at least one task.'
    const reports = await Promise.all(
      tasks.map(async (t, i) => {
        const label = String(t.name ?? `subagent ${i + 1}`).slice(0, 40)
        const task = String(t.task ?? '')
        const id = `${runId}-${i}`
        await addEvent(b, runId, { kind: 'subagent', agent: label, name: label, input: task })
        try {
          const child = await this.dynamicAgents.get(BrainBotWorker, id)
          const report = await child.work({ botId: b.id, runId, label, task })
          return { name: label, report }
        } catch (err) {
          const error = errorText(err)
          await addEvent(b, runId, { kind: 'note', agent: label, output: error, ok: false })
          return { name: label, error }
        } finally {
          await this.dynamicAgents.delete(BrainBotWorker, id).catch(() => {})
        }
      }),
    )
    return JSON.stringify(reports, null, 2)
  }
}

/** A subagent: a child of one bot run. It gets a task, works on it with the bot's tools and access, and reports back. */
export class BrainBotWorker extends Agent<Env> {
  async work(input: { botId: string; runId: string; label: string; task: string }) {
    const b = await loadBot(input.botId)
    if (!b) throw new Error('The bot no longer exists.')
    const actor = await botActor(b)
    const ai = await aiSettings(b.workspaceId)
    return runLoop({
      bot: b,
      actor,
      runId: input.runId,
      model: b.model ?? ai.model,
      system: subagentPrompt(b, await ownerName(b)),
      task: input.task,
      subagent: input.label,
    })
  }
}
