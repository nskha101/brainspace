import { parse as parseYaml, stringify as toYaml } from 'yaml'

/** Text helpers for templates: placeholders, frontmatter, and swapping a person's name out. */

export const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g
/** The same, for split(): odd parts are the field names. */
export const PLACEHOLDER_ONE = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/

export const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Fill {{field}} with values. Placeholders with no value stay as they are. */
export function fill(text: string, values: Record<string, string>) {
  return text.replace(PLACEHOLDER, (m, k: string) => (k in values ? values[k]! : m))
}

/**
 * Fill a flow's code. Values are escaped for a JS string, since that's where a {{field}} sits in code
 * (const ME = '{{slack_user_id}}'), so a name like O'Brien can't break it.
 */
export function fillCode(code: string, values: Record<string, string>) {
  const safe = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.replace(/[\\'"`]/g, '\\$&').replace(/\$\{/g, '\\${').replace(/\n/g, '\\n')]))
  return fill(code, safe)
}

/** Fill a FLOW.md. When plain text filling would break its YAML (a value with a colon, say), fill the parsed values instead. */
export function fillManifest(md: string, values: Record<string, string>) {
  const plain = fill(md, values)
  try {
    readDoc(plain)
    return plain
  } catch {
    const { data, body } = readDoc(md)
    return writeDoc(fillDeep(data, values), fill(body, values))
  }
}

export function fillDeep<T>(value: T, values: Record<string, string>): T {
  if (typeof value === 'string') return fill(value, values) as T
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, values)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [fill(k, values), fillDeep(v, values)])) as T
  return value
}

/** The placeholders in a text, in order of first use. */
export function placeholdersIn(text: string) {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!))]
}

/**
 * YAML frontmatter, read so that an unquoted {{name}} (which YAML would take for a map) still
 * comes back as text.
 */
export function readDoc(md: string): { data: Record<string, unknown>; body: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)
  if (!m) return { data: {}, body: md }
  const guarded = m[1]!.replace(PLACEHOLDER, (_, k: string) => `⟦${k}⟧`)
  const parsed = parseYaml(guarded) as unknown
  const restore = (v: unknown): unknown =>
    typeof v === 'string'
      ? v.replace(/⟦([a-z0-9_]+)⟧/g, '{{$1}}')
      : Array.isArray(v)
        ? v.map(restore)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [String(restore(k)), restore(x)]))
          : v
  const data = restore(parsed)
  return { data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}, body: md.slice(m[0].length) }
}

export function writeDoc(data: Record<string, unknown>, body: string) {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null))
  return `---\n${toYaml(clean, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trim()}\n`
}

export const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
export const strOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
export const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : null)
export const strMap = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, str(x)])) : ({} as Record<string, string>)

export function slugify(text: string) {
  return text
    .replace(PLACEHOLDER, '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

/** Swap one person's name and email for placeholders, so the template reads for anyone. */
export function generalizer(owner: { name: string; email: string }) {
  const full = owner.name.trim()
  const first = full.split(/\s+/)[0] ?? ''
  const swaps: [RegExp, string][] = []
  if (owner.email) swaps.push([new RegExp(escape(owner.email), 'gi'), '{{email}}'])
  if (full.includes(' ')) swaps.push([new RegExp(`\\b${escape(full)}\\b`, 'g'), '{{name}}'])
  if (first.length >= 3) swaps.push([new RegExp(`\\b${escape(first)}\\b`, 'g'), '{{first_name}}'])
  const replaced = new Set<string>()
  const run = (text: string) =>
    swaps.reduce((acc, [re, to]) => {
      const out = acc.replace(re, to)
      if (out !== acc) replaced.add(to)
      return out
    }, text)
  return { run, replaced }
}

/** Personal docs a bot or flow reads, like /me/slack/voice.md: each person needs their own. */
export function personalDocs(text: string) {
  return [...new Set([...text.matchAll(/\/me\/[A-Za-z0-9_./-]+\.(?:md|db|html|json|csv|txt)\b/g)].map((m) => m[0]))]
}
