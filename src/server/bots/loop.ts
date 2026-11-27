import type { Actor } from '../actor'
import { AppError } from '../errors'
import { chatTools, modelSeesImages, type ContentPart, type ToolImage, type ToolMessage } from '../services/ai'
import { eq } from 'drizzle-orm'
import { botRun, getDb } from '../db'
import { addEvent, addUsage, isWorkspaceBot, runStatus, scopeOf, type BotRow } from '../services/bots'
import { callTool, toolSpecs } from './tools'

/** One model turn plus the tool calls it asks for, repeated until the model answers in plain text. */

const MAX_TURNS = 40
const MAX_SUBAGENT_TURNS = 20
/** Stop taking new turns after this long. A run has to fit inside one agent wake-up. */
const BUDGET_MS = 11 * 60_000

/** Pictures cost tokens on every later turn, so a run only gets to look at a few. */
const MAX_IMAGES = 6

export type OwnTools = Record<string, (args: Record<string, unknown>) => Promise<string>>

export function errorText(err: unknown) {
  if (err instanceof AppError) return err.hint ? `${err.message} ${err.hint}` : err.message
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as { issues: unknown }).issues)) {
    return `Invalid arguments: ${(err as { issues: { path: (string | number)[]; message: string }[] }).issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
  }
  return String((err as Error)?.message ?? err)
}

export async function runLoop(opts: {
  bot: BotRow
  actor: Actor
  runId: string
  model: string
  system: string
  task: string
  /** Set for a subagent: its name, shown beside everything it does. */
  subagent?: string
  /** Tools the calling agent handles itself (memory, subagents). */
  own?: OwnTools
}): Promise<string> {
  const { bot, runId } = opts
  const [run] = await getDb().select({ startedBy: botRun.startedBy }).from(botRun).where(eq(botRun.id, runId))
  // A team bot answers anyone it is shared with, but always acts as its owner.
  const scope = { ...scopeOf(bot), guest: !isWorkspaceBot(bot) && !!run?.startedBy && run.startedBy !== bot.ownerId }
  const tools = toolSpecs(scope, { subagent: !!opts.subagent })
  const messages: ToolMessage[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.task },
  ]
  const started = Date.now()
  const turns = opts.subagent ? MAX_SUBAGENT_TURNS : MAX_TURNS
  const agent = opts.subagent ?? null
  let seen = 0

  for (let turn = 0; turn < turns; turn++) {
    if ((await runStatus(runId)) !== 'running') throw new AppError('conflict', 'The run was cancelled.')
    const last = turn === turns - 1 || Date.now() - started > BUDGET_MS
    if (last) messages.push({ role: 'user', content: 'You are out of time for this run. Do not call any more tools. Say what you finished and what is left.' })
    const res = await chatTools(bot.workspaceId, { model: opts.model, messages, tools: last ? [] : tools })
    await addUsage(runId, res.tokens)
    if (!res.calls.length || last) {
      const text = res.text.trim()
      if (text) await addEvent(bot, runId, { kind: 'say', agent, output: text })
      return text || 'Finished without a summary.'
    }
    if (res.text.trim()) await addEvent(bot, runId, { kind: 'say', agent, output: res.text.trim() })
    messages.push({
      role: 'assistant',
      content: res.text || null,
      tool_calls: res.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
    })
    // Pictures can't ride in a tool result, so they follow the turn's results as one message.
    const pictures: ToolImage[] = []
    for (const call of res.calls) {
      let output: string
      let ok = true
      try {
        const args = JSON.parse(call.arguments || '{}') as Record<string, unknown>
        const own = opts.own?.[call.name]
        if (own) output = await own(args)
        else {
          // A fresh copy each call: access rules are looked up once per actor object, and a run can outlast a change to them.
          const r = await callTool({ ...opts.actor }, scope, call.name, args)
          output = r.text
          if (r.images.length) {
            const room = MAX_IMAGES - seen - pictures.length
            if (!(await modelSeesImages(opts.model))) output += `\n\n[There is an image here, but this bot's model (${opts.model}) can't look at images. Say so if it matters.]`
            else if (room <= 0) output += `\n\n[There is an image here, but this run has already looked at ${MAX_IMAGES}, which is the most allowed.]`
            else {
              pictures.push(...r.images.slice(0, room))
              output += '\n\n[The image follows these results.]'
            }
          }
        }
      } catch (err) {
        ok = false
        output = `Error: ${errorText(err)}`
      }
      // Subagents report through their own event.
      if (call.name !== 'run_subagents') await addEvent(bot, runId, { kind: 'tool', agent, name: call.name, input: call.arguments, output, ok })
      messages.push({ role: 'tool', tool_call_id: call.id, content: output })
    }
    if (pictures.length) {
      seen += pictures.length
      const parts: ContentPart[] = [
        { type: 'text', text: pictures.length > 1 ? 'The images those tools opened, in order:' : 'The image that tool opened:' },
        ...pictures.map((p): ContentPart => ({ type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } })),
      ]
      messages.push({ role: 'user', content: parts })
    }
  }
  return 'Finished without a summary.'
}
