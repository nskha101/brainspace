import { and, eq, inArray } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM, atLeast, requireRole } from '../actor'
import { decryptJson, encryptJson, newId } from '../crypto'
import { flowSecret, getDb, user } from '../db'
import { forbidden, invalid, notFound } from '../errors'
import { SECRET_NAME } from '../flows/manifest'
import { logActivity } from './activity'

export type SecretRow = typeof flowSecret.$inferSelect

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
    }))
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name))
}

export async function setSecret(
  actor: Actor,
  input: { name: string; value?: string; hosts?: string[]; scope?: 'team' | 'me'; description?: string },
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
  const fields = {
    hosts,
    description: input.description ?? existing?.description ?? null,
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
      createdBy: actor.userId,
    })
  }
  await logActivity(actor, existing ? 'secret_update' : 'secret_add', { details: { name, scope: ownerId === TEAM ? 'team' : 'me', hosts } })
  return { name, scope: ownerId === TEAM ? 'team' : 'me', hosts, saved: true }
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
    const row = rows.find((r) => r.name === name && r.ownerId === userId) ?? rows.find((r) => r.name === name && r.ownerId === TEAM)
    if (row) out.set(name, { value: (await decryptJson<string>(row.value)) ?? '', hosts: row.hosts, source: row.ownerId === TEAM ? 'team' : 'me', id: row.id })
  }
  return out
}

/** Which of a flow's secrets the person has (for the app and for run checks). */
export async function secretStatus(workspaceId: string, userId: string, names: string[]) {
  if (!names.length) return []
  const rows = await getDb()
    .select({ name: flowSecret.name, ownerId: flowSecret.ownerId })
    .from(flowSecret)
    .where(and(eq(flowSecret.workspaceId, workspaceId), inArray(flowSecret.ownerId, [TEAM, userId]), inArray(flowSecret.name, names)))
  return names.map((n) => ({
    name: n,
    team: rows.some((r) => r.name === n && r.ownerId === TEAM),
    mine: rows.some((r) => r.name === n && r.ownerId === userId),
  }))
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
