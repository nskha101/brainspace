import { WorkerEntrypoint, WorkflowEntrypoint, exports as workerExports, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { dispatchWorkflow } from '@cloudflare/dynamic-workflows'
import { and, eq, sql } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM } from '../actor'
import { newId, sha256Hex } from '../crypto'
import { flow, flowRun, flowRunLog, flowRunStep, flowTrigger, getDb, user, type FlowDelivery, type FlowDestination, type Json } from '../db'
import { appUrl, getEnv } from '../env'
import { AppError } from '../errors'
import { parsePath, displayPath } from '../paths'
import * as files from '../services/files'
import { search } from '../services/search'
import { getSkill, listSkills } from '../services/skills'
import { callConnectionTool, connectionToolInfo, searchTools } from '../services/connections'
import { chat, strictSchema } from '../services/ai'
import { actorFor } from '../services/workspaces'
import { logActivity } from '../services/activity'
import { publishSystemChange } from '../live'
import {
  datedVars,
  deliveryLabel,
  finishRun,
  membersForEmail,
  outputText,
  renderDeep,
  renderTemplate,
  verifyRunToken,
  type RunRow,
} from '../services/flows'
import mainSource from './sandbox/main.js?raw'
import sdkSource from './sandbox/sdk.js?raw'

const COMPAT_DATE = '2026-10-01'
const FATAL = 'BRAINSPACE_FATAL: '
const MAX_OUTPUT_D1 = 200_000
const MAX_LOGS = 500

type Exports = {
  FlowBrain: (opts: { props: BrainProps }) => Fetcher
  FlowOutbound: (opts: { props: OutboundProps }) => Fetcher
}
type BrainProps = { workspaceId: string; flowId: string }
type OutboundProps = { workspaceId: string; flowId: string; runId: string; network: string[] }

async function loadRun(runId: string) {
  const [r] = await getDb().select().from(flowRun).where(eq(flowRun.id, runId))
  return r
}

/** The Dynamic Worker for one run: the code version it started with, and the scope it was granted. */
async function loadSandbox(env: Env, r: RunRow) {
  const key = `flows/compiled/${r.codeHash}.js`
  // One isolate per run: module-level state in flow code can never leak between
  // runs (which may act as different people), and outbound logs know their run.
  const id = `run:${r.id}:${r.codeHash.slice(0, 16)}`
  const ex = workerExports as unknown as Exports
  return env.LOADER.get(id, async () => {
    const obj = await env.FILES.get(key)
    if (!obj) throw new Error(`Compiled code for this run is missing (${key}).`)
    return {
      compatibilityDate: COMPAT_DATE,
      mainModule: 'main.js',
      modules: { 'main.js': mainSource, 'sdk.js': sdkSource, 'flow.js': await obj.text() },
      env: { BRAIN: ex.FlowBrain({ props: { workspaceId: r.workspaceId, flowId: r.flowId } }) },
      globalOutbound: ex.FlowOutbound({ props: { workspaceId: r.workspaceId, flowId: r.flowId, runId: r.id, network: r.scope.network } }),
      limits: { cpuMs: 30_000 },
    }
  })
}

/**
 * The one Workflow class behind every flow. Each run's steps execute in the
 * flow's own Dynamic Worker; this class adds the parts users never write:
 * status, outputs, and delivery to the trigger's destinations.
 */
