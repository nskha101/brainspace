import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM, requireRole } from '../actor'
import { bot, flowTrigger, getDb, node, user, type Json } from '../db'
import { AppError, invalid, notFound } from '../errors'
import { displayPath, parsePath } from '../paths'
import { accessView, canSee } from './access'
import { logActivity } from './activity'
import { createBot, findBot, updateBot, type BotInput } from './bots'
import { listConnections } from './connections'
import { recordRead } from './reads'
import { listSecrets } from './secrets'
import { cleanIcon, cleanTitle, humanize } from '../../lib/icons'
import { escape, fill, fillDeep, generalizer, personalDocs, placeholdersIn, readDoc, slugify, str, strList, strMap, strOrNull, writeDoc } from '../templates-text'

/**
 * Templates: a bot, and the flows around it, packaged so a teammate can set up
 * their own copy. A template is a folder in a space, like a skill:
 *
 *   /team/templates/<name>/TEMPLATE.md          what it is, what you need, the setup guide
 *   /team/templates/<name>/bots/<bot>.md        a bot's settings (frontmatter) and instructions (body)
 *   /team/templates/<name>/flows/<flow>/FLOW.md and flow.ts, copied as they are
 *
 * Files can say {{name}}, {{first_name}} and {{email}}, which become the person
 * setting it up, and any {{field}} TEMPLATE.md declares under `fields`. Using a
 * template creates private bots and /me flows owned by whoever uses it, so they
 * run with that person's own connections, logins and secrets.
 *
 * Flows inside a template are not live: flows are only folders directly under /flows.
 */

const BUILTIN_FIELDS: Record<string, string> = {
  name: 'Your full name',
  first_name: 'Your first name',
  email: 'Your email',
}
const FIELD_NAME = /^[a-z][a-z0-9_]{0,39}$/
const CODE_FILES = ['flow.ts', 'flow.js']
const MAX_TEMPLATE_BOTS = 5
const MAX_TEMPLATE_FLOWS = 10

export type TemplateNeeds = {
  /** Connection slugs the bots and flows call. */
  connections: string[]
  /** Secret name -> what it is and where to get it. */
  secrets: Record<string, string>
  /** Doc path -> what it should say. Usually /me paths each person writes for themselves. */
  docs: Record<string, string>
}

export type TemplateTrigger = {
  flow: string
  kind: 'schedule' | 'webhook'
  name?: string
  cron?: string
  timezone?: string
  inputs?: Record<string, Json>
}

export type TemplateBot = {
  file: string
  name: string
  icon: string | null
  description: string | null
  instructions: string
  model: string | null
  cron: string | null
  timezone: string | null
  tools: string[] | null
  connections: string[] | null
  paths: { read?: string[]; write?: string[] } | null
  webhook: boolean
  slack: boolean
}

export type TemplateFlow = { name: string; description: string; manifest: string; code: string; codeFile: string }

export type Template = {
  name: string
  title: string
  icon: string | null
  description: string
  maker: string | null
  space: 'team' | 'me'
  /** The template's folder, like /team/templates/slack-reply-drafts. */
  path: string
  version: number
  updatedAt: number
  fields: Record<string, string>
  needs: TemplateNeeds
  triggers: TemplateTrigger[]
  /** The body of TEMPLATE.md: how to set it up, for people and their agents. */
  guide: string
  bots: TemplateBot[]
  flows: TemplateFlow[]
  /** Set when a file in the template can't be read, so the list still shows it. */
  problems: string[]
}

// ------------------------------------------------------------------ reading templates

function parseBot(file: string, md: string): TemplateBot {
  const { data, body } = readDoc(md)
  const paths = data.paths && typeof data.paths === 'object' ? (data.paths as Record<string, unknown>) : null
  return {
    file,
    name: str(data.name) || humanize(file.replace(/\.md$/i, '')),
    icon: strOrNull(data.icon),
    description: strOrNull(data.description),
    instructions: body.trim(),
    model: strOrNull(data.model),
    cron: strOrNull(data.cron),
    timezone: strOrNull(data.timezone),
    tools: strList(data.tools),
    connections: strList(data.connections),
    paths: paths ? { read: strList(paths.read) ?? undefined, write: strList(paths.write) ?? undefined } : null,
    webhook: data.webhook === true,
    slack: data.slack === true,
  }
}

