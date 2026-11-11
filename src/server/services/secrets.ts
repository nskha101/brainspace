import { and, eq, inArray } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM, atLeast, requireRole } from '../actor'
import { decryptJson, encryptJson, newId } from '../crypto'
import { flowSecret, getDb, member, user } from '../db'
import { forbidden, invalid, notFound } from '../errors'
import { SECRET_NAME } from '../flows/manifest'
import { resolvePeople } from './access'
import { logActivity } from './activity'

export type SecretRow = typeof flowSecret.$inferSelect

/**
 * Whether runs acting as this person may use a secret. Personal secrets belong
 * to their owner. A team secret with a people list is only for those people;
 * admins are not exempt, so "only Nith and Farris" means exactly that.
 */
export const canUseSecret = (row: Pick<SecretRow, 'ownerId' | 'accessUsers'>, userId: string) =>
  row.ownerId === TEAM ? !row.accessUsers || row.accessUsers.includes(userId) : row.ownerId === userId

/** The person who added a team secret decides who may use it. */
const canChangePeople = (actor: Actor, row: SecretRow | undefined) => !row || row.createdBy === actor.userId

function joinNames(list: string[]) {
  if (list.length <= 1) return list[0] ?? 'nobody'
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

async function namesFor(workspaceId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>()
  const rows = await getDb()
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .innerJoin(member, and(eq(member.userId, user.id), eq(member.workspaceId, workspaceId)))
    .where(inArray(user.id, ids))
  return new Map(rows.map((u) => [u.id, u.name || u.email]))
}

export function normalizeHosts(hosts: string[]) {
  const out = hosts
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean)
  for (const h of out) {
    if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) throw invalid(`"${h}" is not a host name.`, 'Use host names like api.example.com or *.example.com.')
  }
  return [...new Set(out)]
}

export function hostAllowed(hosts: string[], host: string) {
  const h = host.toLowerCase()
  return hosts.some((x) => (x.startsWith('*.') ? h.endsWith(x.slice(1)) : h === x))
}

/** Names and metadata only. Values never leave the server. */
export async function listSecrets(actor: Actor) {
  const rows = await getDb()
    .select()
    .from(flowSecret)
    .where(and(eq(flowSecret.workspaceId, actor.workspaceId), inArray(flowSecret.ownerId, [TEAM, actor.userId])))
  const people = new Map(
    (rows.length ? await getDb().select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(rows.map((r) => r.createdBy))])) : []).map((u) => [u.id, u.name]),
  )
  const listed = await namesFor(actor.workspaceId, [...new Set(rows.flatMap((r) => r.accessUsers ?? []))])
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      scope: (r.ownerId === TEAM ? 'team' : 'me') as 'team' | 'me',
      hosts: r.hosts,
      description: r.description,
      createdBy: people.get(r.createdBy) ?? 'Unknown',
      updatedAt: r.updatedAt.getTime(),
      lastUsedAt: r.lastUsedAt?.getTime() ?? null,
      canEdit: r.ownerId !== TEAM || r.createdBy === actor.userId || atLeast(actor, 'admin'),
      /** Team secrets only: who may use it in runs. Null means any run. Names of people who have left are dropped. */
      people: r.ownerId === TEAM && r.accessUsers ? r.accessUsers.filter((id) => listed.has(id)).map((id) => ({ userId: id, name: listed.get(id)! })) : null,
      canUse: canUseSecret(r, actor.userId),
      canChangePeople: r.ownerId === TEAM && canChangePeople(actor, r),
    }))
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name))
}

export async function setSecret(
  actor: Actor,
  input: { name: string; value?: string; hosts?: string[]; scope?: 'team' | 'me'; description?: string; people?: string[] | null },
) {
  requireRole(actor, 'member', 'manage secrets')
  const name = input.name.trim().toUpperCase()
  if (!SECRET_NAME.test(name)) throw invalid(`"${input.name}" isn't a valid secret name.`, 'Use UPPER_SNAKE_CASE, like WEATHER_API_KEY.')
  const ownerId = input.scope === 'me' ? actor.userId : TEAM
  const db = getDb()
  const [existing] = await db
    .select()
    .from(flowSecret)
    .where(and(eq(flowSecret.workspaceId, actor.workspaceId), eq(flowSecret.ownerId, ownerId), eq(flowSecret.name, name)))
  if (existing && ownerId === TEAM && existing.createdBy !== actor.userId && !atLeast(actor, 'admin')) {
    throw forbidden(`Only whoever added the team secret ${name}, or an admin, can change it.`, 'Add your own with scope "me" instead. Your runs use it in place of the team one.')
  }
  const hosts = input.hosts ? normalizeHosts(input.hosts) : existing?.hosts
  if (!hosts?.length) throw invalid('Say which hosts this secret may be sent to.', 'For example hosts: ["api.openweathermap.org"]. Brainspace only puts the value on requests to these hosts.')
  if (!existing && !input.value) throw invalid('Give the secret a value.')
  if (input.value !== undefined && (input.value.length < 1 || input.value.length > 8000)) throw invalid('Secret values must be 1 to 8000 characters.')
  let accessUsers = existing?.accessUsers ?? null
  if (input.people !== undefined) {
    if (ownerId !== TEAM) throw invalid('Only team secrets have a people list.', 'A personal secret is already only for runs that act as you.')
    if (!canChangePeople(actor, existing)) {
      throw forbidden(`Only whoever added ${name} can change who may use it.`, 'Ask them, or add your own personal secret with scope "me".')
    }
    if (input.people === null || !input.people.length) accessUsers = null
    else {
      const { ids } = await resolvePeople(actor, input.people)
      if (!ids.includes(actor.userId)) throw invalid('Include yourself in people.', 'Otherwise your own runs could not use the secret you are saving.')
      accessUsers = ids
    }
  }
  const fields = {
    hosts,
    description: input.description ?? existing?.description ?? null,
    accessUsers,
    updatedAt: new Date(),
    ...(input.value !== undefined ? { value: await encryptJson(input.value) } : {}),
  }
  if (existing) await db.update(flowSecret).set(fields).where(eq(flowSecret.id, existing.id))
  else {
    await db.insert(flowSecret).values({
      id: newId('sec'),
      workspaceId: actor.workspaceId,
      ownerId,
      name,
      value: fields.value!,
      hosts,
      description: fields.description,
      accessUsers,
      createdBy: actor.userId,
    })
  }
  const people = accessUsers ? [...(await namesFor(actor.workspaceId, accessUsers)).values()] : null
  await logActivity(actor, existing ? 'secret_update' : 'secret_add', { details: { name, scope: ownerId === TEAM ? 'team' : 'me', hosts, ...(people ? { people } : {}) } })
  return { name, scope: ownerId === TEAM ? 'team' : 'me', hosts, people: people ?? 'everyone', saved: true }
}

