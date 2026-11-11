import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Actor } from '../actor'
import { ROLE_RANK, TEAM, requireRole } from '../actor'
import { newId, randomToken, sha256Hex } from '../crypto'
import { apiKey, batch, getDb, invitation, member, node, user, workspace, type Role } from '../db'
import { appUrl } from '../env'
import { AppError, forbidden, invalid, notFound } from '../errors'
import { inviteEmail, sendEmail } from '../email'
import { logActivity } from './activity'
import { kickFromLive } from '../live'
import { write, mkdir } from './files'
import { SEED_DOCS } from './seed'

const ROLES: Role[] = ['admin', 'member', 'viewer']

export function assertRole(role: string): asserts role is Role {
  if (!ROLES.includes(role as Role)) throw invalid(`Unknown role "${role}". Use admin, member or viewer.`)
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace'
  )
}

type UserRow = { id: string; name: string; email: string }

export async function listWorkspaces(userId: string) {
  const rows = await getDb()
    .select({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role: member.role,
      createdAt: workspace.createdAt,
      onboardedAt: member.onboardedAt,
    })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .where(eq(member.userId, userId))
    .orderBy(asc(workspace.createdAt))
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime(), onboarded: !!r.onboardedAt, onboardedAt: undefined }))
}

export async function actorFor(
  u: UserRow,
  workspaceId: string,
  via: Actor['via'],
  clientName?: string,
): Promise<Actor> {
  const [row] = await getDb()
    .select({ role: member.role, name: workspace.name, slug: workspace.slug })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .where(and(eq(member.workspaceId, workspaceId), eq(member.userId, u.id)))
    .limit(1)
  if (!row) throw forbidden("You're not a member of that workspace.")
  return {
    userId: u.id,
    userName: u.name,
    email: u.email,
    workspaceId,
    workspaceName: row.name,
    workspaceSlug: row.slug,
    role: row.role,
    via,
    clientName,
  }
}

/** The workspace an MCP client or a fresh web session lands in. */
export async function defaultWorkspaceId(userId: string): Promise<string | undefined> {
  const db = getDb()
  const [u] = await db.select({ d: user.defaultWorkspaceId }).from(user).where(eq(user.id, userId))
  const all = await listWorkspaces(userId)
  if (u?.d && all.some((w) => w.id === u.d)) return u.d
  return all[0]?.id
}

export async function setDefaultWorkspace(userId: string, workspaceId: string) {
  const all = await listWorkspaces(userId)
  if (!all.some((w) => w.id === workspaceId)) throw forbidden("You're not a member of that workspace.")
  await getDb().update(user).set({ defaultWorkspaceId: workspaceId }).where(eq(user.id, userId))
}

export async function createWorkspace(u: UserRow, name: string, opts: { seed?: boolean } = {}) {
  const clean = name.trim().slice(0, 80)
  if (!clean) throw invalid('Give the workspace a name.')
  const db = getDb()
  let slug = slugify(clean)
  const [taken] = await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.slug, slug))
  if (taken) slug = `${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`
  const id = newId('ws')
  await batch([
    db.insert(workspace).values({ id, name: clean, slug, createdBy: u.id }),
    db.insert(member).values({ id: newId('m'), workspaceId: id, userId: u.id, role: 'admin' }),
    db.update(user).set({ defaultWorkspaceId: id }).where(eq(user.id, u.id)),
  ])
  const actor = await actorFor(u, id, 'web')
  if (opts.seed !== false) await seedWorkspace(actor)
  await logActivity(actor, 'workspace_create', { details: { name: clean } })
  return { id, name: clean, slug }
}

async function seedWorkspace(actor: Actor) {
  for (const d of SEED_DOCS) {
    if (d.folder) await mkdir(actor, d.path)
    else await write(actor, d.path, d.content!, { message: 'Starter content', description: d.description })
  }
}

export async function renameWorkspace(actor: Actor, name: string, description?: string) {
  requireRole(actor, 'admin', 'rename the workspace')
  const clean = name.trim().slice(0, 80)
  if (!clean) throw invalid('Give the workspace a name.')
  await getDb()
    .update(workspace)
    .set({ name: clean, ...(description !== undefined ? { description } : {}) })
    .where(eq(workspace.id, actor.workspaceId))
  await logActivity(actor, 'workspace_rename', { details: { name: clean } })
  return { name: clean }
}