function parseTriggers(v: unknown): TemplateTrigger[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({
      flow: str(t.flow),
      kind: t.kind === 'schedule' ? ('schedule' as const) : ('webhook' as const),
      name: strOrNull(t.name) ?? undefined,
      cron: strOrNull(t.cron) ?? undefined,
      timezone: strOrNull(t.timezone) ?? undefined,
      inputs: t.inputs && typeof t.inputs === 'object' ? (t.inputs as Record<string, Json>) : undefined,
    }))
    .filter((t) => t.flow)
}

type NodeRow = typeof node.$inferSelect

async function templateNodes(actor: Actor) {
  const rows = await getDb()
    .select()
    .from(node)
    .where(and(eq(node.workspaceId, actor.workspaceId), inArray(node.spaceId, [TEAM, actor.userId]), isNull(node.deletedAt), like(node.path, '/templates/%')))
  const view = await accessView(actor)
  return rows.filter((r) => canSee(view, r.spaceId, r.path))
}

function buildTemplate(actor: Actor, main: NodeRow, rows: NodeRow[], makers: Map<string, string>): Template {
  const folder = main.path.replace(/\/TEMPLATE\.md$/i, '')
  const inside = rows.filter((r) => r.spaceId === main.spaceId && r.path.startsWith(folder + '/') && r.kind === 'doc')
  const problems: string[] = []
  let data: Record<string, unknown> = {}
  let body = main.content ?? ''
  try {
    ;({ data, body } = readDoc(main.content ?? ''))
  } catch (err) {
    problems.push(`TEMPLATE.md: ${(err as Error).message.split('\n')[0]}`)
  }
  const name = str(data.name) || folder.split('/').pop()!
  const bots: TemplateBot[] = []
  for (const r of inside.filter((r) => new RegExp(`^${escape(folder)}/bots/[^/]+\\.md$`, 'i').test(r.path)).sort((a, b) => a.path.localeCompare(b.path))) {
    try {
      bots.push(parseBot(r.name, r.content ?? ''))
    } catch (err) {
      problems.push(`bots/${r.name}: ${(err as Error).message.split('\n')[0]}`)
    }
  }
  const flows: TemplateFlow[] = []
  for (const r of inside.filter((r) => new RegExp(`^${escape(folder)}/flows/[^/]+/FLOW\\.md$`, 'i').test(r.path)).sort((a, b) => a.path.localeCompare(b.path))) {
    const dir = r.path.replace(/\/FLOW\.md$/i, '')
    const code = CODE_FILES.map((n) => inside.find((x) => x.path.toLowerCase() === `${dir}/${n}`.toLowerCase())).find(Boolean)
    const flowName = dir.split('/').pop()!
    if (!code) problems.push(`flows/${flowName} has no flow.ts.`)
    flows.push({
      name: flowName,
      description: (r.content ?? '').match(/^description:\s*["']?(.*?)["']?\s*$/m)?.[1] ?? '',
      manifest: r.content ?? '',
      code: code?.content ?? '',
      codeFile: code?.name ?? 'flow.ts',
    })
  }
  const needs = data.needs && typeof data.needs === 'object' ? (data.needs as Record<string, unknown>) : {}
  const fields = strMap(data.fields)
  for (const k of Object.keys(fields)) if (!FIELD_NAME.test(k) || k in BUILTIN_FIELDS) problems.push(`fields: "${k}" can't be a field name.`)
  return {
    name,
    title: cleanTitle(data.title) ?? humanize(name),
    icon: cleanIcon(data.icon),
    description: str(data.description),
    maker: makers.get(main.createdBy) ?? null,
    space: main.spaceId === TEAM ? 'team' : 'me',
    path: displayPath(actor, main.spaceId, folder),
    version: main.version,
    updatedAt: main.updatedAt.getTime(),
    fields,
    needs: {
      connections: strList(needs.connections) ?? [],
      secrets: strMap(needs.secrets),
      docs: strMap(needs.docs),
    },
    triggers: parseTriggers(data.triggers),
    guide: body.trim(),
    bots,
    flows,
    problems,
  }
}


async function loadTemplates(actor: Actor) {
  const rows = await templateNodes(actor)
  const mains = rows.filter((r) => r.kind === 'doc' && /^\/templates\/[^/]+\/TEMPLATE\.md$/i.test(r.path))
  const ids = [...new Set(mains.map((m) => m.createdBy))]
  const makers = ids.length ? new Map((await getDb().select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))).map((u) => [u.id, u.name])) : new Map<string, string>()
  return mains
    .map((m) => ({ row: m, template: buildTemplate(actor, m, rows, makers) }))
    .sort((a, b) => a.template.space.localeCompare(b.template.space) || a.template.title.localeCompare(b.template.title))
}

