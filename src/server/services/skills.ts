import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM } from '../actor'
import { getDb, node } from '../db'
import { notFound } from '../errors'
import { displayPath } from '../paths'
import { accessView, canSee } from './access'

export type SkillInfo = {
  name: string
  description: string
  path: string
  space: 'team' | 'me'
  files: string[]
  version: number
  updatedAt: number
}

export function parseFrontmatter(md: string): { data: Record<string, string>; body: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!m) return { data: {}, body: md }
  const data: Record<string, string> = {}
  let lastKey: string | undefined
  for (const line of m[1]!.split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (kv) {
      lastKey = kv[1]!
      data[lastKey] = kv[2]!.replace(/^["']|["']$/g, '').trim()
    } else if (lastKey && /^\s+\S/.test(line)) {
      data[lastKey] = `${data[lastKey]} ${line.trim()}`.trim()
    }
  }
  return { data, body: md.slice(m[0].length) }
}

/** Skills are folders under /team/skills or /me/skills that contain a SKILL.md. */
export async function listSkills(actor: Actor): Promise<SkillInfo[]> {
  const all = await getDb()
    .select()
    .from(node)
    .where(
      and(
        eq(node.workspaceId, actor.workspaceId),
        inArray(node.spaceId, [TEAM, actor.userId]),
        isNull(node.deletedAt),
        like(node.path, '/skills/%'),
      ),
    )
  const view = await accessView(actor)
  const rows = all.filter((r) => canSee(view, r.spaceId, r.path))
  const skillFiles = rows.filter((r) => /^\/skills\/[^/]+\/SKILL\.md$/i.test(r.path) && r.kind === 'doc')
  return skillFiles
    .map((f) => {
      const folder = f.path.replace(/\/SKILL\.md$/i, '')
      const { data } = parseFrontmatter(f.content ?? '')
      const files = rows
        .filter((r) => r.spaceId === f.spaceId && r.path.startsWith(folder + '/') && r.kind !== 'folder' && r.id !== f.id)
        .map((r) => displayPath(actor, r.spaceId, r.path))
      return {
        name: data.name || folder.split('/').pop()!,
        description: data.description || f.description || '',
        path: displayPath(actor, f.spaceId, f.path),
        space: (f.spaceId === TEAM ? 'team' : 'me') as 'team' | 'me',
        files,
        version: f.version,
        updatedAt: f.updatedAt.getTime(),
      }
    })
    .sort((a, b) => a.space.localeCompare(b.space) || a.name.localeCompare(b.name))
}

export async function getSkill(actor: Actor, name: string) {
  const skills = await listSkills(actor)
  const key = name.toLowerCase().replace(/^\/(team|me)\/skills\//, '').replace(/\/SKILL\.md$/i, '')
  // Private skills win over team skills with the same name, so people can override locally.
  const skill =
    skills.find((s) => s.space === 'me' && s.name.toLowerCase() === key) ??
    skills.find((s) => s.name.toLowerCase() === key) ??
    skills.find((s) => s.path.toLowerCase().includes(`/skills/${key}/`))
  if (!skill) throw notFound(`Skill "${name}"`, 'Use skills_list to see available skills.')
  const inner = skill.path.replace(/^\/(team|me)/, '')
  const [row] = await getDb()
    .select({ content: node.content })
    .from(node)
    .where(
      and(
        eq(node.workspaceId, actor.workspaceId),
        eq(node.spaceId, skill.space === 'team' ? TEAM : actor.userId),
        eq(node.path, inner),
        isNull(node.deletedAt),
      ),
    )
  return { ...skill, content: row?.content ?? '' }
}