export async function getWorkspace(actor: Actor) {
  const [w] = await getDb().select().from(workspace).where(eq(workspace.id, actor.workspaceId))
  if (!w) throw notFound('Workspace')
  return { ...w, createdAt: w.createdAt.getTime() }
}

export async function listMembers(actor: Actor) {
  const rows = await getDb()
    .select({
      userId: member.userId,
      role: member.role,
      joinedAt: member.createdAt,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.workspaceId, actor.workspaceId))
    .orderBy(asc(member.createdAt))
  return rows.map((r) => ({ ...r, joinedAt: r.joinedAt.getTime(), you: r.userId === actor.userId }))
}

async function adminCount(workspaceId: string) {
  const [r] = await getDb()
    .select({ c: sql<number>`count(*)` })
    .from(member)
    .where(and(eq(member.workspaceId, workspaceId), eq(member.role, 'admin')))
  return r?.c ?? 0
}

async function findMember(actor: Actor, who: string) {
  const db = getDb()
  const key = who.trim().toLowerCase()
  const [row] = await db
    .select({ userId: member.userId, role: member.role, email: user.email, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.workspaceId, actor.workspaceId),
        sql`(${member.userId} = ${who} OR lower(${user.email}) = ${key})`,
      ),
    )
    .limit(1)
  if (!row) throw notFound(`Member "${who}"`, 'Use members_list to see who is in the workspace.')
  return row
}

export async function setRole(actor: Actor, who: string, role: string) {
  assertRole(role)
  requireRole(actor, 'admin', 'change roles')
  const m = await findMember(actor, who)
  if (m.role === role) return { ...m, role, changed: false }
  if (m.role === 'admin' && role !== 'admin' && (await adminCount(actor.workspaceId)) <= 1) {
    throw invalid("This is the workspace's only admin.", 'Make someone else an admin first.')
  }
  await getDb()
    .update(member)
    .set({ role })
    .where(and(eq(member.workspaceId, actor.workspaceId), eq(member.userId, m.userId)))
  await logActivity(actor, 'role_change', { details: { member: m.email, from: m.role, to: role } })
  return { ...m, role, changed: true }
}

export async function removeMember(actor: Actor, who: string) {
  const m = await findMember(actor, who)
  if (m.userId !== actor.userId) requireRole(actor, 'admin', 'remove members')
  if (m.role === 'admin' && (await adminCount(actor.workspaceId)) <= 1) {
    throw invalid("This is the workspace's only admin.", 'Make someone else an admin first.')
  }
  const db = getDb()
  await batch([
    db.delete(member).where(and(eq(member.workspaceId, actor.workspaceId), eq(member.userId, m.userId))),
    db
      .update(apiKey)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKey.workspaceId, actor.workspaceId), eq(apiKey.userId, m.userId), isNull(apiKey.revokedAt))),
  ])
  kickFromLive(actor.workspaceId, m.userId)
  await logActivity(actor, m.userId === actor.userId ? 'member_leave' : 'member_remove', {
    details: { member: m.email },
  })
  return { removed: m.email }
}

export async function invite(actor: Actor, opts: { email?: string; role: string; sendEmail?: boolean }) {
  assertRole(opts.role)
  requireRole(actor, 'member', 'invite people')
  if (ROLE_RANK[opts.role] > ROLE_RANK[actor.role]) {
    throw forbidden('You can only invite people at your own role or below.', 'Ask an admin to invite admins.')
  }
  const email = opts.email?.trim().toLowerCase() || null
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid(`"${opts.email}" is not an email address.`)
  const db = getDb()
  if (email) {
    const [existing] = await db
      .select({ id: member.id })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.workspaceId, actor.workspaceId), eq(sql`lower(${user.email})`, email)))
    if (existing) throw new AppError('conflict', `${email} is already a member.`, { hint: 'Use member_set_role to change their role.' })
  }
  const token = randomToken(24)
  const id = newId('inv')
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)
  await db.insert(invitation).values({ id, workspaceId: actor.workspaceId, email, role: opts.role, token, invitedBy: actor.userId, expiresAt })
  const url = `${appUrl()}/invite/${token}`
  let emailed = false
  if (email && opts.sendEmail !== false) {
    emailed = await sendEmail({
      to: email,
      ...inviteEmail({ url, workspace: actor.workspaceName, inviter: actor.userName || actor.email, role: opts.role }),
    })
  }
  await logActivity(actor, 'invite', { details: { email, role: opts.role } })
  return {
    id,
    url,
    email,
    role: opts.role,
    emailed,
    expiresAt: expiresAt.getTime(),
    note: email
      ? `Only ${email} can accept this invite.`
      : 'Anyone with this link can join until it expires or is revoked.',
  }
}

