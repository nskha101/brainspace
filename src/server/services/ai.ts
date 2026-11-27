import { eq } from 'drizzle-orm'
import type { Actor } from '../actor'
import { requireRole } from '../actor'
import { decryptJson, encryptJson } from '../crypto'
import { getDb, workspace } from '../db'
import { getEnv } from '../env'
import { AppError, invalid } from '../errors'
import { DEFAULT_MODEL } from '../flows/manifest'
import { logActivity } from './activity'

const GATEWAY = 'https://ai-gateway.vercel.sh/v1'

export async function aiSettings(workspaceId: string) {
  const [w] = await getDb()
    .select({ key: workspace.aiGatewayKey, model: workspace.aiModel })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
  const key = w?.key ? await decryptJson<string>(w.key) : undefined
  return {
    key: key ?? (getEnv() as { AI_GATEWAY_API_KEY?: string }).AI_GATEWAY_API_KEY ?? null,
    hasOwnKey: !!key,
    model: w?.model || DEFAULT_MODEL,
  }
}

export async function getAiSettings(actor: Actor) {
  const s = await aiSettings(actor.workspaceId)
  return { configured: !!s.key, model: s.model, defaultModel: DEFAULT_MODEL }
}

export async function setAiSettings(actor: Actor, input: { key?: string | null; model?: string | null }) {
  requireRole(actor, 'admin', 'change the AI settings')
  const set: Partial<typeof workspace.$inferInsert> = {}
  if (input.key !== undefined) {
    if (input.key) {
      const key = input.key.trim()
      await checkKey(key)
      set.aiGatewayKey = await encryptJson(key)
    } else set.aiGatewayKey = null
  }
  if (input.model !== undefined) {
    const m = input.model?.trim()
    if (m && !/^[a-z0-9-]+\/[A-Za-z0-9._:-]+$/.test(m)) throw invalid(`"${m}" doesn't look like an AI Gateway model id.`, 'Use provider/model, like google/gemini-4-argon or anthropic/claude-sonnet-5.5.')
    set.aiModel = m || null
  }
  if (Object.keys(set).length) await getDb().update(workspace).set(set).where(eq(workspace.id, actor.workspaceId))
  await logActivity(actor, 'ai_settings', { details: { key: input.key === undefined ? 'unchanged' : input.key ? 'set' : 'removed', model: input.model ?? null } })
  return getAiSettings(actor)
}

async function checkKey(key: string) {
  const res = await fetch(`${GATEWAY}/credits`, { headers: { Authorization: `Bearer ${key}` } }).catch(() => null)
  if (res && (res.status === 401 || res.status === 403)) {
    throw invalid('Vercel AI Gateway rejected that key.', 'Create a key under AI Gateway → API keys in the Vercel dashboard and paste it again.')
  }
}

let modelCache: { at: number; ids: { id: string; name: string; type?: string }[] } | undefined

/** Models the gateway offers, for the settings picker. */
export async function listModels() {
  if (modelCache && Date.now() - modelCache.at < 3600_000) return modelCache.ids
  const res = await fetch(`${GATEWAY}/models`)
  if (!res.ok) return modelCache?.ids ?? []
  const data = (await res.json()) as { data: { id: string; name?: string; type?: string }[] }
  const ids = data.data
    .filter((m) => !m.type || m.type === 'language')
    .filter((m) => !/-batch$|embedding|image|tts|transcribe|live/.test(m.id))
    .map((m) => ({ id: m.id, name: m.name ?? m.id, type: m.type }))
  modelCache = { at: Date.now(), ids }
  return ids
}

type Message = { role: 'system' | 'user' | 'assistant'; content: string }
export type AiUsage = { calls: number; tokens: number }

export async function chat(
  workspaceId: string,
  opts: { model?: string; messages: Message[]; schema?: Record<string, unknown>; maxTokens?: number; temperature?: number },
): Promise<{ text: string; json?: unknown; model: string; tokens: number }> {
  const s = await aiSettings(workspaceId)
  if (!s.key) {
    throw new AppError('invalid', 'AI is not set up for this workspace.', {
      hint: 'An admin adds a Vercel AI Gateway key in Settings → AI (or with the workspace_ai tool).',
    })
  }
  const model = opts.model || s.model
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    // Streamed, because a long answer sent in one piece outlives the gateway's
    // idle limit and comes back as HTTP 524 with nothing in it.
    stream: true,
    stream_options: { include_usage: true },
  }
  if (opts.schema) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: opts.schema } }
  }
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.key}`, 'Content-Type': 'application/json', 'X-Title': 'Brainspace flows' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60_000),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string }
    const msg = typeof data.error === 'string' ? data.error : data.error?.message
    throw new AppError('upstream', `AI Gateway (${model}) returned HTTP ${res.status}: ${msg ?? 'no details'}`, {
      hint: res.status === 404 || res.status === 400 ? 'Check the model id against the AI Gateway model list.' : res.status === 401 ? 'The workspace AI key was rejected. An admin can replace it in Settings → AI.' : undefined,
    })
  }
  const { text, tokens } = await readCompletion(res, model)
  let json: unknown
  if (opts.schema) {
    try {
      json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''))
    } catch {
      throw new AppError('upstream', `${model} didn't return valid JSON for the schema.`, { hint: 'Try a different model, or simplify the schema.' })
    }
  }
  return { text, json, model, tokens }
}