export class FlowWorkflow extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const runId = event.instanceId
    const r = await loadRun(runId)
    if (!r) throw new Error(`Run ${runId} has no record.`)
    if (r.status === 'queued') {
      await getDb().update(flowRun).set({ status: 'running' }).where(eq(flowRun.id, runId))
      notifyRun(r, 'flow_run_running')
    }

    let raw: unknown
    try {
      raw = await dispatchWorkflow({ env: this.env, ctx: this.ctx }, event as never, step as never, async ({ env }) => {
        const stub = await loadSandbox(env as Env, r)
        return stub.getEntrypoint('FlowRunner') as never
      })
    } catch (err) {
      const message = String((err as Error)?.message ?? err).replace(/^(Error|NonRetryableError): /, '')
      await step.do('record failure', async () => {
        await finishRun(runId, 'failed', message.slice(0, 4000))
        return null
      })
      throw err
    }

    const outputs = normalizeOutputs(raw)
    await step.do('save outputs', async () => {
      await saveOutputs(runId, outputs)
      return null
    })

    const deliveries: FlowDelivery[] = []
    for (const [i, dest] of r.deliver.entries()) {
      const label = `deliver ${i + 1}: ${deliveryLabel(dest)}`.slice(0, 200)
      let result: FlowDelivery
      try {
        result = (await step.do(label, { retries: { limit: 3, delay: '20 seconds', backoff: 'exponential' }, timeout: '5 minutes' }, async () =>
          deliver(runId, dest, outputs, deliveries),
        )) as FlowDelivery
      } catch (err) {
        result = { to: dest.to, target: deliveryLabel(dest), ok: false, error: String((err as Error)?.message ?? err).slice(0, 1000) }
      }
      deliveries.push(result)
    }

    const failed = deliveries.filter((d) => !d.ok)
    await step.do('finish', async () => {
      await getDb().update(flowRun).set({ deliveries }).where(eq(flowRun.id, runId))
      await finishRun(
        runId,
        failed.length ? 'failed' : 'succeeded',
        failed.length ? `${failed.length} of ${deliveries.length} deliveries failed: ${failed.map((d) => `${d.target}: ${d.error}`).join('; ')}` : null,
      )
      return null
    })
    return { outputs: Object.keys(outputs), deliveries: deliveries.length, failed: failed.length }
  }
}

function normalizeOutputs(raw: unknown): Record<string, Json> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return JSON.parse(JSON.stringify(raw)) as Record<string, Json>
  return { result: JSON.parse(JSON.stringify(raw)) as Json }
}

async function saveOutputs(runId: string, outputs: Record<string, Json>) {
  const text = JSON.stringify(outputs)
  if (text.length > MAX_OUTPUT_D1) {
    const key = `flows/outputs/${runId}.json`
    await getEnv().FILES.put(key, text, { httpMetadata: { contentType: 'application/json' } })
    const preview: Record<string, Json> = {}
    for (const [k, v] of Object.entries(outputs)) {
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      preview[k] = s.length > 2000 ? s.slice(0, 2000) + '…' : v
    }
    await getDb().update(flowRun).set({ outputs: preview, outputsKey: key }).where(eq(flowRun.id, runId))
  } else {
    await getDb().update(flowRun).set({ outputs }).where(eq(flowRun.id, runId))
  }
}

function notifyRun(r: Pick<RunRow, 'workspaceId' | 'flowId'>, action: string) {
  void getDb()
    .select({ driveId: flow.driveId, path: flow.folderPath })
    .from(flow)
    .where(eq(flow.id, r.flowId))
    .then(([f]) => f && publishSystemChange(r.workspaceId, { driveId: f.driveId, path: f.path, action, scope: 'flows' }))
}

async function runActor(r: RunRow): Promise<Actor> {
  const [u] = await getDb().select().from(user).where(eq(user.id, r.runAsUserId))
  if (!u) throw new AppError('forbidden', 'The person this run acts as no longer exists.')
  const a = await actorFor(u, r.workspaceId, 'flow', r.flowName)
  if (a.role === 'viewer') throw new AppError('forbidden', `${u.name} is read-only now, so this flow can't change anything as them.`)
  return a
}