export async function listInvites(actor: Actor) {
  const rows = await getDb()
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      invitedBy: user.name,
    })
    .from(invitation)
    .leftJoin(user, eq(user.id, invitation.invitedBy))
    .where(
      and(
        eq(invitation.workspaceId, actor.workspaceId),
        isNull(invitation.acceptedAt),
        isNull(invitation.revokedAt),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitation.createdAt))
  return rows.map(({ token, ...r }) => ({
    ...r,
    url: `${appUrl()}/invite/${token}`,
    expiresAt: r.expiresAt.getTime(),
    createdAt: r.createdAt.getTime(),
  }))
}

export async function revokeInvite(actor: Actor, id: string) {
  requireRole(actor, 'member', 'revoke invites')
  const res = await getDb()
    .update(invitation)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitation.id, id), eq(invitation.workspaceId, actor.workspaceId)))
    .returning({ id: invitation.id })
  if (!res.length) throw notFound('Invite')
  await logActivity(actor, 'invite_revoke', { details: { id } })
  return { revoked: id }
}

export async function lookupInvite(token: string) {
  const [row] = await getDb()
    .select({ inv: invitation, wsName: workspace.name, inviter: user.name })
    .from(invitation)
    .innerJoin(workspace, eq(workspace.id, invitation.workspaceId))
    .leftJoin(user, eq(user.id, invitation.invitedBy))
    .where(eq(invitation.token, token))
    .limit(1)
  if (!row) return null
  const { inv } = row
  const usable = !inv.revokedAt && inv.expiresAt > new Date() && !(inv.email && inv.acceptedAt)
  return {
    workspaceId: inv.workspaceId,
    workspaceName: row.wsName,
    inviter: row.inviter,
    email: inv.email,
    role: inv.role,
    usable,
  }
}

/** Open invites addressed to this email, so someone who signs in from their agent can join without the invite link. */
export async function pendingInvitesFor(email: string) {
  const rows = await getDb()
    .select({ token: invitation.token, role: invitation.role, workspaceName: workspace.name, inviter: user.name })
    .from(invitation)
    .innerJoin(workspace, eq(workspace.id, invitation.workspaceId))
    .leftJoin(user, eq(user.id, invitation.invitedBy))
    .where(
      and(
        eq(sql`lower(${invitation.email})`, email.toLowerCase()),
        isNull(invitation.acceptedAt),
        isNull(invitation.revokedAt),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitation.createdAt))
  return rows
}

export async function acceptInvite(u: UserRow, token: string) {
  const db = getDb()
  const [inv] = await db.select().from(invitation).where(eq(invitation.token, token)).limit(1)
  if (!inv || inv.revokedAt || inv.expiresAt < new Date()) throw invalid('This invite is no longer valid.', 'Ask for a new invite.')
  if (inv.email) {
    if (inv.acceptedAt) throw invalid('This invite was already used.')
    if (inv.email.toLowerCase() !== u.email.toLowerCase()) {
      throw forbidden(`This invite is for ${inv.email}. You're signed in as ${u.email}.`, 'Sign in with the invited email.')
    }
  }
  const [existing] = await db
    .select()
    .from(member)
    .where(and(eq(member.workspaceId, inv.workspaceId), eq(member.userId, u.id)))
  if (!existing) {
    await batch([
      db.insert(member).values({ id: newId('m'), workspaceId: inv.workspaceId, userId: u.id, role: inv.role }),
      db.update(user).set({ defaultWorkspaceId: inv.workspaceId }).where(eq(user.id, u.id)),
      ...(inv.email ? [db.update(invitation).set({ acceptedAt: new Date(), acceptedBy: u.id }).where(eq(invitation.id, inv.id))] : []),
    ])
    const actor = await actorFor(u, inv.workspaceId, 'web')
    await logActivity(actor, 'member_join', { details: { role: inv.role } })
  }
  return { workspaceId: inv.workspaceId }
}

// API keys --------------------------------------------------------------

export const API_KEY_PREFIX = 'bs_'