export async function listTemplates(actor: Actor) {
  return (await loadTemplates(actor)).map(({ template: t }) => ({
    name: t.name,
    title: t.title,
    icon: t.icon,
    description: t.description,
    maker: t.maker,
    space: t.space,
    path: t.path,
    bots: t.bots.map((b) => ({ name: b.name, icon: b.icon })),
    flows: t.flows.map((f) => f.name),
    needs: t.needs,
    updatedAt: t.updatedAt,
  }))
}

/** Find a template by name, title or folder path. Your own wins over the team's with the same name. */
async function findTemplate(actor: Actor, ref: string) {
  const all = await loadTemplates(actor)
  const key = ref.trim().replace(/\/TEMPLATE\.md$/i, '').replace(/\/+$/, '')
  const k = key.toLowerCase()
  const hit = key.startsWith('/')
    ? all.find((x) => x.template.path.toLowerCase() === k)
    : (all.find((x) => x.template.space === 'me' && x.template.name.toLowerCase() === k) ??
      all.find((x) => x.template.name.toLowerCase() === k) ??
      all.find((x) => x.template.title.toLowerCase() === k))
  if (!hit) throw notFound(`Template "${ref}"`, 'Use templates_list to see the templates you can use.')
  return hit
}

/** The values a template's placeholders take for this person. */
function valuesFor(actor: Actor, t: Template, given: Record<string, string> = {}) {
  const unknown = Object.keys(given).filter((k) => !(k in t.fields))
  if (unknown.length) {
    const declared = Object.keys(t.fields)
    throw invalid(`${t.title} has no ${unknown.map((k) => `"${k}"`).join(', ')} field.`, declared.length ? `Its fields: ${declared.join(', ')}.` : 'It has no fields to fill in.')
  }
  const values: Record<string, string> = {
    name: actor.userName,
    first_name: actor.userName.trim().split(/\s+/)[0] ?? actor.userName,
    email: actor.email,
  }
  for (const [k, v] of Object.entries(given)) if (v?.trim()) values[k] = v.trim()
  return values
}

// ------------------------------------------------------------------ setup status

type Check = { state: 'ready' | 'todo'; detail?: string }

/**
 * Where this person is with setting a template up: which of its bots and flows they have,
 * and whether the connections, secrets, docs and triggers those need are in place.
 */