export async function removeSecret(actor: Actor, input: { name: string; scope?: 'team' | 'me' }) {
  requireRole(actor, 'member', 'manage secrets')
  const name = input.name.trim().toUpperCase()
  const ownerId = input.scope === 'me' ? actor.userId : TEAM
  const [row] = await getDb()
    .select()
    .from(flowSecret)
    .where(and(eq(flowSecret.workspaceId, actor.workspaceId), eq(flowSecret.ownerId, ownerId), eq(flowSecret.name, name)))
  if (!row) throw notFound(`Secret ${name}`, 'Use secrets_list to see what exists.')
  if (ownerId === TEAM && row.createdBy !== actor.userId && !atLeast(actor, 'admin')) throw forbidden('Only whoever added a team secret, or an admin, can remove it.')
  await getDb().delete(flowSecret).where(eq(flowSecret.id, row.id))
  await logActivity(actor, 'secret_remove', { details: { name, scope: input.scope ?? 'team' } })
  return { removed: name }
}

export type ResolvedSecret = { value: string; hosts: string[]; source: 'me' | 'team' | 'run'; id?: string }

/**
 * The secrets a run can use: the run-as person's own first, then the team's,
 * then any passed for this run only (which may go to the flow's network hosts).
 */
export async function resolveSecrets(
  workspaceId: string,
  userId: string,
  names: string[],
  runSecrets: Record<string, string> | undefined,
  runHosts: string[],
): Promise<Map<string, ResolvedSecret>> {
  const out = new Map<string, ResolvedSecret>()
  if (!names.length) return out
  const rows = await getDb()
    .select()
    .from(flowSecret)
    .where(and(eq(flowSecret.workspaceId, workspaceId), inArray(flowSecret.ownerId, [TEAM, userId]), inArray(flowSecret.name, names)))
  for (const name of names) {
    if (runSecrets?.[name] !== undefined) {
      out.set(name, { value: runSecrets[name]!, hosts: normalizeHosts(runHosts), source: 'run' })
      continue
    }
    const row = rows.find((r) => r.name === name && r.ownerId === userId) ?? rows.find((r) => r.name === name && r.ownerId === TEAM && canUseSecret(r, userId))
    if (row) out.set(name, { value: (await decryptJson<string>(row.value)) ?? '', hosts: row.hosts, source: row.ownerId === TEAM ? 'team' : 'me', id: row.id })
  }
  return out
}

/** Which of a flow's secrets the person has (for the app and for run checks). */
export async function secretStatus(workspaceId: string, userId: string, names: string[]) {
  if (!names.length) return []
  const rows = await getDb()
    .select({ name: flowSecret.name, ownerId: flowSecret.ownerId, accessUsers: flowSecret.accessUsers })
    .from(flowSecret)
    .where(and(eq(flowSecret.workspaceId, workspaceId), inArray(flowSecret.ownerId, [TEAM, userId]), inArray(flowSecret.name, names)))
  const blocked = rows.filter((r) => r.ownerId === TEAM && !canUseSecret(r, userId))
  const listed = await namesFor(workspaceId, [...new Set(blocked.flatMap((r) => r.accessUsers ?? []))])
  return names.map((n) => {
    const team = rows.find((r) => r.name === n && r.ownerId === TEAM)
    return {
      name: n,
      team: !!team && canUseSecret(team, userId),
      mine: rows.some((r) => r.name === n && r.ownerId === userId),
      /** Set when a team secret exists but only other people may use it. */
      ...(team && !canUseSecret(team, userId) ? { restrictedTo: joinNames((team.accessUsers ?? []).map((id) => listed.get(id)).filter((x): x is string => !!x)) } : {}),
    }
  })
}

export async function touchSecret(id: string) {
  await getDb().update(flowSecret).set({ lastUsedAt: new Date() }).where(eq(flowSecret.id, id))
}

export async function encryptRunSecrets(values: Record<string, string>) {
  return Object.keys(values).length ? encryptJson(values) : null
}

export async function decryptRunSecrets(blob: string | null | undefined) {
  return (await decryptJson<Record<string, string>>(blob)) ?? undefined
}