export async function createApiKey(actor: Actor, name: string) {
  const clean = name.trim().slice(0, 80) || 'Agent key'
  const token = `${API_KEY_PREFIX}${randomToken(30)}`
  const id = newId('key')
  await getDb().insert(apiKey).values({
    id,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    name: clean,
    prefix: token.slice(0, 10),
    hash: await sha256Hex(token),
  })
  await logActivity(actor, 'api_key_create', { details: { name: clean } })
  return { id, name: clean, token, note: 'Store this key now. It will not be shown again.' }
}

export async function listApiKeys(actor: Actor) {
  const rows = await getDb()
    .select({
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      lastUsedAt: apiKey.lastUsedAt,
      createdAt: apiKey.createdAt,
      userId: apiKey.userId,
      userName: user.name,
    })
    .from(apiKey)
    .leftJoin(user, eq(user.id, apiKey.userId))
    .where(
      and(
        eq(apiKey.workspaceId, actor.workspaceId),
        isNull(apiKey.revokedAt),
        actor.role === 'admin' ? undefined : eq(apiKey.userId, actor.userId),
      ),
    )
    .orderBy(desc(apiKey.createdAt))
  return rows.map((r) => ({
    ...r,
    lastUsedAt: r.lastUsedAt?.getTime() ?? null,
    createdAt: r.createdAt.getTime(),
    yours: r.userId === actor.userId,
  }))
}

export async function revokeApiKey(actor: Actor, id: string) {
  const db = getDb()
  const [k] = await db.select().from(apiKey).where(and(eq(apiKey.id, id), eq(apiKey.workspaceId, actor.workspaceId)))
  if (!k || k.revokedAt) throw notFound('API key')
  if (k.userId !== actor.userId) requireRole(actor, 'admin', "revoke other people's keys")
  await db.update(apiKey).set({ revokedAt: new Date() }).where(eq(apiKey.id, id))
  await logActivity(actor, 'api_key_revoke', { details: { name: k.name } })
  return { revoked: k.name }
}

export async function authenticateApiKey(token: string) {
  if (!token.startsWith(API_KEY_PREFIX)) return null
  const db = getDb()
  const [row] = await db
    .select({ k: apiKey, u: user })
    .from(apiKey)
    .innerJoin(user, eq(user.id, apiKey.userId))
    .where(and(eq(apiKey.hash, await sha256Hex(token)), isNull(apiKey.revokedAt)))
    .limit(1)
  if (!row) return null
  if (!row.k.lastUsedAt || Date.now() - row.k.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, row.k.id))
  }
  return { user: row.u, workspaceId: row.k.workspaceId, keyName: row.k.name }
}

export { TEAM }

// Auto-join by email domain ----------------------------------------------

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net',
  'yandex.com', 'mail.com', 'zoho.com', 'hey.com', 'fastmail.com', 'tutanota.com', 'qq.com', '163.com',
])

export function emailDomain(email: string) {
  return email.split('@')[1]?.trim().toLowerCase() ?? ''
}

export async function getAutoJoin(actor: Actor) {
  const [w] = await getDb()
    .select({ domain: workspace.autoJoinDomain, role: workspace.autoJoinRole })
    .from(workspace)
    .where(eq(workspace.id, actor.workspaceId))
  const yourDomain = emailDomain(actor.email)
  return {
    enabled: !!w?.domain,
    domain: w?.domain ?? null,
    role: w?.role ?? 'member',
    yourDomain,
    available: !PUBLIC_EMAIL_DOMAINS.has(yourDomain),
  }
}

/** Add every verified user on the domain who isn't a member yet. Returns their emails. */
async function addDomainUsers(workspaceId: string, domain: string, role: Role, by?: Actor) {
  const db = getDb()
  const candidates = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(and(sql`lower(${user.email}) LIKE ${'%@' + domain}`, eq(user.emailVerified, true)))
  const existing = new Set(
    (await db.select({ userId: member.userId }).from(member).where(eq(member.workspaceId, workspaceId))).map((m) => m.userId),
  )
  const added: string[] = []
  for (const u of candidates) {
    if (existing.has(u.id) || emailDomain(u.email) !== domain) continue
    await db.insert(member).values({ id: newId('m'), workspaceId, userId: u.id, role }).onConflictDoNothing()
    await db
      .update(user)
      .set({ defaultWorkspaceId: workspaceId })
      .where(and(eq(user.id, u.id), isNull(user.defaultWorkspaceId)))
    const actor = await actorFor(u, workspaceId, by?.via ?? 'web', by?.clientName)
    await logActivity(actor, 'member_join', { details: { role, via: `auto-join for @${domain}` } })
    added.push(u.email)
  }
  return added
}