async function setupStatus(actor: Actor, t: Template, values: Record<string, string>) {
  const db = getDb()
  const [conns, secrets, myBots, myFlows] = await Promise.all([
    listConnections(actor),
    listSecrets(actor),
    db.select({ id: bot.id, name: bot.name, instructions: bot.instructions }).from(bot).where(and(eq(bot.workspaceId, actor.workspaceId), eq(bot.ownerId, actor.userId))),
    db
      .select({ id: node.id, path: node.path, content: node.content })
      .from(node)
      .where(and(eq(node.workspaceId, actor.workspaceId), eq(node.spaceId, actor.userId), isNull(node.deletedAt), like(node.path, '/flows/%'))),
  ])
  const fieldNames = Object.keys(t.fields)
  const leftIn = (text: string) => placeholdersIn(text).filter((k) => fieldNames.includes(k))

  const bots = t.bots.map((b) => {
    const name = fill(b.name, values)
    const mine = myBots.find((x) => x.name.toLowerCase() === name.toLowerCase())
    return { name, icon: b.icon, id: mine?.id ?? null, have: !!mine, unfilled: mine ? leftIn(mine.instructions) : [] }
  })
  const flowIds = new Map<string, string>()
  const flows = t.flows.map((f) => {
    const files = myFlows.filter((n) => n.path.startsWith(`/flows/${f.name}/`))
    const have = files.some((n) => /\/FLOW\.md$/i.test(n.path))
    return { name: f.name, path: `/me/flows/${f.name}`, have, unfilled: [...new Set(files.flatMap((n) => leftIn(n.content ?? '')))] }
  })
  if (t.triggers.length) {
    const { visibleFlows } = await import('./flows')
    for (const f of await visibleFlows(actor)) if (f.spaceId === actor.userId) flowIds.set(f.name, f.id)
  }
  const triggerRows = flowIds.size
    ? await db.select({ flowId: flowTrigger.flowId, kind: flowTrigger.kind, runAs: flowTrigger.runAsUserId, enabled: flowTrigger.enabled }).from(flowTrigger).where(inArray(flowTrigger.flowId, [...flowIds.values()]))
    : []

  const connections = t.needs.connections.map((slug) => {
    const c = conns.find((x) => x.slug === slug)
    const check: Check = !c
      ? { state: 'todo', detail: 'Not connected to this workspace. An admin or member has to add it in Connections.' }
      : !c.usable
        ? { state: 'todo', detail: 'You don\'t have access to it. Ask an admin.' }
        : c.status !== 'active'
          ? { state: 'todo', detail: c.credentialMode === 'per_user' ? 'Sign in with your own account in Connections.' : `Its status is ${c.status}.` }
          : { state: 'ready', detail: c.credentialMode === 'per_user' ? 'Signed in with your account.' : 'Ready.' }
    return { slug, name: c?.name ?? slug, ...check }
  })
  const secretChecks = Object.entries(t.needs.secrets).map(([name, about]) => {
    const s = secrets.find((x) => x.name === name && x.canUse)
    return { name, about: fill(about, values), state: s ? ('ready' as const) : ('todo' as const), detail: s ? (s.scope === 'me' ? 'You added it.' : 'The team has one you can use.') : 'Add it in Settings, under Secrets, as a personal secret.' }
  })
  const docs = await Promise.all(
    Object.entries(t.needs.docs).map(async ([raw, about]) => {
      const path = fill(raw, values)
      let have = false
      try {
        const p = parsePath(actor, path)
        const [n] = await db.select({ id: node.id }).from(node).where(and(eq(node.workspaceId, actor.workspaceId), eq(node.spaceId, p.spaceId), eq(node.path, p.path), isNull(node.deletedAt)))
        have = !!n
      } catch {
        have = false
      }
      return { path, about: fill(about, values), state: have ? ('ready' as const) : ('todo' as const) }
    }),
  )
  const triggers = t.triggers.map((tr) => {
    const id = flowIds.get(tr.flow)
    const have = !!id && triggerRows.some((r) => r.flowId === id && r.kind === tr.kind && r.runAs === actor.userId && r.enabled)
    return { flow: tr.flow, kind: tr.kind, cron: tr.cron ?? null, state: have ? ('ready' as const) : ('todo' as const) }
  })
  const unfilled = [...new Set([...bots.flatMap((b) => b.unfilled), ...flows.flatMap((f) => f.unfilled)])]
  const ready =
    bots.every((b) => b.have && !b.unfilled.length) &&
    flows.every((f) => f.have && !f.unfilled.length) &&
    [...connections, ...secretChecks, ...docs, ...triggers].every((c) => c.state === 'ready')
  return { started: bots.some((b) => b.have) || flows.some((f) => f.have), ready, bots, flows, connections, secrets: secretChecks, docs, triggers, unfilled }
}