type Completion = {
  choices?: { message?: { content?: string }; delta?: { content?: string | null } }[]
  usage?: { total_tokens?: number } | null
  error?: { message?: string } | string
}

/** The text of a chat completion, whether the gateway streamed it or sent it whole. */
async function readCompletion(res: Response, model: string): Promise<{ text: string; tokens: number }> {
  if (!res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = (await res.json().catch(() => ({}))) as Completion
    return { text: data.choices?.[0]?.message?.content ?? '', tokens: data.usage?.total_tokens ?? 0 }
  }
  let text = ''
  let tokens = 0
  let buffer = ''
  const take = (line: string) => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    let chunk: Completion
    try {
      chunk = JSON.parse(payload) as Completion
    } catch {
      return
    }
    if (chunk.error) {
      const msg = typeof chunk.error === 'string' ? chunk.error : chunk.error.message
      throw new AppError('upstream', `AI Gateway (${model}) stopped mid-answer: ${msg ?? 'no details'}`)
    }
    text += chunk.choices?.[0]?.delta?.content ?? ''
    if (chunk.usage?.total_tokens) tokens = chunk.usage.total_tokens
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) take(line.trimEnd())
  }
  take(buffer.trimEnd())
  return { text, tokens }
}

export const DEFAULT_DECISION_MODEL = 'typesafe-ai/jev'

export type DecisionQuestion =
  | { type: 'yesno'; ask: string }
  | { type: 'choice'; ask: string; choices: string[] | Record<string, string> }
  | { type: 'score'; ask: string; levels: string[] }

/**
 * Ask a decision model typed questions about some input. These models don't write:
 * they return a probability, a pick or a score per question, fast and for very little.
 */
export async function decide(
  workspaceId: string,
  opts: { model?: string; input: unknown; questions: Record<string, DecisionQuestion> },
): Promise<{ answers: Record<string, Record<string, unknown>>; model: string; tokens: number }> {
  const s = await aiSettings(workspaceId)
  if (!s.key) {
    throw new AppError('invalid', 'AI is not set up for this workspace.', {
      hint: 'An admin adds a Vercel AI Gateway key in Settings → AI (or with the workspace_ai tool).',
    })
  }
  const names = Object.keys(opts.questions ?? {})
  if (!names.length || names.length > 20) throw invalid('ai.decide takes 1 to 20 questions, keyed by name.')
  const questions = names.map((name) => {
    const q = opts.questions[name]!
    if (!q || typeof q.ask !== 'string' || !q.ask.trim()) throw invalid(`Question "${name}" needs ask: what to decide.`)
    if (q.type === 'yesno') return { type: 'predicate', name, instructions: q.ask }
    if (q.type === 'choice') {
      const choices = Array.isArray(q.choices) ? q.choices.map((value) => ({ value: String(value) })) : Object.entries(q.choices ?? {}).map(([value, description]) => ({ value, description: String(description) }))
      if (choices.length < 2) throw invalid(`Question "${name}" needs at least two choices.`)
      return { type: 'choice', name, instructions: q.ask, choices }
    }
    if (q.type === 'score') {
      if (!Array.isArray(q.levels) || q.levels.length < 2) throw invalid(`Question "${name}" needs at least two levels, lowest first.`)
      return { type: 'score', name, instructions: q.ask, levels: q.levels.map((label) => ({ label: String(label) })) }
    }
    throw invalid(`Question "${name}" has an unknown type.`, 'Use yesno, choice or score.')
  })
  const model = opts.model || DEFAULT_DECISION_MODEL
  const res = await fetch(`${GATEWAY}/decisions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.key}`, 'Content-Type': 'application/json', 'X-Title': 'Brainspace flows' },
    body: JSON.stringify({ model, input: typeof opts.input === 'string' ? opts.input : JSON.stringify(opts.input, null, 2), questions }),
    signal: AbortSignal.timeout(60_000),
  })
  const data = (await res.json().catch(() => ({}))) as {
    answers?: ({ name?: string; type?: string } & Record<string, unknown>)[]
    usage?: Record<string, number>
    error?: { message?: string } | string
  }
  if (!res.ok || !Array.isArray(data.answers)) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message
    throw new AppError('upstream', `AI Gateway (${model}) returned HTTP ${res.status}: ${msg ?? 'no details'}`, {
      hint: res.status === 404 || res.status === 400 ? 'ai.decide needs a decision model, like typesafe-ai/jev. Models that write text can\'t answer it.' : undefined,
    })
  }
  const answers: Record<string, Record<string, unknown>> = {}
  data.answers.forEach((a, i) => {
    const { name, type: _type, ...rest } = a
    answers[name ?? names[i]!] = rest
  })
  const u = data.usage ?? {}
  return { answers, model, tokens: u.total_tokens ?? (u.input_tokens ?? u.prompt_tokens ?? 0) + (u.output_tokens ?? u.completion_tokens ?? 0) }
}

