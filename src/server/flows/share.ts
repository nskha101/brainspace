import type { FlowScope } from '../db'

/** The /me paths a flow's `uses` lists, as paths inside the personal space ("/" is all of it). */
export function privateUses(uses: FlowScope): string[] {
  return [...new Set([...uses.read, ...uses.write])].filter((p) => /^\/me(\/|$)/.test(p)).map((p) => p.slice(3) || '/')
}

/** Drop paths that sit inside another path on the list. */
export function outermost(paths: string[]): string[] {
  return [...new Set(paths)].filter((p) => !paths.some((q) => q !== p && p.startsWith(q + '/')))
}

/**
 * Rewrite paths in a flow's files after what they point at moved. A path
 * matches whole or as a prefix of a longer path, never as part of another
 * name: moving /me/leads leaves /me/leads-old and /team/me/leads alone.
 */
export function repoint(text: string, moves: { from: string; to: string }[]): string {
  let out = text
  // Longest first, so a path inside a moved folder that moved somewhere else keeps its own destination.
  for (const m of [...moves].sort((a, z) => z.from.length - a.from.length)) {
    const from = m.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`(?<![\\w.-])${from}(?![\\w-]|\\.\\w)`, 'g'), () => m.to)
  }
  return out
}