export async function getTemplate(actor: Actor, ref: string) {
  const { row, template: t } = await findTemplate(actor, ref)
  recordRead(actor, row)
  const values = valuesFor(actor, t)
  return {
    ...t,
    fields: Object.entries(t.fields).map(([name, about]) => ({ name, about })),
    bots: t.bots.map((b) => ({ ...b, name: fill(b.name, values) })),
    flows: t.flows.map((f) => ({ name: f.name, description: f.description, codeFile: f.codeFile })),
    /** Where you are with setting it up. */
    setup: await setupStatus(actor, t, values),
    canUse: actor.role !== 'viewer',
    /** A template in your own space, ready to share with the team. */
    canShare: t.space === 'me' && actor.role !== 'viewer',
    mine: row.createdBy === actor.userId,
    you: actor.userName,
    ask: `Set me up with the "${t.title}" template in Brainspace.`,
  }
}

// ------------------------------------------------------------------ making a template from bots

export type CreateTemplateInput = {
  /** Bots to include, by name or id. */
  bots: string[]
  /** Flows to include, by name. Default: the flows that run those bots. */
  flows?: string[]
  name?: string
  title?: string
  description?: string
  icon?: string | null
  space?: 'me' | 'team'
}

export async function createTemplate(actor: Actor, input: CreateTemplateInput) {
  requireRole(actor, 'member', 'make templates')
  if (!input.bots?.length) throw invalid('Name at least one bot to make a template from.')
  if (input.bots.length > MAX_TEMPLATE_BOTS) throw invalid(`A template holds up to ${MAX_TEMPLATE_BOTS} bots.`)
  const files = await import('./files')
  const flowsSvc = await import('./flows')
  const bots: Awaited<ReturnType<typeof findBot>>[] = []
  for (const ref of input.bots) {
    const b = await findBot(actor, ref)
    if (!bots.some((x) => x.id === b.id)) bots.push(b)
  }
  const [ownerRow] = await getDb().select({ name: user.name, email: user.email }).from(user).where(eq(user.id, bots[0]!.ownerId))
  const gen = generalizer(ownerRow ?? { name: actor.userName, email: actor.email })

  // The flows that run these bots come along unless the caller picks.
  let flowNames = input.flows
  if (!flowNames) {
    const visible = await flowsSvc.visibleFlows(actor)
    const running = await Promise.all(bots.map((b) => flowsSvc.flowsRunningBot(actor, b, visible)))
    flowNames = [...new Set(running.flat().map((f) => f.name))]
  }
  if (flowNames.length > MAX_TEMPLATE_FLOWS) throw invalid(`A template holds up to ${MAX_TEMPLATE_FLOWS} flows.`)
  const flows = []
  for (const ref of flowNames) {
    const f = await flowsSvc.findFlow(actor, ref)
    const ids = [f.manifestNodeId, f.codeNodeId].filter((x): x is string => !!x)
    const rows = await getDb().select({ id: node.id, name: node.name, content: node.content }).from(node).where(inArray(node.id, ids))
    const manifest = rows.find((r) => r.id === f.manifestNodeId)?.content ?? ''
    const code = rows.find((r) => r.id === f.codeNodeId)
    const triggers = (await flowsSvc.listTriggers(actor, f.id)).filter((t) => t.kind !== 'manual')
    flows.push({ row: f, manifest, code: code?.content ?? '', codeFile: code?.name ?? 'flow.ts', triggers })
  }

  const first = bots[0]!
  const title = cleanTitle(input.title) ?? gen.run(first.name)
  const name = slugify(input.name ?? title) || 'bot-template'
  const space = input.space ?? 'me'
  const folder = `/${space}/templates/${name}`
  if ((await files.resolve(actor, folder)).node) {
    throw new AppError('conflict', `${folder} already exists.`, { hint: 'Pick another name, or change that template\'s files directly.' })
  }

  // What each person needs: the connections it calls, the secrets its flows use, and the personal docs it reads.
  const usable = await listConnections(actor)
  const allText = [...bots.map((b) => b.instructions), ...flows.flatMap((f) => [f.manifest, f.code])].join('\n')
  const connections = new Set<string>()
  for (const b of bots) {
    if (b.connections) b.connections.forEach((c) => connections.add(c))
    // A bot that may use every connection: count the ones its instructions name.
    else for (const c of usable) if (new RegExp(`\\b(${escape(c.slug)}|${escape(c.name)})\\b`, 'i').test(b.instructions)) connections.add(c.slug)
  }
  for (const f of flows) for (const c of f.row.manifest?.uses.connections ?? []) connections.add(c)
  const mySecrets = await listSecrets(actor)
  const secrets: Record<string, string> = {}
  for (const f of flows) {
    for (const s of f.row.manifest?.uses.secrets ?? []) secrets[s] = gen.run(mySecrets.find((x) => x.name === s)?.description ?? 'Add your own.')
  }
  const docs: Record<string, string> = {}
  for (const p of personalDocs(allText)) {
    let about = 'Write your own.'
    try {
      const n = (await files.resolve(actor, p)).node
      if (n?.description) about = gen.run(n.description)
    } catch {
      // Not there for the maker either; still list it.
    }
    docs[p] = about
  }
  const triggers: TemplateTrigger[] = flows.flatMap((f) =>
    f.triggers.map((t) => ({
      flow: f.row.name,
      kind: t.kind as 'schedule' | 'webhook',
      name: t.name ? gen.run(t.name) : undefined,
      cron: t.cron ?? undefined,
      timezone: t.timezone ?? undefined,
      inputs: t.inputs && Object.keys(t.inputs).length ? (JSON.parse(gen.run(JSON.stringify(t.inputs))) as Record<string, Json>) : undefined,
    })),
  )

  const description = input.description?.trim() || gen.run(first.description ?? '') || `Set up your own ${title}.`
  const written: string[] = []
  const save = async (path: string, content: string) => {
    await files.write(actor, path, content, { createOnly: true, message: `Template ${name}` })
    written.push(path)
  }
  for (const b of bots) {
    const doc = writeDoc(
      {
        name: gen.run(b.name),
        icon: b.icon,
        description: b.description ? gen.run(b.description) : null,
        model: b.model,
        cron: b.cron,
        timezone: b.cron ? b.timezone : null,
        tools: b.tools,
        connections: b.connections,
        paths: b.paths,
        webhook: b.webhookTokenHash ? true : null,
        slack: b.slackEnabled ? true : null,
      },
      gen.run(b.instructions),
    )
    await save(`${folder}/bots/${slugify(gen.run(b.name)) || 'bot'}.md`, doc)
  }
  for (const f of flows) {
    await save(`${folder}/flows/${f.row.name}/FLOW.md`, gen.run(f.manifest))
    await save(`${folder}/flows/${f.row.name}/${f.codeFile}`, gen.run(f.code))
  }
  const guide = [
    `# ${title}`,
    '',
    description,
    '',
    '## Setting it up',
    '',
    'Using the template makes your own private copy of the bot' + (flows.length ? ' and its flows' : '') + ', running with your logins and secrets. Then work through the checklist on the template page, or ask your agent to.',
  ].join('\n')
  await save(
    `${folder}/TEMPLATE.md`,
    writeDoc(
      {
        name,
        title: title !== humanize(name) ? title : null,
        icon: input.icon !== undefined ? cleanIcon(input.icon) : first.icon,
        description,
        fields: {},
        needs: { connections: [...connections].sort(), secrets, docs },
        triggers: triggers.length ? triggers : null,
      },
      guide,
    ),
  )
  await logActivity(actor, 'template_create', { spaceId: space === 'team' ? TEAM : actor.userId, path: `/templates/${name}`, details: { template: title, bots: bots.map((b) => b.name) } })

  const left = placeholdersIn(allText)
  return {
    template: name,
    title,
    path: folder,
    files: written,
    replaced: [...gen.replaced],
    needs: { connections: [...connections].sort(), secrets, docs },
    triggers,
    next: [
      gen.replaced.size
        ? `Swapped ${ownerRow?.name ?? 'the owner'}'s name and email for ${[...gen.replaced].join(', ')}, which become whoever uses the template.`
        : null,
      'Read the bot and flow files and look for anything else that belongs to one person: nicknames, Slack user or channel ids, links, customer names. Replace each with a {{field}} and declare it under fields in TEMPLATE.md with what it is and where to find it, e.g. slack_user_id: "Your Slack member ID (profile → ⋯ → Copy member ID)".',
      'Check needs in TEMPLATE.md: the connections, secrets (with where to get each) and personal docs (with what to write in them).',
      'Write the setup guide in the body of TEMPLATE.md for whatever the checklist can\'t cover, like creating a Slack app or an API token.',
      flows.some((f) => (f.row.manifest?.uses.bots ?? []).some((x) => !bots.some((b) => b.name.toLowerCase() === x.toLowerCase())))
        ? 'One of the flows runs a bot that isn\'t in the template. Take that part out of the flow copy, or add the bot.'
        : null,
      space === 'me' ? `It's in your private space. When it's ready, share it with promote (from ${folder} to /team/templates/${name}).` : null,
      left.length ? `The files already had placeholders: ${left.join(', ')}.` : null,
    ].filter(Boolean),
  }
}

