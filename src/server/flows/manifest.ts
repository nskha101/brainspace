import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { FlowManifest, FlowScope } from '../db'
import { sha256Hex } from '../crypto'

export const DEFAULT_MODEL = 'google/gemini-4-argon'
export const SECRET_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/

const inputSpec = z.object({
  type: z.enum(['string', 'number', 'boolean', 'string[]', 'number[]', 'markdown', 'json']).default('string'),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.any().optional(),
  enum: z.array(z.string()).optional(),
})

const outputSpec = z.object({
  type: z.enum(['markdown', 'string', 'json', 'number', 'boolean']).default('markdown'),
  description: z.string().optional(),
})

const pathList = z
  .array(z.string())
  .default([])
  .transform((list) => list.map((p) => p.replace(/\/+$/, '') || '/'))

const scope = z
  .object({
    connections: z.array(z.string()).default([]),
    read: pathList,
    write: pathList,
    network: z.array(z.string()).default([]),
    secrets: z.array(z.string().regex(SECRET_NAME, 'secret names are UPPER_SNAKE_CASE, like WEATHER_API_KEY')).default([]),
    ai: z.boolean().default(false),
  })
  .default({ connections: [], read: [], write: [], network: [], secrets: [], ai: false })

const manifestSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'name must be lowercase letters, numbers and dashes'),
  description: z.string().min(1, 'description is required').max(500),
  model: z.string().optional(),
  inputs: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), inputSpec).default({}),
  outputs: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), outputSpec).default({}),
  uses: scope,
})

export type ParsedFlowDoc = { manifest: FlowManifest; body: string }

/** FLOW.md: YAML frontmatter (the manifest) and a markdown body explaining the flow. */
export function parseFlowDoc(md: string): ParsedFlowDoc {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!m) throw new Error('FLOW.md needs YAML frontmatter between --- lines with at least name and description.')
  let data: unknown
  try {
    data = parseYaml(m[1]!)
  } catch (err) {
    throw new Error(`FLOW.md frontmatter is not valid YAML: ${(err as Error).message}`)
  }
  const r = manifestSchema.safeParse(data ?? {})
  if (!r.success) {
    throw new Error(`FLOW.md frontmatter: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
  }
  return { manifest: r.data as FlowManifest, body: md.slice(m[0].length).trim() }
}

/** Stable hash of what a flow may touch. A trigger stores the hash its owner approved. */
export async function scopeHash(s: FlowScope) {
  const norm = {
    connections: [...s.connections].map((c) => c.toLowerCase()).sort(),
    read: [...s.read].sort(),
    write: [...s.write].sort(),
    network: [...s.network].map((h) => h.toLowerCase()).sort(),
    secrets: [...(s.secrets ?? [])].sort(),
    ai: s.ai,
  }
  return (await sha256Hex(JSON.stringify(norm))).slice(0, 32)
}

/** True when `next` asks for anything `prev` didn't. */
export function scopeWidened(prev: FlowScope, next: FlowScope) {
  const covered = (list: string[], p: string) => list.some((q) => p === q || p.startsWith(q === '/' ? '/' : q + '/'))
  return (
    next.connections.some((c) => !prev.connections.map((x) => x.toLowerCase()).includes(c.toLowerCase())) ||
    next.read.some((p) => !covered(prev.read, p) && !covered(prev.write, p)) ||
    next.write.some((p) => !covered(prev.write, p)) ||
    next.network.some((h) => !prev.network.map((x) => x.toLowerCase()).includes(h.toLowerCase())) ||
    (next.secrets ?? []).some((n) => !(prev.secrets ?? []).includes(n)) ||
    (next.ai && !prev.ai)
  )
}

/** Plain-words summary of a scope, for the app and for consent prompts. */
export function describeScope(s: FlowScope): string[] {
  const out: string[] = []
  if (s.read.length) out.push(`Reads ${s.read.join(', ')}`)
  if (s.write.length) out.push(`Writes to ${s.write.join(', ')}`)
  if (s.connections.length) out.push(`Uses ${s.connections.join(', ')}`)
  if (s.network.length) out.push(`Calls ${s.network.join(', ')}`)
  if (s.secrets?.length) out.push(`Uses secrets ${s.secrets.join(', ')}`)
  if (s.ai) out.push('Uses AI models')
  if (!out.length) out.push('Touches nothing outside its own inputs')
  return out
}

type InputValue = string | number | boolean | null | InputValue[] | { [k: string]: InputValue }

/** Check run inputs against the manifest, apply defaults, and coerce strings from forms. */
export function validateInputs(manifest: FlowManifest, raw: Record<string, unknown>) {
  const out: Record<string, InputValue> = {}
  const problems: string[] = []
  for (const [key, spec] of Object.entries(manifest.inputs)) {
    let v = raw[key]
    if (v === undefined || v === '' || v === null) {
      if (spec.default !== undefined) out[key] = spec.default as InputValue
      else if (spec.required) problems.push(`${key} is required`)
      continue
    }
    switch (spec.type) {
      case 'number':
        if (typeof v === 'string') v = Number(v)
        if (typeof v !== 'number' || Number.isNaN(v)) problems.push(`${key} must be a number`)
        break
      case 'boolean':
        if (typeof v === 'string') v = v === 'true' || v === 'yes' || v === '1'
        if (typeof v !== 'boolean') problems.push(`${key} must be true or false`)
        break
      case 'string[]':
      case 'number[]': {
        if (typeof v === 'string') v = v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
        if (!Array.isArray(v)) {
          problems.push(`${key} must be a list`)
          break
        }
        if (spec.type === 'number[]') {
          v = (v as unknown[]).map(Number)
          if ((v as number[]).some((n) => Number.isNaN(n))) problems.push(`${key} must be a list of numbers`)
        } else v = (v as unknown[]).map(String)
        break
      }
      case 'json':
        if (typeof v === 'string') {
          try {
            v = JSON.parse(v)
          } catch {
            problems.push(`${key} must be JSON`)
          }
        }
        break
      default:
        if (typeof v !== 'string') v = String(v)
        if (spec.enum?.length && !spec.enum.includes(v as string)) problems.push(`${key} must be one of ${spec.enum.join(', ')}`)
    }
    out[key] = v as InputValue
  }
  const unknown = Object.keys(raw).filter((k) => !(k in manifest.inputs))
  if (unknown.length) problems.push(`unknown input${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`)
  return { inputs: out, problems }
}