export async function setAutoJoin(actor: Actor, opts: { enabled: boolean; role?: string }) {
  requireRole(actor, 'admin', 'change auto-join')
  const role = opts.role ?? 'member'
  assertRole(role)
  const domain = emailDomain(actor.email)
  if (opts.enabled && PUBLIC_EMAIL_DOMAINS.has(domain)) {
    throw invalid(
      `@${domain} is a public email provider, so auto-join would let anyone in.`,
      'Auto-join only works for company domains. Send invites instead.',
    )
  }
  await getDb()
    .update(workspace)
    .set({ autoJoinDomain: opts.enabled ? domain : null, autoJoinRole: role })
    .where(eq(workspace.id, actor.workspaceId))
  await logActivity(actor, opts.enabled ? 'auto_join_on' : 'auto_join_off', { details: { domain, role } })
  const added = opts.enabled ? await addDomainUsers(actor.workspaceId, domain, role, actor) : []
  return { ...(await getAutoJoin(actor)), addedNow: added }
}

/** Called on every sign-in: joins workspaces that auto-add the user's verified domain. */
export async function autoJoinOnSignIn(userId: string) {
  const db = getDb()
  const [u] = await db.select().from(user).where(eq(user.id, userId))
  if (!u?.emailVerified) return
  const domain = emailDomain(u.email)
  if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) return
  const spaces = await db
    .select({ id: workspace.id, role: workspace.autoJoinRole })
    .from(workspace)
    .where(eq(workspace.autoJoinDomain, domain))
  for (const w of spaces) await addDomainUsers(w.id, domain, w.role)
}

// Welcome flow --------------------------------------------------------------

export async function markOnboarded(actor: Actor) {
  await getDb()
    .update(member)
    .set({ onboardedAt: new Date() })
    .where(and(eq(member.workspaceId, actor.workspaceId), eq(member.userId, actor.userId)))
  return { ok: true }
}

/** Remember that this member's agent is connected. At most one write per 5 minutes. */
export async function touchAgent(actor: Actor) {
  const cutoff = new Date(Date.now() - 5 * 60_000)
  await getDb()
    .update(member)
    .set({ agentSeenAt: new Date(), agentClient: actor.clientName?.slice(0, 80) ?? null })
    .where(
      and(
        eq(member.workspaceId, actor.workspaceId),
        eq(member.userId, actor.userId),
        sql`(${member.agentSeenAt} IS NULL OR ${member.agentSeenAt} < ${cutoff.getTime()})`,
      ),
    )
}

export async function onboardingStatus(actor: Actor) {
  const db = getDb()
  const [m] = await db
    .select({ agentSeenAt: member.agentSeenAt, agentClient: member.agentClient, joinedAt: member.createdAt })
    .from(member)
    .where(and(eq(member.workspaceId, actor.workspaceId), eq(member.userId, actor.userId)))
  const [w] = await db.select().from(workspace).where(eq(workspace.id, actor.workspaceId))
  const [counts] = await db
    .select({
      teamDocs: sql<number>`sum(case when ${node.kind} = 'doc' then 1 else 0 end)`,
      teamFiles: sql<number>`sum(case when ${node.kind} = 'file' then 1 else 0 end)`,
    })
    .from(node)
    .where(and(eq(node.workspaceId, actor.workspaceId), eq(node.spaceId, 'team'), isNull(node.deletedAt)))
  const [mc] = await db.select({ c: sql<number>`count(*)` }).from(member).where(eq(member.workspaceId, actor.workspaceId))
  return {
    workspaceName: actor.workspaceName,
    role: actor.role,
    userName: actor.userName,
    createdWorkspace: w?.createdBy === actor.userId,
    agent: m?.agentSeenAt ? { connected: true, client: m.agentClient, at: m.agentSeenAt.getTime() } : { connected: false },
    teamDocs: counts?.teamDocs ?? 0,
    teamFiles: counts?.teamFiles ?? 0,
    memberCount: mc?.c ?? 1,
    joinedAt: m?.joinedAt.getTime() ?? Date.now(),
  }
}
