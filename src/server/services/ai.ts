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
  const data = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[]
    usage?: { total_tokens?: number }
    error?: { message?: string } | string
  }
  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message
    throw new AppError('upstream', `AI Gateway (${model}) returned HTTP ${res.status}: ${msg ?? 'no details'}`, {
      hint: res.status === 404 || res.status === 400 ? 'Check the model id against the AI Gateway model list.' : res.status === 401 ? 'The workspace AI key was rejected. An admin can replace it in Settings → AI.' : undefined,
    })
  }
  const text = data.choices?.[0]?.message?.content ?? ''
  let json: unknown
  if (opts.schema) {
    try {
      json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''))
    } catch {
      throw new AppError('upstream', `${model} didn't return valid JSON for the schema.`, { hint: 'Try a different model, or simplify the schema.' })
    }
  }
  return { text, json, model, tokens: data.usage?.total_tokens ?? 0 }
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