// ------------------------------------------------------------------ using a template

export async function useTemplate(actor: Actor, ref: string, opts: { fields?: Record<string, string> } = {}) {
  requireRole(actor, 'member', 'set up templates')
  const { row, template: t } = await findTemplate(actor, ref)
  if (t.problems.length) throw invalid(`${t.title} has problems: ${t.problems.join(' ')}`, `Fix the files in ${t.path}.`)
  if (!t.bots.length && !t.flows.length) throw invalid(`${t.title} has no bots or flows yet.`, `Add them under ${t.path}/bots and ${t.path}/flows.`)
  const values = valuesFor(actor, t, opts.fields)
  const files = await import('./files')
  const flowsSvc = await import('./flows')
  const db = getDb()

  // Everything that would clash, before anything is made.
  const bots = t.bots.map((b) => fillDeep(b, values))
  const mine = await db.select({ name: bot.name }).from(bot).where(and(eq(bot.workspaceId, actor.workspaceId), eq(bot.ownerId, actor.userId)))
  const clashes = [
    ...bots.filter((b) => mine.some((m) => m.name.toLowerCase() === b.name.toLowerCase())).map((b) => `you already have a bot called "${b.name}"`),
  ]
  for (const f of t.flows) {
    if ((await files.resolve(actor, `/me/flows/${f.name}`)).node) clashes.push(`/me/flows/${f.name} already exists`)
  }
  if (clashes.length) {
    throw new AppError('conflict', `Can't set up ${t.title}: ${clashes.join('; ')}.`, {
      hint: 'It may be set up already (template_get shows how far). Otherwise rename or delete yours first.',
    })
  }

  const message = `From template ${t.name}`
  const madeFlows: { name: string; path: string; status: string; error?: string | null }[] = []
  for (const f of t.flows) {
    const folder = `/me/flows/${f.name}`
    await files.write(actor, `${folder}/FLOW.md`, fill(f.manifest, values), { createOnly: true, message })
    await files.write(actor, `${folder}/${f.codeFile}`, fill(f.code, values), { createOnly: true, message })
    const made = await flowsSvc.findFlow(actor, folder).catch(() => null)
    madeFlows.push({ name: f.name, path: folder, status: made?.status ?? 'invalid', error: made?.error })
  }

  const usable = (await listConnections(actor, { usableOnly: true })).map((c) => c.slug)
  const todo: string[] = []
  const webhooks: { for: string; url: string }[] = []
  const madeBots: { id: string; name: string }[] = []
  for (const b of bots) {
    const conns = b.connections ? b.connections.filter((c) => usable.includes(c)) : null
    const missing = b.connections ? b.connections.filter((c) => !usable.includes(c)) : []
    if (missing.length) todo.push(`${b.name} is set to use ${missing.join(', ')}, which you can't use yet. Once you can, add ${missing.length > 1 ? 'them' : 'it'} with bot_update.`)
    const input: BotInput = {
      name: b.name,
      icon: b.icon,
      description: b.description,
      instructions: b.instructions,
      visibility: 'private',
      model: b.model,
      cron: b.cron,
      timezone: b.timezone ?? undefined,
      tools: b.tools,
      connections: conns,
      paths: b.paths,
      webhook: b.webhook,
    }
    const made = await createBot(actor, input)
    madeBots.push({ id: made.id, name: made.name })
    if (made.webhookUrl) webhooks.push({ for: made.name, url: made.webhookUrl })
    if (b.slack) {
      try {
        const r = await updateBot(actor, made.id, { slack: true })
        if (r.slackNote) todo.push(r.slackNote)
      } catch (err) {
        todo.push(`${made.name} didn't get a Slack handle: ${(err as Error).message} Turn it on from the bot's page when that's sorted.`)
      }
    }
  }

  // Triggers need the flow's secrets, so they often can't be set until those are added.
  for (const tr of t.triggers) {
    try {
      const r = await flowsSvc.setTrigger(actor, {
        flow: `/me/flows/${tr.flow}`,
        kind: tr.kind,
        name: tr.name ? fill(tr.name, values) : undefined,
        cron: tr.cron,
        timezone: tr.timezone,
        inputs: tr.inputs ? fillDeep(tr.inputs, values) : undefined,
      })
      if (r.webhookUrl && tr.kind === 'webhook') webhooks.push({ for: tr.flow, url: r.webhookUrl })
    } catch (err) {
      todo.push(`Add the ${tr.kind === 'schedule' ? `schedule (${tr.cron})` : 'webhook'} trigger to ${tr.flow} with flow_trigger_set once its secrets are in: ${(err as Error).message}`)
    }
  }

  await logActivity(actor, 'template_use', {
    spaceId: row.spaceId,
    path: row.path.replace(/\/TEMPLATE\.md$/i, ''),
    details: { template: t.title, bots: madeBots.map((b) => b.name), flows: madeFlows.map((f) => f.name) },
  })
  const setup = await setupStatus(actor, t, values)
  for (const c of setup.connections) if (c.state === 'todo') todo.push(`${c.name}: ${c.detail}`)
  for (const s of setup.secrets) if (s.state === 'todo') todo.push(`Add the personal secret ${s.name}: ${s.about}`)
  for (const d of setup.docs) if (d.state === 'todo') todo.push(`Write ${d.path}: ${d.about}`)
  const unfilled = Object.keys(t.fields).filter((k) => !(k in values))
  if (unfilled.length) {
    todo.push(`Fill in ${unfilled.map((k) => `{{${k}}}`).join(', ')} where ${unfilled.length > 1 ? 'they appear' : 'it appears'} in your new bot and flows (${unfilled.map((k) => `${k}: ${t.fields[k]}`).join('; ')}).`)
  }
  for (const f of madeFlows) if (f.status !== 'ok' && f.error && !unfilled.length) todo.push(`${f.name} has a problem: ${f.error}`)

  return {
    template: t.title,
    bots: madeBots,
    flows: madeFlows,
    webhooks: webhooks.length ? webhooks : undefined,
    webhookNote: webhooks.length ? 'Each URL is shown only this once. Put it where the sender needs it (for Slack, the app\'s Event Subscriptions or Interactivity URL).' : undefined,
    todo,
    guide: fill(t.guide, values),
    next: todo.length
      ? 'Go through todo with the user, one item at a time, following the guide. template_get shows what is still left. Then run the bot once with bot_run to check it.'
      : 'Everything is in place. Run the bot once with bot_run to check it.',
  }
}