async function deliver(runId: string, dest: FlowDestination, outputs: Record<string, Json>, earlier: FlowDelivery[]): Promise<FlowDelivery> {
  const r = (await loadRun(runId))!
  const actor = await runActor(r)
  const [trig] = r.triggerId
    ? await getDb().select({ tz: flowTrigger.timezone, name: flowTrigger.name }).from(flowTrigger).where(eq(flowTrigger.id, r.triggerId))
    : []
  const links: Record<string, string> = { run: `${appUrl()}/app/flows/runs/${r.id}` }
  const lastDoc = [...earlier].reverse().find((d) => d.to === 'drive' && d.ok && d.link)
  if (lastDoc?.link) links.doc = lastDoc.link
  const vars = { ...datedVars(trig?.tz), run: r.id, flow: r.flowName, trigger: trig?.name ?? 'manual', inputs: r.inputs, outputs, links }
  const outKey = 'output' in dest && dest.output ? dest.output : Object.keys(outputs)[0]
  const value = outKey ? outputs[outKey] : undefined
  const target = deliveryLabel(dest)

  if (r.mode === 'test') {
    const preview = dest.to === 'connection' ? JSON.stringify(renderDeep(dest.args as Json, vars)) : outputText(value)
    return { to: dest.to, target: dest.to === 'drive' ? renderTemplate(dest.path, vars) : target, ok: true, preview: `[test run, not delivered] ${preview.slice(0, 1500)}` }
  }

  switch (dest.to) {
    case 'drive': {
      const path = renderTemplate(dest.path, vars)
      const content = outputText(value)
      const message = `${r.flowName}: run ${r.id}`
      let res
      if (dest.mode === 'append') res = await files.append(actor, path, `\n\n${content}`, { message })
      else if (dest.mode === 'version') res = await files.write(actor, path, content, { message })
      else {
        try {
          res = await files.write(actor, path, content, { message, createOnly: true })
        } catch (err) {
          if ((err as AppError).code !== 'conflict') throw err
          const alt = path.replace(/(\.[a-z0-9]+)?$/i, (ext) => `-${r.id.slice(-6)}${ext}`)
          res = await files.write(actor, alt, content, { message, createOnly: true })
        }
      }
      const shown = res.node.path
      return { to: 'drive', target: shown, ok: true, link: `${appUrl()}/app/drive${shown}` }
    }
    case 'connection': {
      const args = renderDeep(dest.args as Json, vars) as Record<string, unknown>
      const result = (await callConnectionTool(actor, dest.connection, dest.tool, args)) as { isError?: boolean; content?: { type: string; text?: string }[] }
      const text = (result.content ?? []).map((c) => c.text ?? '').join('\n')
      if (result.isError) throw new Error(text.slice(0, 800) || 'The tool returned an error.')
      return { to: 'connection', target, ok: true, preview: text.slice(0, 500) }
    }
    case 'email': {
      const to = await membersForEmail(actor, dest.members)
      if (!to.length) throw new Error('None of the email recipients are workspace members.')
      const { sendEmail } = await import('../email')
      const subject = renderTemplate(dest.subject ?? `${r.flowName} ({date})`, vars)
      const body = outputText(value)
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
      for (const addr of to) {
        await sendEmail({
          to: addr,
          subject,
          text: `${body}\n\n—\nSent by the ${r.flowName} flow in Brainspace: ${links.run}`,
          html: `<div style="white-space:pre-wrap;font-size:14px;line-height:1.55">${esc(body)}</div><p style="color:#8a8794;font-size:12px">Sent by the ${esc(r.flowName)} flow · <a href="${links.run}">see the run</a></p>`,
        })
      }
      return { to: 'email', target: to.join(', '), ok: true }
    }
    case 'webhook': {
      const payload = JSON.stringify({ run: r.id, flow: r.flowName, inputs: r.inputs, outputs, url: links.run, at: Date.now() })
      const { hmacSign } = await import('../crypto')
      const res = await fetch(dest.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Brainspace-Signature': await hmacSign(`webhook:${payload}`), 'User-Agent': 'Brainspace-Flows/1' },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { to: 'webhook', target, ok: true }
    }
  }
}

// ------------------------------------------------------------------ sandbox bindings

type RunCtx = { run: RunRow; actor: Actor; teamFlow: boolean }
const runCache = new Map<string, { at: number; ctx: RunCtx }>()

function covered(list: string[], p: string) {
  return list.some((q) => p === q || p.startsWith(q.endsWith('/') ? q : q + '/'))
}

/**
 * The only door from flow code back into Brainspace. Every call carries the
 * run's signed token, and is checked against the scope the run was granted.
 */
export class FlowBrain extends WorkerEntrypoint<Env, BrainProps> {
  async call(token: string, op: string, args: Record<string, any>) {
    try {
      const ctx = await this.context(token)
      return JSON.parse(JSON.stringify((await this.dispatch(ctx, op, args ?? {})) ?? null))
    } catch (err) {
        if (err instanceof AppError) {
        const msg = err.hint ? `${err.message} ${err.hint}` : err.message
        // Policy and input errors won't fix themselves: tell the SDK not to retry.
        throw new Error(['forbidden', 'invalid', 'not_found', 'too_large', 'unauthorized'].includes(err.code) ? `${FATAL}${msg}` : msg)
      }
      throw err
    }
  }

  private async context(token: string): Promise<RunCtx> {
    const runId = await verifyRunToken(String(token ?? ''))
    if (!runId) throw new AppError('forbidden', 'Invalid run token.')
    const hit = runCache.get(runId)
    if (hit && Date.now() - hit.at < 15_000) return hit.ctx
    const run = await loadRun(runId)
    if (!run || run.workspaceId !== this.ctx.props.workspaceId || run.flowId !== this.ctx.props.flowId) {
      throw new AppError('forbidden', 'This run belongs to another flow.')
    }
    if (run.status === 'cancelled') throw new AppError('forbidden', 'This run was cancelled.')
    const [f] = await getDb().select({ driveId: flow.driveId }).from(flow).where(eq(flow.id, run.flowId))
    const actor = await runActor(run)
    const ctx = { run, actor: { ...actor, via: 'flow' as const, clientName: run.flowName }, teamFlow: f?.driveId === TEAM }
    runCache.set(runId, { at: Date.now(), ctx })
    return ctx
  }

  private checkPath(c: RunCtx, path: string, write: boolean) {
    if (typeof path !== 'string' || !path) throw new AppError('invalid', 'Pass a path like /team/reports/weekly.md.')
    const p = parsePath(c.actor, path)
    const shown = displayPath(c.actor, p.driveId, p.path)
    if (c.teamFlow && p.driveId !== TEAM) throw new AppError('forbidden', `Team flows can't use private drives (${shown}).`)
    const s = c.run.scope
    const ok = write ? covered(s.write, shown) : covered(s.read, shown) || covered(s.write, shown)
    if (!ok) {
      throw new AppError('forbidden', `This flow isn't allowed to ${write ? 'write to' : 'read'} ${shown}.`, {
        hint: `Add it under uses.${write ? 'write' : 'read'} in FLOW.md (for example "${shown.split('/').slice(0, 3).join('/')}").`,
      })
    }
    return shown
  }

  private capture(c: RunCtx, kind: string, target: string, preview: string) {
    const item = { kind, target, preview: preview.slice(0, 4000) }
    return getDb()
      .update(flowRun)
      .set({ captured: sql`json_insert(coalesce(${flowRun.captured}, '[]'), '$[#]', json(${JSON.stringify(item)}))` })
      .where(eq(flowRun.id, c.run.id))
      .then(() => ({ path: target, captured: true, note: 'Test run: this change was recorded, not made.' }))
  }

  private async dispatch(c: RunCtx, op: string, a: Record<string, any>): Promise<unknown> {
    const { actor, run } = c
    switch (op) {
      case 'step':
        return this.recordStep(run, a)
      case 'sleep':
        return this.recordSleep(run, a)
      case 'log':
        return this.log(run, a)
      case 'approvalRequest':
        return this.requestApproval(c, a)
      case 'approvalExpired':
        await getDb().update(flowRun).set({ pendingApproval: null, status: 'running' }).where(eq(flowRun.id, run.id))
        await this.log(run, { level: 'warn', message: 'An approval request expired without an answer.' })
        notifyRun(run, 'flow_run_running')
        return null

      case 'read': {
        const shown = this.checkPath(c, a.path, false)
        return files.read(actor, shown, { version: a.version, offset: a.offset, limit: a.limit })
      }
      case 'readMany': {
        const paths = (Array.isArray(a.paths) ? a.paths : []).slice(0, 50) as string[]
        return Promise.all(paths.map(async (p) => {
          try {
            return await files.read(actor, this.checkPath(c, p, false))
          } catch (err) {
            return { path: p, error: (err as Error).message }
          }
        }))
      }
      case 'list': {
        const shown = this.checkPath(c, a.path, false)
        return files.list(actor, shown, { depth: a.depth, limit: a.limit })
      }
      case 'search': {
        const s = run.scope
        const allowed = [...s.read, ...s.write].filter((p) => !c.teamFlow || p.startsWith('/team'))
        if (!allowed.length) throw new AppError('forbidden', "This flow can't read any part of the brain.", { hint: 'Add paths under uses.read in FLOW.md.' })
        if (a.pathPrefix) this.checkPath(c, a.pathPrefix, false)
        const hits = await search(actor, String(a.query ?? ''), { mode: a.mode, limit: Math.min(Number(a.limit) || 10, 50), pathPrefix: a.pathPrefix, drive: c.teamFlow ? 'team' : 'all' })
        return hits.filter((h) => covered(allowed, h.path))
      }
      case 'skill': {
        const skill = await this.skill(c, String(a.name ?? ''))
        return { name: skill.name, description: skill.description, content: skill.content }
      }
      case 'write':
      case 'edit':
      case 'append':
      case 'upload': {
        const shown = this.checkPath(c, a.path, true)
        if (run.mode === 'test') {
          const preview = op === 'edit' ? JSON.stringify(a.edits) : op === 'upload' ? `[${String(a.data ?? '').length} chars of file data]` : String(a.content ?? a.text ?? '')
          return this.capture(c, op, shown, preview)
        }
        const message = a.message ?? `${run.flowName}: ${op}`
        let res
        if (op === 'write') res = await files.write(actor, shown, String(a.content ?? ''), { message, baseVersion: a.baseVersion, description: a.description })
        else if (op === 'edit') res = await files.edit(actor, shown, a.edits ?? [], { message, baseVersion: a.baseVersion })
        else if (op === 'append') res = await files.append(actor, shown, String(a.text ?? ''), { message })
        else {
          const data = typeof a.data === 'string' ? Uint8Array.from(atob(a.data.replace(/^data:[^,]+,/, '')), (ch) => ch.charCodeAt(0)).buffer : new Uint8Array(a.data ?? []).buffer
          res = await files.upload(actor, shown, data, { mimeType: a.mimeType, description: a.description, message })
        }
        return { path: shown, version: res.node.version }
      }

      case 'connectionCall': {
        const info = await connectionToolInfo(actor, String(a.connection ?? ''), String(a.tool ?? ''), a.args ?? {})
        const allowed = run.scope.connections.map((x) => x.toLowerCase())
        if (![info.slug, info.name.toLowerCase(), info.presetId ?? '', info.id].some((k) => allowed.includes(k.toLowerCase()))) {
          throw new AppError('forbidden', `This flow isn't allowed to use ${info.name}.`, { hint: `Add "${info.slug}" under uses.connections in FLOW.md.` })
        }
        if (run.mode === 'test' && !info.readOnly) {
          return this.capture(c, 'connection', `${info.slug} · ${a.tool}`, JSON.stringify(a.args ?? {}))
        }
        const result = (await callConnectionTool(actor, info.id, String(a.tool), a.args ?? {})) as { isError?: boolean; content?: { type: string; text?: string }[]; structuredContent?: unknown }
        const text = (result.content ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n')
        if (result.isError) throw new AppError('upstream', `${info.name} ${a.tool} failed: ${text.slice(0, 1000)}`)
        if (result.structuredContent) return result.structuredContent
        try {
          return JSON.parse(text)
        } catch {
          return text
        }
      }
      case 'connectionTools': {
        return searchTools(actor, { connection: a.connection, query: a.query, limit: 20 })
      }

      case 'ai':
        return this.ai(c, a)
    }
    throw new AppError('invalid', `Unknown operation "${op}".`)
  }

  private async ai(c: RunCtx, a: Record<string, any>) {
    if (!c.run.scope.ai) throw new AppError('forbidden', "This flow isn't allowed to use AI.", { hint: 'Set uses.ai: true in FLOW.md.' })
    const model = a.model || c.run.model || undefined
    let skillText = ''
    if (a.skill) {
      const s = await this.skill(c, String(a.skill))
      skillText = `\n\nFollow this team skill ("${s.name}"):\n\n${s.content}`
    }
    const ctxText = a.context === undefined ? '' : `\n\nContext:\n${typeof a.context === 'string' ? a.context : JSON.stringify(a.context, null, 2)}`.slice(0, 400_000)
    const system = `You are part of an automated workflow ("${c.run.flowName}") for the ${c.actor.workspaceName} team. Output only what is asked for, with no preamble.${a.system ? `\n\n${a.system}` : ''}${skillText}`
    let res
    switch (a.op) {
      case 'write':
        res = await chat(c.run.workspaceId, {
          model,
          maxTokens: a.maxTokens,
          temperature: a.temperature,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `${a.task ?? 'Write it.'}${a.format === 'text' ? '\n\nPlain text, no markdown.' : '\n\nFormat: markdown.'}${ctxText}` },
          ],
        })
        await this.countAi(c, res.tokens)
        return res.text
      case 'extract': {
        if (!a.schema || typeof a.schema !== 'object') throw new AppError('invalid', 'ai.extract needs a JSON schema in `schema`.')
        const schema = strictSchema(a.schema)
        res = await chat(c.run.workspaceId, {
          model,
          maxTokens: a.maxTokens,
          schema,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `${a.task ?? 'Extract the data described by the schema.'}\n\nInput:\n${typeof a.input === 'string' ? a.input : JSON.stringify(a.input, null, 2)}${ctxText}` },
          ],
        })
        await this.countAi(c, res.tokens)
        return (a.schema as { type?: string }).type === 'object' ? res.json : (res.json as { value: unknown }).value
      }
      case 'classify': {
        const labels = (a.labels ?? []) as string[]
        if (!labels.length) throw new AppError('invalid', 'ai.classify needs labels: ["bug", "feature", ...].')
        res = await chat(c.run.workspaceId, {
          model,
          schema: strictSchema({ type: 'object', properties: { label: { type: 'string', enum: labels }, reason: { type: 'string' } } }),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `${a.task ?? 'Pick the best label.'}\n\nLabels: ${labels.join(', ')}\n\nInput:\n${typeof a.input === 'string' ? a.input : JSON.stringify(a.input, null, 2)}${ctxText}` },
          ],
        })
        await this.countAi(c, res.tokens)
        return res.json
      }
      case 'chat': {
        const messages = Array.isArray(a.messages) ? a.messages : [{ role: 'user', content: String(a.prompt ?? '') }]
        res = await chat(c.run.workspaceId, { model, maxTokens: a.maxTokens, temperature: a.temperature, messages: [{ role: 'system', content: system }, ...messages] })
        await this.countAi(c, res.tokens)
        return { text: res.text, model: res.model, tokens: res.tokens }
      }
    }
    throw new AppError('invalid', `Unknown ai operation "${a.op}".`)
  }

  /** Team flows only see team skills, never the private skills of the person they run as. */
  private async skill(c: RunCtx, name: string) {
    const s = await getSkill(c.actor, name)
    if (!c.teamFlow || s.drive === 'team') return s
    const team = (await listSkills(c.actor)).find((x) => x.drive === 'team' && x.name.toLowerCase() === s.name.toLowerCase())
    if (!team) throw new AppError('not_found', `Team skill "${name}" not found.`, { hint: 'Team flows can only load skills from /team/skills.' })
    const doc = await files.read(c.actor, team.path)
    return { ...team, content: 'content' in doc ? String(doc.content ?? '') : '' }
  }

  private async countAi(c: RunCtx, tokens: number) {
    await getDb()
      .update(flowRun)
      .set({ aiCalls: sql`${flowRun.aiCalls} + 1`, aiTokens: sql`${flowRun.aiTokens} + ${tokens}` })
      .where(eq(flowRun.id, c.run.id))
  }

  private async recordStep(run: RunRow, a: Record<string, any>) {
    const db = getDb()
    const name = String(a.name).slice(0, 300)
    const now = new Date()
    const [existing] = await db.select().from(flowRunStep).where(and(eq(flowRunStep.runId, run.id), eq(flowRunStep.name, name)))
    await db
      .update(flowRunStep)
      .set({ status: 'done', finishedAt: now })
      .where(and(eq(flowRunStep.runId, run.id), eq(flowRunStep.status, 'sleeping'), sql`${flowRunStep.until} <= ${now.getTime()}`))
    if (!existing) {
      const [n] = await db.select({ n: sql<number>`count(*)` }).from(flowRunStep).where(eq(flowRunStep.runId, run.id))
      await db
        .insert(flowRunStep)
        .values({ id: newId('fst'), runId: run.id, seq: n?.n ?? 0, name, kind: name.startsWith('ask: ') ? 'approval' : 'step', status: a.status, startedAt: now, error: a.error ?? null, preview: a.preview ?? null, finishedAt: a.status === 'running' ? null : now })
        .onConflictDoNothing()
    } else if (a.status === 'running') {
      await db.update(flowRunStep).set({ status: 'running', attempt: existing.status === 'running' ? existing.attempt : existing.attempt + 1, error: null, finishedAt: null }).where(eq(flowRunStep.id, existing.id))
    } else {
      await db.update(flowRunStep).set({ status: a.status, finishedAt: now, error: a.error ?? null, preview: a.preview ?? null }).where(eq(flowRunStep.id, existing.id))
    }
    notifyRun(run, 'flow_step')
    return null
  }

  private async recordSleep(run: RunRow, a: Record<string, any>) {
    const until = a.until ? new Date(a.until) : new Date(Date.now() + durationMs(a.duration))
    const db = getDb()
    const [n] = await db.select({ n: sql<number>`count(*)` }).from(flowRunStep).where(eq(flowRunStep.runId, run.id))
    await db
      .insert(flowRunStep)
      .values({ id: newId('fst'), runId: run.id, seq: n?.n ?? 0, name: String(a.name).slice(0, 300), kind: 'sleep', status: 'sleeping', startedAt: new Date(), until })
      .onConflictDoNothing()
    notifyRun(run, 'flow_step')
    return null
  }

  private async log(run: RunRow, a: Record<string, any>) {
    const message = String(a.message ?? '').slice(0, 2000)
    const data = a.data === undefined ? null : (JSON.parse(JSON.stringify(a.data)) as Json)
    const hash = (await sha256Hex(`${a.level}:${message}:${JSON.stringify(data)}`)).slice(0, 24)
    const db = getDb()
    const [n] = await db.select({ n: sql<number>`count(*)` }).from(flowRunLog).where(eq(flowRunLog.runId, run.id))
    if ((n?.n ?? 0) >= MAX_LOGS) return null
    await db
      .insert(flowRunLog)
      .values({ id: newId('flg'), runId: run.id, at: new Date(), level: ['warn', 'error'].includes(a.level) ? a.level : 'info', message, data, hash })
      .onConflictDoNothing()
    return null
  }

  private async requestApproval(c: RunCtx, a: Record<string, any>) {
    const { run } = c
    const approval = {
      key: String(a.key),
      title: String(a.title).slice(0, 200),
      summary: a.summary ? String(a.summary).slice(0, 2000) : undefined,
      preview: a.preview ? String(a.preview).slice(0, 20_000) : undefined,
      requestedAt: Date.now(),
      timeoutAt: Date.now() + durationMs(a.timeout ?? '7 days'),
    }
    await getDb().update(flowRun).set({ status: 'waiting', pendingApproval: approval }).where(eq(flowRun.id, run.id))
    await logActivity(c.actor, 'flow_approval', { details: { flow: run.flowName, run: run.id, title: approval.title } })
    notifyRun(run, 'flow_run_waiting')
    if (run.mode === 'live') {
      const { sendEmail } = await import('../email')
      const url = `${appUrl()}/app/flows/runs/${run.id}`
      await sendEmail({
        to: c.actor.email,
        subject: `Approval needed: ${approval.title}`,
        text: `${run.flowName} is waiting for your approval: ${approval.title}\n\n${approval.summary ?? ''}\n\nReview it: ${url}`,
        html: `<p><b>${run.flowName}</b> is waiting for your approval:</p><p style="font-size:16px"><b>${approval.title.replace(/</g, '&lt;')}</b></p><p>${(approval.summary ?? '').replace(/</g, '&lt;')}</p><p><a href="${url}">Review it in Brainspace</a></p>`,
      }).catch(() => false)
    }
    return { waiting: true }
  }
}