/** Make an object schema strict the way OpenAI-style structured output wants it. */
export function strictSchema(schema: unknown): Record<string, unknown> {
  const walk = (s: any): any => {
    if (!s || typeof s !== 'object') return s
    if (Array.isArray(s)) return s.map(walk)
    const out: any = { ...s }
    if (out.type === 'object' && out.properties) {
      out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, walk(v)]))
      out.required = Object.keys(out.properties)
      out.additionalProperties = false
    }
    if (out.items) out.items = walk(out.items)
    for (const k of ['anyOf', 'oneOf', 'allOf']) if (out[k]) out[k] = walk(out[k])
    return out
  }
  const s = walk(schema)
  if (s?.type !== 'object') return { type: 'object', properties: { value: s }, required: ['value'], additionalProperties: false }
  return s
}

// Tool calling, for bots ---------------------------------------------------

export type ToolCall = { id: string; name: string; arguments: string }
export type ToolMessage =
  | { role: 'system' | 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string }
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export type ToolImage = { mimeType: string; data: string }

let visionCache: { at: number; ids: Set<string> } | undefined

/** Whether a model can be shown pictures, going by the gateway's model list. Unknown models count as no. */
export async function modelSeesImages(model: string) {
  if (!visionCache || Date.now() - visionCache.at > 3600_000) {
    const res = await fetch(`${GATEWAY}/models`).catch(() => null)
    if (res?.ok) {
      const data = (await res.json()) as { data: { id: string; tags?: string[]; modalities?: { input?: string[] } }[] }
      visionCache = { at: Date.now(), ids: new Set(data.data.filter((m) => m.modalities?.input?.includes('image') || m.tags?.includes('vision')).map((m) => m.id)) }
    }
  }
  return visionCache?.ids.has(model) ?? false
}

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> }

/** One model turn that may ask for tools. The caller runs them and calls again. */
export async function chatTools(
  workspaceId: string,
  opts: { model?: string | null; messages: ToolMessage[]; tools: ToolSpec[]; maxTokens?: number },
): Promise<{ text: string; calls: ToolCall[]; model: string; tokens: number }> {
  const s = await aiSettings(workspaceId)
  if (!s.key) {
    throw new AppError('invalid', 'AI is not set up for this workspace.', {
      hint: 'An admin adds a Vercel AI Gateway key in Settings → AI (or with the workspace_ai tool).',
    })
  }
  const model = opts.model || s.model
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.key}`, 'Content-Type': 'application/json', 'X-Title': 'Brainspace bots' },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      ...(opts.tools.length ? { tools: opts.tools.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' } : {}),
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(5 * 60_000),
  })
  const data = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string | null; tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[] } }[]
    usage?: { total_tokens?: number }
    error?: { message?: string } | string
  }
  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message
    throw new AppError('upstream', `AI Gateway (${model}) returned HTTP ${res.status}: ${msg ?? 'no details'}`, {
      hint: res.status === 404 || res.status === 400 ? 'Check the model id against the AI Gateway model list. The model has to support tool calling.' : res.status === 401 ? 'The workspace AI key was rejected. An admin can replace it in Settings → AI.' : undefined,
    })
  }
  const m = data.choices?.[0]?.message
  return {
    text: m?.content ?? '',
    calls: (m?.tool_calls ?? []).filter((c) => c.function?.name).map((c, i) => ({ id: c.id || `call_${i}`, name: c.function!.name!, arguments: c.function!.arguments || '{}' })),
    model,
    tokens: data.usage?.total_tokens ?? 0,
  }
}
