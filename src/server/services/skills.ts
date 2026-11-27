import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM } from '../actor'
import { getDb, node, user } from '../db'
import { notFound } from '../errors'
import { displayPath } from '../paths'
import { accessView, canSee, effectiveAudience } from './access'
import { recordRead } from './reads'
import { cleanIcon, cleanTitle, humanize } from '../../lib/icons'

export type SkillInfo = {
  name: string
  /** From `title` in the frontmatter, else made from the name. */
  title: string
  /** One emoji from `icon` in the frontmatter. */
  icon: string | null
  /** Whoever first saved its SKILL.md. */
  createdBy: string | null
  description: string
  path: string
  space: 'team' | 'me'
  /** A team skill only certain people can see. */
  restricted: boolean
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
  const authorIds = [...new Set(skillFiles.map((f) => f.createdBy))]
  const authors = authorIds.length
    ? new Map((await getDb().select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, authorIds))).map((u) => [u.id, u.name]))
    : new Map<string, string>()
  return skillFiles
    .map((f) => {
      const folder = f.path.replace(/\/SKILL\.md$/i, '')
      const { data } = parseFrontmatter(f.content ?? '')
      const files = rows
        .filter((r) => r.spaceId === f.spaceId && r.path.startsWith(folder + '/') && r.kind !== 'folder' && r.id !== f.id)
        .map((r) => displayPath(actor, r.spaceId, r.path))
      const name = data.name || folder.split('/').pop()!
      return {
        name,
        title: cleanTitle(data.title) ?? humanize(name),
        icon: cleanIcon(data.icon),
        createdBy: authors.get(f.createdBy) ?? null,
        description: data.description || f.description || '',
        path: displayPath(actor, f.spaceId, f.path),
        space: (f.spaceId === TEAM ? 'team' : 'me') as 'team' | 'me',
        restricted: f.spaceId === TEAM && effectiveAudience(view, f.path) !== null,
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
    .select({ id: node.id, kind: node.kind, content: node.content })
    .from(node)
    .where(
      and(
        eq(node.workspaceId, actor.workspaceId),
        eq(node.spaceId, skill.space === 'team' ? TEAM : actor.userId),
        eq(node.path, inner),
        isNull(node.deletedAt),
      ),
    )
  // Loading a skill to follow it counts as reading its SKILL.md.
  if (row) recordRead(actor, row)
  return { ...skill, content: row?.content ?? '' }
}