function durationMs(d: unknown): number {
  if (typeof d === 'number') return d
  const m = String(d ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(ms|millisecond|second|minute|hour|day|week|month|year)s?$/i)
  if (!m) return 0
  const n = Number(m[1])
  const unit = m[2]!.toLowerCase()
  const mult: Record<string, number> = { ms: 1, millisecond: 1, second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 }
  return n * (mult[unit] ?? 0)
}

/**
 * Every fetch() from flow code lands here. Only hosts the flow declared in
 * uses.network get through, and each request is logged on the run.
 */
export class FlowOutbound extends WorkerEntrypoint<Env, OutboundProps> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const host = url.hostname.toLowerCase()
    const allowed = this.ctx.props.network.some((h) => {
      const k = h.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      return k.startsWith('*.') ? host.endsWith(k.slice(1)) : host === k
    })
    const runId = this.ctx.props.runId
    const db = getDb()
    const logLine = async (message: string, level: 'info' | 'warn') => {
      const hash = (await sha256Hex(`${message}:${Date.now()}`)).slice(0, 24)
      await db.insert(flowRunLog).values({ id: newId('flg'), runId, at: new Date(), level, message, data: null, hash }).onConflictDoNothing()
    }
    if (!allowed || url.protocol !== 'https:') {
      await logLine(`Blocked ${req.method} ${url.origin}${url.pathname}: not in uses.network`, 'warn')
      return new Response(
        JSON.stringify({ error: 'blocked', message: `This flow can't reach ${host}. Add it under uses.network in FLOW.md, or use a connection.` }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const res = await fetch(req)
    await logLine(`${req.method} ${url.origin}${url.pathname} → ${res.status}`, 'info')
    return res
  }
}
