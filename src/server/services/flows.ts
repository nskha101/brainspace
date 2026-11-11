import { and, desc, eq, inArray, isNull, like, lte, sql } from 'drizzle-orm'
import { Cron } from 'croner'
import { wrapWorkflowBinding } from '@cloudflare/dynamic-workflows'
import type { Actor } from '../actor'
import { TEAM, atLeast, canWriteSpace, requireRole } from '../actor'
import { hmacSign, hmacVerify, newId, randomToken, sha256Hex } from '../crypto'
import {
  flow,
  flowRun,
  flowRunLog,
  flowRunStep,
  flowTrigger,
  getDb,
  member,
  node,
  nodeVersion,
  user,
  type FlowDestination,
  type FlowRunStatus,
  type FlowScope,
  type Json,
} from '../db'
import { appUrl, background, getEnv } from '../env'
import { AppError, forbidden, invalid, notFound } from '../errors'
import { compileFlow } from '../flows/compile'
import { DEFAULT_MODEL, describeScope, parseFlowDoc, scopeHash, scopeMissing, scopeWidened, validateInputs } from '../flows/manifest'
import { publishSystemChange } from '../live'
import { displayPath, inSubtree, parsePath } from '../paths'
import { logActivity } from './activity'
import { aiSettings } from './ai'
import { accessView, admitsStamp, canSee as canSeePath, canSeeTrashed, effectiveAudience, narrowAudience, under } from './access'
import { actorFor } from './workspaces'
import { listConnections } from './connections'
import { TEMPLATES } from '../flows/templates'
import { decryptRunSecrets, encryptRunSecrets, secretStatus } from './secrets'

export type FlowRow = typeof flow.$inferSelect
export type TriggerRow = typeof flowTrigger.$inferSelect
export type RunRow = typeof flowRun.$inferSelect

const MAX_ACTIVE_RUNS = 10
const MAX_RUNS_PER_MONTH = 2000
const MIN_SCHEDULE_MINUTES = 15
const CODE_FILES = ['flow.ts', 'flow.js']
/** A flow can run a flow that runs a flow, and no deeper. */
const MAX_FLOW_DEPTH = 3
/** Subflow outputs travel back through a Workflow step, which holds at most 1 MiB. */
const MAX_SUBFLOW_OUTPUT = 900_000
const ACTIVE_STATUSES: FlowRunStatus[] = ['queued', 'running', 'waiting']

// ------------------------------------------------------------------ discovery

/** Flows are folders at /flows/<name> in a space with a FLOW.md inside. */
async function flowFolders(workspaceId: string, spaceIds: string[]) {
  const rows = await getDb()
    .select()
    .from(node)
    .where(and(eq(node.workspaceId, workspaceId), inArray(node.spaceId, spaceIds), isNull(node.deletedAt), like(node.path, '/flows/%')))
  const folders = rows.filter((r) => r.kind === 'folder' && /^\/flows\/[^/]+$/.test(r.path))
  return folders
    .map((f) => {
      const inside = rows.filter((r) => r.spaceId === f.spaceId && r.parentId === f.id)
      const manifest = inside.find((r) => r.kind === 'doc' && r.name.toLowerCase() === 'flow.md')
      const code = CODE_FILES.map((n) => inside.find((r) => r.kind === 'doc' && r.name.toLowerCase() === n)).find(Boolean)
      return { folder: f, manifest, code }
    })
    .filter((f) => f.manifest)
}

type Folder = Awaited<ReturnType<typeof flowFolders>>[number]

/** Bring the flow index up to date with the space. Cheap when nothing changed. */
async function syncFolder(workspaceId: string, f: Folder, existing?: FlowRow): Promise<FlowRow> {
  const db = getDb()
  const unchanged =
    existing &&
    existing.status !== 'missing' &&
    existing.folderPath === f.folder.path &&
    existing.manifestNodeId === f.manifest!.id &&
    existing.manifestVersion === f.manifest!.version &&
    (existing.codeNodeId ?? null) === (f.code?.id ?? null) &&
    (existing.codeVersion ?? null) === (f.code?.version ?? null)
  if (unchanged) return existing

  const base = {
    workspaceId,
    spaceId: f.folder.spaceId,
    folderNodeId: f.folder.id,
    folderPath: f.folder.path,
    manifestNodeId: f.manifest!.id,
    manifestVersion: f.manifest!.version,
    codeNodeId: f.code?.id ?? null,
    codeVersion: f.code?.version ?? null,
    updatedAt: new Date(),
  }
  let fields: Partial<FlowRow>
  try {
    const { manifest } = parseFlowDoc(f.manifest!.content ?? '')
    checkScopePaths(f.folder.spaceId, manifest.uses)
    if (!f.code) throw new Error('Add flow.ts next to FLOW.md.')
    const compiled = compileFlow(f.code.content ?? '', f.code.name)
    checkFlowCalls(manifest.name, manifest.uses, compiled.calls)
    const codeHash = await sha256Hex(compiled.js)
    const key = `flows/compiled/${codeHash}.js`
    if (!(await getEnv().FILES.head(key))) {
      await getEnv().FILES.put(key, compiled.js, { httpMetadata: { contentType: 'text/javascript' } })
    }
    fields = {
      name: manifest.name,
      description: manifest.description,
      manifest,
      codeHash,
      diagram: compiled.diagram,
      scopeHash: await scopeHash(manifest.uses),
      status: 'ok',
      error: null,
    }
  } catch (err) {
    fields = {
      name: existing?.name ?? f.folder.name,
      description: existing?.description ?? '',
      status: 'invalid',
      error: String((err as Error).message ?? err).slice(0, 2000),
    }
  }
  if (existing) {
    const [row] = await db
      .update(flow)
      .set({ ...base, ...fields })
      .where(eq(flow.id, existing.id))
      .returning()
    return row!
  }
  const [row] = await db
    .insert(flow)
    .values({ id: newId('fl'), ...base, name: fields.name ?? f.folder.name, status: fields.status ?? 'invalid', ...fields })
    .onConflictDoUpdate({ target: flow.folderNodeId, set: { ...base, ...fields } })
    .returning()
  return row!
}

/** Every flow the code runs by name must be listed under uses.flows. */
function checkFlowCalls(name: string, uses: FlowScope, calls: string[]) {
  const declared = uses.flows ?? []
  if (declared.includes(name)) throw new Error(`uses.flows lists ${name} itself. A flow can't run itself.`)
  const missing = calls.filter((c) => !declared.includes(c))
  if (missing.length) {
    throw new Error(`flow.ts runs ${missing.join(', ')} with flows.run(). Add ${missing.length > 1 ? 'them' : 'it'} under uses.flows in FLOW.md.`)
  }
}

/** Team flows may only touch /team; private flows may touch their owner's /me and /team. */
function checkScopePaths(spaceId: string, uses: FlowScope) {
  for (const p of [...uses.read, ...uses.write]) {
    if (!/^\/(team|me)(\/|$)/.test(p)) throw new Error(`uses path "${p}" must start with /team or /me.`)
    if (spaceId === TEAM && p.startsWith('/me')) {
      throw new Error(`Team flows can't use personal spaces, but uses lists "${p}". Use a /team path, or keep the flow in /me/flows.`)
    }
  }
}

/** Every flow the actor can see, synced with the spaces. */
export async function syncFlows(actor: Pick<Actor, 'workspaceId' | 'userId'>) {
  const spaces = [TEAM, actor.userId]
  const [folders, rows] = await Promise.all([
    flowFolders(actor.workspaceId, spaces),
    getDb().select().from(flow).where(and(eq(flow.workspaceId, actor.workspaceId), inArray(flow.spaceId, spaces))),
  ])
  const byFolder = new Map(rows.map((r) => [r.folderNodeId, r]))
  const out: FlowRow[] = []
  for (const f of folders) out.push(await syncFolder(actor.workspaceId, f, byFolder.get(f.folder.id)))
  const live = new Set(folders.map((f) => f.folder.id))
  for (const r of rows) {
    if (!live.has(r.folderNodeId) && r.status !== 'missing') await markMissing(r)
  }
  return out
}

async function markMissing(r: FlowRow) {
  await getDb().update(flow).set({ status: 'missing', error: 'The flow folder was deleted or its FLOW.md is gone.' }).where(eq(flow.id, r.id))
  await getDb()
    .update(flowTrigger)
    .set({ enabled: false, pausedReason: 'The flow was deleted.' })
    .where(eq(flowTrigger.flowId, r.id))
}

/** Re-read one flow's files. Used before every run so a run always uses the latest saved code. */
export async function refreshFlow(r: FlowRow): Promise<FlowRow> {
  const folders = await flowFolders(r.workspaceId, [r.spaceId])
  const f = folders.find((x) => x.folder.id === r.folderNodeId)
  if (!f) {
    if (r.status !== 'missing') await markMissing(r)
    return { ...r, status: 'missing' }
  }
  return syncFolder(r.workspaceId, f, r)
}

type FolderNode = Pick<typeof node.$inferSelect, 'spaceId' | 'path' | 'deletedAt' | 'trashAccess'> & {
  /** For a trashed folder: the stamps of everything trashed with it. */
  innerStamps: (string[] | null)[]
}

/** Where each flow's folder is now: live, in the trash (with what went with it), or gone. */
async function folderNodes(flows: Pick<FlowRow, 'folderNodeId'>[]) {
  const ids = [...new Set(flows.map((f) => f.folderNodeId))]
  const out = new Map<string, FolderNode>()
  for (let i = 0; i < ids.length; i += 90) {
    const rows = await getDb()
      .select({ id: node.id, workspaceId: node.workspaceId, spaceId: node.spaceId, path: node.path, deletedAt: node.deletedAt, trashAccess: node.trashAccess })
      .from(node)
      .where(inArray(node.id, ids.slice(i, i + 90)))
    for (const r of rows) {
      const inner = r.deletedAt
        ? await getDb()
            .select({ trashAccess: node.trashAccess })
            .from(node)
            .where(
              and(
                eq(node.workspaceId, r.workspaceId),
                eq(node.spaceId, r.spaceId),
                eq(node.deletedAt, r.deletedAt),
                inSubtree(node.path, r.path),
              ),
            )
        : []
      out.set(r.id, { ...r, innerStamps: inner.map((x) => x.trashAccess) })
    }
  }
  return out
}

/**
 * Which of these flows the actor may see: their own and team flows whose folder,
 * wherever it is now (moved, trashed), they can see, along with every file in it.
 * A restricted flow.ts or FLOW.md hides the whole flow.
 */
async function visibleIds(actor: Actor, flows: FlowRow[]) {
  const view = await accessView(actor)
  const nodes = await folderNodes(flows)
  const out = new Set<string>()
  for (const f of flows) {
    // A folder that's gone for good takes its flow, runs included, with it.
    const n = nodes.get(f.folderNodeId)
    if (!n) continue
    if (n.spaceId !== TEAM && n.spaceId !== actor.userId) continue
    if (n.deletedAt) {
      if (!canSeeTrashed(view, n) || !n.innerStamps.every((st) => admitsStamp(view, st))) continue
    } else if (!canSeePath(view, n.spaceId, n.path) || (n.spaceId === TEAM && view.blocked.some((r) => under(r.path, n.path)))) {
      continue
    }
    out.add(f.id)
  }
  return out
}

async function canSee(actor: Actor, f: FlowRow) {
  return (await visibleIds(actor, [f])).has(f.id)
}

async function visibleFlows(actor: Actor) {
  const flows = await syncFlows(actor)
  const ok = await visibleIds(actor, flows)
  return flows.filter((f) => ok.has(f.id))
}

/**
 * Who may see activity a flow causes: everyone who can see its folder and every
 * restricted file in it. Null means the activity's path decides on its own.
 */
export async function flowAudience(actor: Actor, f: Pick<FlowRow, 'folderNodeId' | 'spaceId' | 'folderPath'>) {
  const n = (await folderNodes([f])).get(f.folderNodeId)
  const spaceId = n?.spaceId ?? f.spaceId
  const path = n?.path ?? f.folderPath
  if (spaceId !== TEAM) return [spaceId]
  const view = await accessView(actor)
  let aud = effectiveAudience(view, path)
  if (n?.deletedAt) for (const st of [n.trashAccess, ...n.innerStamps]) aud = narrowAudience(aud, st)
  for (const r of view.all.filter((x) => under(x.path, path))) aud = narrowAudience(aud, effectiveAudience(view, r.path))
  return aud
}

/** Find a flow by id, name or path (/team/flows/x). Private flows win over team flows with the same name. */
export async function findFlow(actor: Actor, ref: string): Promise<FlowRow> {
  const flows = await visibleFlows(actor)
  const key = ref.trim()
  let hit: FlowRow | undefined
  if (key.startsWith('fl_')) hit = flows.find((f) => f.id === key)
  else if (key.startsWith('/')) {
    const p = parsePath(actor, key.replace(/\/(FLOW\.md|flow\.[tj]s)$/i, ''))
    hit = flows.find((f) => f.spaceId === p.spaceId && f.folderPath.toLowerCase() === p.path.toLowerCase())
  } else {
    const k = key.toLowerCase()
    hit =
      flows.find((f) => f.spaceId !== TEAM && f.name.toLowerCase() === k) ??
      flows.find((f) => f.name.toLowerCase() === k) ??
      flows.find((f) => f.folderPath.toLowerCase() === `/flows/${k}`)
  }
  if (!hit || !(await canSee(actor, hit))) throw notFound(`Flow "${ref}"`, 'Use flows_list to see the flows you can run.')
  return hit
}

function flowPath(actor: Actor, r: FlowRow) {
  return displayPath(actor, r.spaceId, r.folderPath)
}

// ------------------------------------------------------------------ read APIs

export async function listFlows(actor: Actor) {
  const flows = (await visibleFlows(actor)).filter((f) => f.status !== 'missing')
  if (!flows.length) return []
  const ids = flows.map((f) => f.id)
  const db = getDb()
  const [triggers, lastRuns, waiting] = await Promise.all([
    db.select().from(flowTrigger).where(inArray(flowTrigger.flowId, ids)),
    db
      .select({ flowId: flowRun.flowId, id: flowRun.id, status: flowRun.status, createdAt: flowRun.createdAt, mode: flowRun.mode })
      .from(flowRun)
      .where(and(inArray(flowRun.flowId, ids), sql`${flowRun.createdAt} = (select max(r2.created_at) from flow_run r2 where r2.flow_id = ${flowRun.flowId})`)),
    db.select({ flowId: flowRun.flowId, id: flowRun.id }).from(flowRun).where(and(inArray(flowRun.flowId, ids), eq(flowRun.status, 'waiting'))),
  ])
  return flows
    .map((f) => {
      const ts = triggers.filter((t) => t.flowId === f.id)
      const next = ts.filter((t) => t.enabled && t.nextRunAt).map((t) => t.nextRunAt!.getTime())
      const last = lastRuns.find((r) => r.flowId === f.id)
      return {
        id: f.id,
        name: f.name,
        description: f.description,
        path: flowPath(actor, f),
        space: (f.spaceId === TEAM ? 'team' : 'me') as 'team' | 'me',
        status: f.status,
        error: f.error,
        inputs: f.manifest?.inputs ?? {},
        triggers: ts.length,
        schedules: ts.filter((t) => t.kind === 'schedule' && t.enabled).length,
        nextRunAt: next.length ? Math.min(...next) : null,
        lastRun: last ? { id: last.id, status: last.status, at: last.createdAt.getTime(), test: last.mode === 'test' } : null,
        waitingApprovals: waiting.filter((w) => w.flowId === f.id).length,
        updatedAt: f.updatedAt.getTime(),
      }
    })
    .sort((a, b) => a.space.localeCompare(b.space) || a.name.localeCompare(b.name))
}

export async function getFlow(actor: Actor, ref: string) {
  const f = await findFlow(actor, ref)
  const db = getDb()
  const [manifestDoc, codeDoc, triggers, runs] = await Promise.all([
    f.manifestNodeId ? db.select({ content: node.content }).from(node).where(eq(node.id, f.manifestNodeId)) : [],
    f.codeNodeId ? db.select({ content: node.content, name: node.name }).from(node).where(eq(node.id, f.codeNodeId)) : [],
    db.select().from(flowTrigger).where(eq(flowTrigger.flowId, f.id)).orderBy(flowTrigger.createdAt),
    db.select().from(flowRun).where(eq(flowRun.flowId, f.id)).orderBy(desc(flowRun.createdAt)).limit(20),
  ])
  let body = ''
  try {
    body = parseFlowDoc(manifestDoc[0]?.content ?? '').body
  } catch {
    body = manifestDoc[0]?.content ?? ''
  }
  const people = await names([...triggers.map((t) => t.runAsUserId), ...runs.map((r) => r.startedBy)])
  const parents = await parentFlows(runs)
  const ai = f.manifest?.uses.ai ? await aiSettings(actor.workspaceId) : null
  const secrets = await secretStatus(actor.workspaceId, actor.userId, f.manifest?.uses.secrets ?? [])
  return {
    id: f.id,
    name: f.name,
    description: f.description,
    path: flowPath(actor, f),
    space: (f.spaceId === TEAM ? 'team' : 'me') as 'team' | 'me',
    status: f.status,
    error: f.error,
    manifest: f.manifest,
    scope: f.manifest ? describeScope(f.manifest.uses) : [],
    model: f.manifest?.uses.ai ? (f.manifest.model ?? ai?.model ?? DEFAULT_MODEL) : null,
    aiReady: ai ? !!ai.key : null,
    secrets,
    body,
    code: codeDoc[0]?.content ?? null,
    codeFile: codeDoc[0]?.name ?? null,
    codeVersion: f.codeVersion,
    manifestVersion: f.manifestVersion,
    diagram: f.diagram ?? [],
    triggers: triggers.map((t) => triggerInfo(actor, f, t, people)),
    runs: runs.map((r) => runSummary(r, people, parents)),
    canRun: actor.role !== 'viewer' && f.status === 'ok',
    canEdit: actor.role !== 'viewer',
  }
}

async function names(ids: string[]) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return new Map<string, string>()
  const rows = await getDb().select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, uniq))
  return new Map(rows.map((r) => [r.id, r.name]))
}

function triggerInfo(actor: Actor, f: FlowRow, t: TriggerRow, people: Map<string, string>) {
  const needsConsent = !!f.manifest && t.enabled && scopeWidened(t.approvedScope, f.manifest.uses)
  return {
    id: t.id,
    kind: t.kind,
    name: t.name,
    cron: t.cron,
    timezone: t.timezone,
    schedule: t.cron ? describeCron(t.cron, t.timezone ?? 'UTC') : null,
    nextRunAt: t.enabled ? (t.nextRunAt?.getTime() ?? null) : null,
    inputs: t.inputs,
    deliver: t.deliver,
    runAs: { id: t.runAsUserId, name: people.get(t.runAsUserId) ?? 'Unknown' },
    enabled: t.enabled,
    pausedReason: t.pausedReason ?? (needsConsent ? 'The flow now asks for more access. The owner has to approve it again.' : null),
    needsConsent,
    webhookUrl: t.kind === 'webhook' ? `${appUrl()}/api/flows/hook/…` : null,
    lastRunId: t.lastRunId,
    lastStatus: t.lastStatus,
    lastRunAt: t.lastRunAt?.getTime() ?? null,
    mine: t.runAsUserId === actor.userId,
  }
}

/** Runs started by another run show the calling flow's name as who started them. */
async function parentFlows(rows: Pick<RunRow, 'parentRunId'>[]) {
  const ids = [...new Set(rows.map((r) => r.parentRunId).filter((x): x is string => !!x))]
  if (!ids.length) return new Map<string, string>()
  const parents = await getDb().select({ id: flowRun.id, flowName: flowRun.flowName }).from(flowRun).where(inArray(flowRun.id, ids.slice(0, 90)))
  return new Map(parents.map((p) => [p.id, p.flowName]))
}

function startedByName(r: RunRow, people: Map<string, string>, parents?: Map<string, string>) {
  if (r.parentRunId) return parents?.get(r.parentRunId) ?? 'Another flow'
  return people.get(r.startedBy) ?? (r.startedBy === 'schedule' ? 'Schedule' : r.startedBy === 'webhook' ? 'Webhook' : 'Unknown')
}

function runSummary(r: RunRow, people: Map<string, string>, parents?: Map<string, string>) {
  return {
    id: r.id,
    flow: r.flowName,
    flowId: r.flowId,
    status: r.status,
    test: r.mode === 'test',
    triggerId: r.triggerId,
    parentRunId: r.parentRunId,
    startedBy: { id: r.startedBy, name: startedByName(r, people, parents) },
    runAs: { id: r.runAsUserId, name: people.get(r.runAsUserId) ?? 'Unknown' },
    createdAt: r.createdAt.getTime(),
    finishedAt: r.finishedAt?.getTime() ?? null,
    error: r.error,
    waitingFor: r.pendingApproval?.title ?? null,
  }
}

export async function listRuns(actor: Actor, opts: { flow?: string; status?: FlowRunStatus; limit?: number } = {}) {
  const visible = (await visibleFlows(actor)).map((f) => f.id)
  if (!visible.length) return []
  const ids = opts.flow ? [(await findFlow(actor, opts.flow)).id] : visible
  const conds = [eq(flowRun.workspaceId, actor.workspaceId), inArray(flowRun.flowId, ids)]
  if (opts.status) conds.push(eq(flowRun.status, opts.status))
  const rows = await getDb()
    .select()
    .from(flowRun)
    .where(and(...conds))
    .orderBy(desc(flowRun.createdAt))
    .limit(Math.min(opts.limit ?? 30, 200))
  const people = await names(rows.flatMap((r) => [r.startedBy, r.runAsUserId]))
  const parents = await parentFlows(rows)
  return rows.map((r) => runSummary(r, people, parents))
}

async function requireRun(actor: Actor, runId: string) {
  const [r] = await getDb()
    .select()
    .from(flowRun)
    .where(and(eq(flowRun.id, runId), eq(flowRun.workspaceId, actor.workspaceId)))
  if (!r) throw notFound(`Run "${runId}"`, 'Use flow_runs to list recent runs.')
  const [f] = await getDb().select().from(flow).where(eq(flow.id, r.flowId))
  if (!f || !(await canSee(actor, f))) throw notFound(`Run "${runId}"`)
  return { run: r, flow: f }
}

export async function getRun(actor: Actor, runId: string) {
  const { run: r, flow: f } = await requireRun(actor, runId)
  const db = getDb()
  const [steps, logs, kids, parentRows] = await Promise.all([
    db.select().from(flowRunStep).where(eq(flowRunStep.runId, r.id)).orderBy(flowRunStep.seq),
    db.select().from(flowRunLog).where(eq(flowRunLog.runId, r.id)).orderBy(flowRunLog.at).limit(500),
    db.select().from(flowRun).where(eq(flowRun.parentRunId, r.id)).orderBy(flowRun.createdAt).limit(100),
    r.parentRunId ? db.select().from(flowRun).where(eq(flowRun.id, r.parentRunId)) : Promise.resolve([] as RunRow[]),
  ])
  // Only show the runs around this one that the viewer could open.
  const related = [...kids, ...parentRows]
  const relatedFlows = related.length ? await db.select().from(flow).where(inArray(flow.id, [...new Set(related.map((x) => x.flowId))])) : []
  const seen = await visibleIds(actor, relatedFlows)
  const parentRun = parentRows.find((p) => seen.has(p.flowId))
  let outputs = r.outputs
  if (r.outputsKey) {
    const obj = await getEnv().FILES.get(r.outputsKey)
    if (obj) outputs = (await obj.json()) as Record<string, Json>
  }
  const people = await names([r.startedBy, r.runAsUserId])
  return {
    ...runSummary(r, people, new Map(parentRows.map((p) => [p.id, p.flowName]))),
    path: flowPath(actor, f),
    parent: parentRun ? { id: parentRun.id, flow: parentRun.flowName, status: parentRun.status } : null,
    subflows: kids
      .filter((k) => seen.has(k.flowId))
      .map((k) => ({ id: k.id, flow: k.flowName, status: k.status, error: k.error, createdAt: k.createdAt.getTime(), finishedAt: k.finishedAt?.getTime() ?? null })),
    inputs: r.inputs,
    deliver: r.deliver,
    outputs,
    deliveries: r.deliveries ?? [],
    captured: r.captured ?? [],
    pendingApproval: r.pendingApproval,
    codeVersion: r.codeVersion,
    model: r.model,
    ai: { calls: r.aiCalls, tokens: r.aiTokens },
    diagram: f.codeHash === r.codeHash ? (f.diagram ?? []) : await diagramFor(r),
    steps: steps.map((s) => ({
      name: s.name,
      kind: s.kind,
      status: s.status,
      attempt: s.attempt,
      startedAt: s.startedAt.getTime(),
      finishedAt: s.finishedAt?.getTime() ?? null,
      until: s.until?.getTime() ?? null,
      error: s.error,
      preview: s.preview,
    })),
    logs: logs.map((l) => ({ at: l.at.getTime(), level: l.level, message: l.message, data: l.data })),
    url: `${appUrl()}/app/flows/runs/${r.id}`,
  }
}

/** The diagram of the code version a run used, which may be older than the flow's current code. */
async function diagramFor(r: RunRow) {
  const obj = await getEnv().FILES.get(`flows/compiled/${r.codeHash}.js`)
  if (!obj) return []
  try {
    return compileFlow(await obj.text(), 'flow.js').diagram
  } catch {
    return []
  }
}

// ------------------------------------------------------------------ create

export async function createFlow(actor: Actor, opts: { name: string; template?: string; description?: string; space?: 'me' | 'team' }) {
  requireRole(actor, 'member', 'create flows')
  const name = opts.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')
  if (!name) throw invalid('Give the flow a name, like "competitor-digest".')
  const tpl = opts.template ? TEMPLATES.find((t) => t.id === opts.template) : TEMPLATES.find((t) => t.id === 'blank')
  if (!tpl) throw notFound(`Template "${opts.template}"`, `Templates: ${TEMPLATES.map((t) => t.id).join(', ')}`)
  const space = opts.space ?? 'me'
  const folder = `/${space}/flows/${name}`
  const files = await import('./files')
  let manifest = tpl.manifest.replace(/^name: .*$/m, `name: ${name}`)
  if (opts.description) manifest = manifest.replace(/^description: .*$/m, `description: ${JSON.stringify(opts.description)}`)
  await files.write(actor, `${folder}/FLOW.md`, manifest, { createOnly: true, message: `Create flow ${name}` })
  await files.write(actor, `${folder}/flow.ts`, tpl.code, { createOnly: true, message: `Create flow ${name}` })
  const f = await findFlow(actor, folder)
  return { flow: f.name, path: folder, status: f.status, error: f.error, files: [`${folder}/FLOW.md`, `${folder}/flow.ts`] }
}

export function listTemplates() {
  return TEMPLATES.filter((t) => t.id !== 'blank').map((t) => ({ id: t.id, title: t.title, description: t.description, needs: t.needs }))
}

/** After an agent writes a flow file, tell it whether the flow is valid. */
export async function flowStatusForPath(actor: Actor, fullPath: string) {
  const m = fullPath.match(/^(\/(?:team|me)\/flows\/[^/]+)\/(FLOW\.md|flow\.ts|flow\.js)$/i)
  if (!m) return undefined
  try {
    const f = await findFlow(actor, m[1]!)
    return { flow: f.name, status: f.status, error: f.error ?? undefined }
  } catch {
    return { status: 'incomplete', note: 'A flow needs both FLOW.md and flow.ts in its folder.' }
  }
}

// ------------------------------------------------------------------ runs

type StartOpts = {
  inputs?: Record<string, unknown>
  /** Secret values for this run only. */
  secrets?: Record<string, string>
  deliver?: FlowDestination[]
  test?: boolean
  trigger?: TriggerRow
  runId?: string
  startedBy: string
  /** The run that started this one with flows.run(). */
  parentRunId?: string
}

/** Start a run as `runAs`. Callers check who may start it. */
async function startRun(runAs: Actor, f: FlowRow, opts: StartOpts) {
  f = await refreshFlow(f)
  if (f.status !== 'ok' || !f.manifest || !f.codeHash) {
    throw new AppError('invalid', `Flow "${f.name}" can't run: ${f.error ?? f.status}`, { hint: 'Fix FLOW.md or flow.ts, then run it again.' })
  }
  if (runAs.role === 'viewer') throw forbidden('Read-only members can see flows but not run them.')
  if (f.spaceId !== TEAM && f.spaceId !== runAs.userId) throw forbidden('Private flows only run for their owner.')
  const { inputs, problems } = validateInputs(f.manifest, opts.inputs ?? {})
  if (problems.length) throw invalid(`Inputs: ${problems.join('; ')}.`, `This flow takes: ${Object.keys(f.manifest.inputs).join(', ') || 'no inputs'}.`)
  const deliver = opts.deliver ?? []
  await checkDestinations(runAs, f, deliver)
  const runSecrets = await checkSecrets(runAs, f, opts.secrets)

  const db = getDb()
  const [active] = await db
    .select({ n: sql<number>`count(*)` })
    .from(flowRun)
    .where(and(eq(flowRun.workspaceId, runAs.workspaceId), inArray(flowRun.status, ['queued', 'running'])))
  if ((active?.n ?? 0) >= MAX_ACTIVE_RUNS) {
    throw new AppError('conflict', `This workspace already has ${MAX_ACTIVE_RUNS} flow runs going.`, { hint: 'Wait for some to finish, or cancel stuck ones with flow_run_cancel.' })
  }
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  const [month] = await db
    .select({ n: sql<number>`count(*)` })
    .from(flowRun)
    .where(and(eq(flowRun.workspaceId, runAs.workspaceId), sql`${flowRun.createdAt} >= ${monthStart.getTime()}`))
  if ((month?.n ?? 0) >= MAX_RUNS_PER_MONTH) {
    throw new AppError('conflict', `This workspace reached its ${MAX_RUNS_PER_MONTH} flow runs for the month.`)
  }

  const ai = f.manifest.uses.ai ? await aiSettings(runAs.workspaceId) : null
  const id = opts.runId ?? `run_${newId()}`
  const scope = f.manifest.uses
  await db.insert(flowRun).values({
    id,
    workspaceId: runAs.workspaceId,
    flowId: f.id,
    triggerId: opts.trigger?.id ?? null,
    parentRunId: opts.parentRunId ?? null,
    mode: opts.test ? 'test' : 'live',
    flowName: f.name,
    codeHash: f.codeHash,
    codeVersion: f.codeVersion,
    manifestVersion: f.manifestVersion,
    scope,
    model: ai ? (f.manifest.model ?? ai.model) : null,
    runAsUserId: runAs.userId,
    startedBy: opts.startedBy,
    inputs: inputs as Record<string, Json>,
    deliver: deliver as unknown as FlowDestination[],
    status: 'queued',
    runSecrets,
  })
  const token = `${id}.${await hmacSign(`flowrun:${id}`)}`
  const binding = wrapWorkflowBinding(
    { workspaceId: runAs.workspaceId, flowId: f.id, runId: id },
    { bindingName: 'FLOWS' },
  )
  try {
    await binding.create({
      id,
      params: {
        inputs,
        token,
        test: !!opts.test,
        flow: f.name,
        trigger: opts.trigger ? { id: opts.trigger.id, name: opts.trigger.name, kind: opts.trigger.kind } : null,
        startedAt: Date.now(),
      },
    })
  } catch (err) {
    await db.update(flowRun).set({ status: 'failed', error: `Couldn't start: ${(err as Error).message}`, finishedAt: new Date() }).where(eq(flowRun.id, id))
    throw new AppError('upstream', `Couldn't start the run: ${(err as Error).message}`)
  }
  if (opts.trigger) {
    await db.update(flowTrigger).set({ lastRunId: id, lastStatus: 'queued', lastRunAt: new Date() }).where(eq(flowTrigger.id, opts.trigger.id))
  }
  if (!opts.test) {
    await logActivity(runAs, 'flow_run', {
      spaceId: f.spaceId,
      path: f.folderPath,
      details: { flow: f.name, run: id, trigger: opts.trigger?.name ?? null, ...(opts.parentRunId ? { parentRun: opts.parentRunId } : {}) },
      audience: await flowAudience(runAs, f),
    })
  }
  notify(f, 'flow_run_started')
  return { runId: id, status: 'queued' as const, url: `${appUrl()}/app/flows/runs/${id}` }
}

function notify(f: Pick<FlowRow, 'workspaceId' | 'spaceId' | 'folderPath'>, action: string) {
  publishSystemChange(f.workspaceId, { spaceId: f.spaceId, path: f.folderPath, action, scope: 'flows' })
}

/** Every secret the flow declares must be saved (team or personal) or passed for this run. */
async function checkSecrets(runAs: Actor, f: FlowRow, provided: Record<string, string> | undefined) {
  const names = f.manifest?.uses.secrets ?? []
  const extra = Object.keys(provided ?? {}).filter((k) => !names.includes(k))
  if (extra.length) throw invalid(`${f.name} doesn't use ${extra.join(', ')}.`, `It declares: ${names.join(', ') || 'no secrets'}.`)
  const status = await secretStatus(runAs.workspaceId, runAs.userId, names)
  const restricted = status.filter((s) => s.restrictedTo && !s.mine && provided?.[s.name] === undefined)
  if (restricted.length) {
    const r = restricted[0]!
    throw new AppError('forbidden', `${f.name} uses the team secret ${r.name}, and only ${r.restrictedTo} can use it.`, {
      hint: `Ask one of them to run it, or save your own ${r.name} with scope "me" so your runs use yours.`,
      data: { restrictedSecrets: restricted.map((s) => s.name) },
    })
  }
  const missing = status.filter((s) => !s.team && !s.mine && provided?.[s.name] === undefined).map((s) => s.name)
  if (missing.length) {
    throw new AppError('invalid', `${f.name} needs ${missing.join(', ')}, and ${missing.length > 1 ? "they aren't" : "it isn't"} saved.`, {
      hint: `Save ${missing.length > 1 ? 'them' : 'it'} in Settings → Secrets (${appUrl()}/app/settings#secrets) or with secret_set, or pass ${missing.length > 1 ? 'them' : 'it'} for this run with secrets: { ${missing.map((m) => `${m}: "..."`).join(', ')} }.`,
      data: { missingSecrets: missing },
    })
  }
  const clean = Object.fromEntries(Object.entries(provided ?? {}).filter(([, v]) => typeof v === 'string' && v.length > 0))
  return encryptRunSecrets(clean)
}

export async function runFlow(
  actor: Actor,
  ref: string,
  opts: { inputs?: Record<string, unknown>; deliver?: FlowDestination[]; test?: boolean; secrets?: Record<string, string> } = {},
) {
  requireRole(actor, 'member', 'run flows')
  const f = await findFlow(actor, ref)
  return startRun(actor, f, { ...opts, startedBy: actor.userId })
}

export async function cancelRun(actor: Actor, runId: string) {
  requireRole(actor, 'member', 'cancel flow runs')
  const { run: r, flow: f } = await requireRun(actor, runId)
  if (['succeeded', 'failed', 'cancelled'].includes(r.status)) return { runId, status: r.status }
  try {
    const inst = await getEnv().FLOWS.get(r.id)
    await inst.terminate()
  } catch {
    // Already gone; record the cancel anyway.
  }
  await finishRun(r.id, 'cancelled', `Cancelled by ${actor.userName}`)
  notify(f, 'flow_run_cancelled')
  return { runId, status: 'cancelled' as const }
}

export async function approveRun(actor: Actor, runId: string, opts: { approved: boolean; note?: string }) {
  requireRole(actor, 'member', 'approve flow runs')
  const { run: r, flow: f } = await requireRun(actor, runId)
  if (r.status !== 'waiting' || !r.pendingApproval) throw invalid('That run is not waiting for an approval.')
  const inst = await getEnv().FLOWS.get(r.id)
  await inst.sendEvent({
    type: `approval-${r.pendingApproval.key}`,
    payload: { approved: opts.approved, by: actor.userName, note: opts.note ?? null },
  })
  await getDb().update(flowRun).set({ status: 'running', pendingApproval: null }).where(eq(flowRun.id, r.id))
  await getDb()
    .insert(flowRunLog)
    .values({
      id: newId('flg'),
      runId: r.id,
      at: new Date(),
      level: 'info',
      message: `${opts.approved ? 'Approved' : 'Rejected'} by ${actor.userName}: ${r.pendingApproval.title}${opts.note ? ` (“${opts.note}”)` : ''}`,
      data: null,
      hash: newId('h'),
    })
  await logActivity(actor, opts.approved ? 'flow_approve' : 'flow_reject', {
    spaceId: f.spaceId,
    path: f.folderPath,
    details: { flow: f.name, run: r.id, title: r.pendingApproval.title, note: opts.note ?? null },
    audience: await flowAudience(actor, f),
  })
  notify(f, 'flow_run_approved')
  return { runId, approved: opts.approved }
}

export async function finishRun(runId: string, status: FlowRunStatus, error?: string | null) {
  const db = getDb()
  const [r] = await db
    .update(flowRun)
    .set({ status, error: error ?? null, finishedAt: new Date(), pendingApproval: null, runSecrets: null })
    .where(eq(flowRun.id, runId))
    .returning()
  await db
    .update(flowRunStep)
    .set({ status: status === 'succeeded' ? 'done' : 'failed', finishedAt: new Date() })
    .where(and(eq(flowRunStep.runId, runId), inArray(flowRunStep.status, ['sleeping', 'running'])))
  if (r?.triggerId) await db.update(flowTrigger).set({ lastStatus: status }).where(eq(flowTrigger.id, r.triggerId))
  if (r) {
    await cancelChildren(r.id, status === 'cancelled' ? 'The flow that started it was cancelled.' : 'The flow that started it finished first.')
    if (r.parentRunId) await tellParent(r)
    const [f] = await db.select().from(flow).where(eq(flow.id, r.flowId))
    if (f) notify(f, `flow_run_${status}`)
    if (status === 'failed' && r.mode === 'live' && r.triggerId && !r.parentRunId) background(emailFailure(r, f))
  }
  return r
}

/** Subflows still going when their caller ends have no one to report to. */
async function cancelChildren(runId: string, reason: string) {
  const kids = await getDb()
    .select({ id: flowRun.id })
    .from(flowRun)
    .where(and(eq(flowRun.parentRunId, runId), inArray(flowRun.status, ACTIVE_STATUSES)))
  for (const k of kids) {
    try {
      await (await getEnv().FLOWS.get(k.id)).terminate()
    } catch {
      // Already gone.
    }
    await finishRun(k.id, 'cancelled', reason)
  }
}

/** Wake the run waiting in flows.run(). It reads the result itself, so the event only says "done". */
async function tellParent(r: RunRow) {
  try {
    const inst = await getEnv().FLOWS.get(r.parentRunId!)
    await inst.sendEvent({ type: subflowEvent(r.id), payload: { status: r.status } })
  } catch (err) {
    // The parent finished or was cancelled; it has nothing left to wake.
    console.warn('[flows] could not wake parent run', r.parentRunId, (err as Error)?.message)
  }
}

export function subflowEvent(childRunId: string) {
  return `subflow-${childRunId}`.slice(0, 100)
}

// ------------------------------------------------------------------ subflows

/**
 * flows.run(): start `ref` as a child of `parent`, as the same person, in the
 * same mode. The child may only touch what the parent's scope allows, so a
 * subflow never widens what the trigger owner approved. Idempotent per `key`:
 * a retried step gets the run it already started.
 */
export async function startChildRun(runAs: Actor, parent: RunRow, ref: string, rawInputs: Record<string, unknown>, key: string) {
  const id = `run_${(await sha256Hex(`subflow:${parent.id}:${key}`)).slice(0, 24)}`
  const [existing] = await getDb().select().from(flowRun).where(eq(flowRun.id, id))
  if (existing) {
    if (existing.parentRunId !== parent.id) throw forbidden('That run belongs to another flow.')
    return { runId: id, flow: existing.flowName, finished: !ACTIVE_STATUSES.includes(existing.status) }
  }

  const name = String(ref ?? '').trim().toLowerCase()
  const declared = (parent.scope.flows ?? []).map((x) => x.toLowerCase())
  if (!name) throw invalid('flows.run needs a flow name, like flows.run("competitor-digest", { ... }).')
  if (!declared.includes(name)) {
    throw forbidden(`${parent.flowName} isn't allowed to run ${name}.`, `Add "${name}" under uses.flows in FLOW.md.`)
  }
  const [parentFlow] = await getDb().select().from(flow).where(eq(flow.id, parent.flowId))
  const teamParent = parentFlow?.spaceId === TEAM
  const candidates = (await visibleFlows(runAs)).filter((f) => f.name.toLowerCase() === name && f.status !== 'missing')
  // Team flows only run team flows. A private flow prefers its owner's own copy, like findFlow.
  const child = teamParent ? candidates.find((f) => f.spaceId === TEAM) : (candidates.find((f) => f.spaceId !== TEAM) ?? candidates[0])
  if (!child) {
    throw notFound(
      `Flow "${name}"`,
      teamParent && candidates.length ? 'Team flows can only run other team flows. Promote it to /team/flows first.' : `${runAs.userName} can't see a flow with that name.`,
    )
  }

  // Walk up the chain: no loops, and not too deep.
  const chain = [parent.flowId]
  let up = parent.parentRunId
  while (up && chain.length <= MAX_FLOW_DEPTH) {
    const [p] = await getDb().select({ flowId: flowRun.flowId, parentRunId: flowRun.parentRunId }).from(flowRun).where(eq(flowRun.id, up))
    if (!p) break
    chain.push(p.flowId)
    up = p.parentRunId
  }
  if (chain.includes(child.id)) throw invalid(`${name} is already running further up this chain, so running it again would loop.`)
  if (chain.length >= MAX_FLOW_DEPTH) throw invalid(`Flows can only nest ${MAX_FLOW_DEPTH} deep. ${parent.flowName} is already ${chain.length} levels down.`)

  const fresh = await refreshFlow(child)
  if (fresh.status !== 'ok' || !fresh.manifest) throw invalid(`Flow "${name}" can't run: ${fresh.error ?? fresh.status}`)
  const missing = scopeMissing(parent.scope, fresh.manifest.uses)
  if (missing.length) {
    throw forbidden(`${name} needs access that ${parent.flowName} doesn't have: ${missing.join('; ')}.`, `Add the same entries under uses in ${parent.flowName}'s FLOW.md, so whoever runs it approves them.`)
  }

  // Values passed for the parent's run only carry over for secrets the child declares.
  const passed = (await decryptRunSecrets(parent.runSecrets)) ?? {}
  const childSecrets = Object.fromEntries(Object.entries(passed).filter(([k]) => (fresh.manifest!.uses.secrets ?? []).includes(k)))

  const r = await startRun(runAs, fresh, {
    inputs: rawInputs && typeof rawInputs === 'object' ? rawInputs : {},
    secrets: childSecrets,
    test: parent.mode === 'test',
    runId: id,
    startedBy: 'flow',
    parentRunId: parent.id,
  })
  return { runId: r.runId, flow: fresh.name, finished: false }
}

/** What a child run ended with, for the parent waiting in flows.run(). */
export async function childResult(parent: RunRow, childRunId: string) {
  const [r] = await getDb().select().from(flowRun).where(eq(flowRun.id, String(childRunId ?? '')))
  if (!r || r.parentRunId !== parent.id) throw forbidden('That run was not started by this one.')
  if (ACTIVE_STATUSES.includes(r.status)) return { done: false as const, status: r.status }
  let outputs = r.outputs ?? {}
  if (r.status === 'succeeded' && r.outputsKey) {
    const obj = await getEnv().FILES.get(r.outputsKey)
    if (obj) outputs = (await obj.json()) as Record<string, Json>
  }
  if (r.status === 'succeeded' && JSON.stringify(outputs).length > MAX_SUBFLOW_OUTPUT) {
    return {
      done: true as const,
      status: 'failed' as const,
      error: `${r.flowName} returned more than ${Math.round(MAX_SUBFLOW_OUTPUT / 1000)} KB of outputs, too much to pass back. Have it write the result to a doc and return the path.`,
      runId: r.id,
    }
  }
  return { done: true as const, status: r.status, error: r.error, outputs: r.status === 'succeeded' ? outputs : null, runId: r.id }
}

async function emailFailure(r: RunRow, f?: FlowRow) {
  const [u] = await getDb().select().from(user).where(eq(user.id, r.runAsUserId))
  if (!u) return
  const { sendEmail } = await import('../email')
  const url = `${appUrl()}/app/flows/runs/${r.id}`
  await sendEmail({
    to: u.email,
    subject: `Flow failed: ${r.flowName}`,
    text: `${r.flowName} failed.\n\n${r.error ?? ''}\n\nSee the run: ${url}`,
    html: `<p><b>${esc(r.flowName)}</b> failed${f ? '' : ''}.</p><pre style="white-space:pre-wrap;font-size:13px">${esc(r.error ?? '')}</pre><p><a href="${url}">See the run</a></p>`,
  })
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// ------------------------------------------------------------------ triggers

const CRON_LABELS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^(\d+) (\d+) \* \* \*$/, (m) => `Every day at ${hm(m[2]!, m[1]!)}`],
  [/^(\d+) (\d+) \* \* 1-5$/, (m) => `Weekdays at ${hm(m[2]!, m[1]!)}`],
  [/^(\d+) (\d+) \* \* (\d)$/, (m) => `Every ${DAYS[Number(m[3]) % 7]} at ${hm(m[2]!, m[1]!)}`],
  [/^(\d+) (\d+) (\d+) \* \*$/, (m) => `Monthly on day ${m[3]} at ${hm(m[2]!, m[1]!)}`],
  [/^(\d+) \* \* \* \*$/, (m) => `Every hour at :${m[1]!.padStart(2, '0')}`],
  [/^\*\/(\d+) \* \* \* \*$/, (m) => `Every ${m[1]} minutes`],
  [/^(\d+) \*\/(\d+) \* \* \*$/, (m) => `Every ${m[2]} hours`],
]
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const hm = (h: string, m: string) => `${h.padStart(2, '0')}:${m.padStart(2, '0')}`

export function describeCron(cron: string, tz: string) {
  for (const [re, fn] of CRON_LABELS) {
    const m = cron.trim().match(re)
    if (m) return `${fn(m)} (${tz})`
  }
  return `${cron} (${tz})`
}

function nextRun(cron: string, tz: string, from = new Date()) {
  const c = new Cron(cron, { timezone: tz, paused: true })
  return c.nextRun(from)
}

function checkCron(cron: string, tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    throw invalid(`Unknown timezone "${tz}".`, 'Use an IANA name like America/New_York or Europe/London.')
  }
  let runs: Date[]
  try {
    runs = new Cron(cron, { timezone: tz, paused: true }).nextRuns(3)
  } catch (err) {
    throw invalid(`"${cron}" is not a valid cron expression: ${(err as Error).message}`, 'Five fields: minute hour day-of-month month day-of-week, like "0 9 * * 1-5" for weekdays at 9:00.')
  }
  if (runs.length < 2) throw invalid(`"${cron}" never runs again.`)
  for (let i = 1; i < runs.length; i++) {
    if (runs[i]!.getTime() - runs[i - 1]!.getTime() < MIN_SCHEDULE_MINUTES * 60_000) {
      throw invalid(`Schedules can run at most every ${MIN_SCHEDULE_MINUTES} minutes.`)
    }
  }
}

async function checkDestinations(runAs: Actor, f: FlowRow, deliver: FlowDestination[]) {
  if (deliver.length > 10) throw invalid('Up to 10 destinations per run.')
  const outputs = Object.keys(f.manifest?.outputs ?? {})
  let conns: Awaited<ReturnType<typeof listConnections>> | undefined
  for (const d of deliver) {
    if ('output' in d && d.output && outputs.length && !outputs.includes(d.output)) {
      throw invalid(`Destination uses output "${d.output}", but ${f.name} only has ${outputs.join(', ')}.`)
    }
    if (d.to === 'space') {
      const target = renderTemplate(d.path, sampleVars())
      const p = parsePath(runAs, target)
      if (p.path === '/') throw invalid('A space destination needs a file path, like /team/reports/{date}.md.')
      if (!canWriteSpace(runAs, p.spaceId)) throw forbidden(`${runAs.userName} can't write to ${d.path}.`)
    } else if (d.to === 'connection') {
      conns ??= await listConnections(runAs, { usableOnly: true })
      const c = conns.find((x) => x.slug === d.connection || x.id === d.connection || x.name.toLowerCase() === d.connection.toLowerCase())
      if (!c) throw invalid(`No usable connection "${d.connection}".`, 'Use connections_list to see what is connected.')
      if (!d.tool) throw invalid('A connection destination needs a tool name.')
    } else if (d.to === 'email') {
      if (!d.members?.length) throw invalid('An email destination needs members: "me", "owner", or member emails.')
    } else if (d.to === 'webhook') {
      let u: URL
      try {
        u = new URL(d.url)
      } catch {
        throw invalid(`"${d.url}" is not a URL.`)
      }
      if (u.protocol !== 'https:') throw invalid('Webhook destinations must use https.')
    } else {
      throw invalid(`Unknown destination type "${(d as { to: string }).to}". Use space, connection, email or webhook.`)
    }
  }
}

export async function listTriggers(actor: Actor, ref: string) {
  const f = await findFlow(actor, ref)
  const rows = await getDb().select().from(flowTrigger).where(eq(flowTrigger.flowId, f.id)).orderBy(flowTrigger.createdAt)
  const people = await names(rows.map((t) => t.runAsUserId))
  return rows.map((t) => triggerInfo(actor, f, t, people))
}

export type TriggerInput = {
  flow: string
  id?: string
  kind?: 'manual' | 'schedule' | 'webhook'
  name?: string
  cron?: string
  timezone?: string
  inputs?: Record<string, unknown>
  deliver?: FlowDestination[]
  enabled?: boolean
}

/** Create or update a trigger. Whoever saves it becomes the person it runs as, and approves the flow's current scope. */
export async function setTrigger(actor: Actor, input: TriggerInput) {
  requireRole(actor, 'member', 'set up flow triggers')
  let f = await findFlow(actor, input.flow)
  f = await refreshFlow(f)
  if (f.status !== 'ok' || !f.manifest) throw invalid(`Flow "${f.name}" has problems: ${f.error}`, 'Fix it before scheduling it.')
  const db = getDb()
  let existing: TriggerRow | undefined
  if (input.id) {
    ;[existing] = await db.select().from(flowTrigger).where(and(eq(flowTrigger.id, input.id), eq(flowTrigger.flowId, f.id)))
    if (!existing) throw notFound(`Trigger "${input.id}"`)
    if (existing.runAsUserId !== actor.userId && !atLeast(actor, 'admin')) {
      throw forbidden(`This trigger runs as someone else. Only they or an admin can change it.`)
    }
  }
  const kind = input.kind ?? existing?.kind ?? 'manual'
  const tz = input.timezone ?? existing?.timezone ?? 'UTC'
  const cron = kind === 'schedule' ? (input.cron ?? existing?.cron) : null
  if (kind === 'schedule') {
    if (!cron) throw invalid('A schedule needs cron, like "0 9 * * 1-5".')
    checkCron(cron, tz)
  }
  const inputs = input.inputs ?? existing?.inputs ?? {}
  const { inputs: clean, problems } = validateInputs(f.manifest, inputs)
  if (kind === 'schedule' && problems.length) throw invalid(`Inputs: ${problems.join('; ')}.`)
  const deliver = input.deliver ?? existing?.deliver ?? []
  await checkDestinations(actor, f, deliver)
  if (kind !== 'manual') await checkSecrets(actor, f, undefined)
  const enabled = input.enabled ?? existing?.enabled ?? true
  const fields = {
    kind,
    name: input.name?.trim() || existing?.name || (kind === 'schedule' ? describeCron(cron!, tz) : kind === 'webhook' ? 'Webhook' : 'Saved run'),
    cron,
    timezone: kind === 'schedule' ? tz : null,
    nextRunAt: kind === 'schedule' && enabled ? nextRun(cron!, tz) : null,
    inputs: (problems.length ? inputs : clean) as Record<string, Json>,
    deliver,
    runAsUserId: actor.userId,
    approvedScope: f.manifest.uses,
    approvedScopeHash: f.scopeHash!,
    enabled,
    pausedReason: null,
    updatedAt: new Date(),
  }
  let webhookToken: string | undefined
  let row: TriggerRow
  if (existing) {
    ;[row] = (await db.update(flowTrigger).set(fields).where(eq(flowTrigger.id, existing.id)).returning()) as [TriggerRow]
    if (kind === 'webhook' && !existing.webhookTokenHash) {
      webhookToken = `bsh_${randomToken(24)}`
      await db.update(flowTrigger).set({ webhookTokenHash: await sha256Hex(webhookToken) }).where(eq(flowTrigger.id, existing.id))
    }
  } else {
    if (kind === 'webhook') webhookToken = `bsh_${randomToken(24)}`
    ;[row] = (await db
      .insert(flowTrigger)
      .values({
        id: newId('ftr'),
        workspaceId: actor.workspaceId,
        flowId: f.id,
        createdBy: actor.userId,
        webhookTokenHash: webhookToken ? await sha256Hex(webhookToken) : null,
        ...fields,
      })
      .returning()) as [TriggerRow]
  }
  await logActivity(actor, existing ? 'flow_trigger_update' : 'flow_trigger_add', {
    spaceId: f.spaceId,
    path: f.folderPath,
    details: { flow: f.name, trigger: row.name, kind },
    audience: await flowAudience(actor, f),
  })
  notify(f, 'flow_trigger')
  const people = await names([actor.userId])
  return {
    ...triggerInfo(actor, f, row, people),
    webhookUrl: webhookToken ? `${appUrl()}/api/flows/hook/${webhookToken}` : triggerInfo(actor, f, row, people).webhookUrl,
    webhookNote: webhookToken ? 'This URL is shown once. POST JSON inputs to it to start a run.' : undefined,
  }
}

export async function removeTrigger(actor: Actor, triggerId: string) {
  requireRole(actor, 'member', 'remove flow triggers')
  const [t] = await getDb().select().from(flowTrigger).where(and(eq(flowTrigger.id, triggerId), eq(flowTrigger.workspaceId, actor.workspaceId)))
  if (!t) throw notFound(`Trigger "${triggerId}"`)
  const [f] = await getDb().select().from(flow).where(eq(flow.id, t.flowId))
  if (!f || !(await canSee(actor, f))) throw notFound(`Trigger "${triggerId}"`)
  if (t.runAsUserId !== actor.userId && !atLeast(actor, 'admin')) throw forbidden('Only the person a trigger runs as, or an admin, can remove it.')
  await getDb().delete(flowTrigger).where(eq(flowTrigger.id, t.id))
  await logActivity(actor, 'flow_trigger_remove', {
    spaceId: f.spaceId,
    path: f.folderPath,
    details: { flow: f.name, trigger: t.name },
    audience: await flowAudience(actor, f),
  })
  notify(f, 'flow_trigger')
  return { removed: t.name }
}

/** Run a saved trigger now (manual presets, or a schedule on demand). */
export async function runTrigger(actor: Actor, triggerId: string) {
  requireRole(actor, 'member', 'run flows')
  const [t] = await getDb().select().from(flowTrigger).where(and(eq(flowTrigger.id, triggerId), eq(flowTrigger.workspaceId, actor.workspaceId)))
  if (!t) throw notFound(`Trigger "${triggerId}"`)
  const f = await findFlow(actor, t.flowId)
  // The person clicking runs it as themselves, with the trigger's inputs and destinations.
  return startRun(actor, f, { inputs: t.inputs, deliver: t.deliver, trigger: t, startedBy: actor.userId })
}

/** Load the trigger's run-as person and check they still approve the flow's scope. */
async function triggerActor(t: TriggerRow, f: FlowRow): Promise<Actor | { paused: string }> {
  const [u] = await getDb().select().from(user).where(eq(user.id, t.runAsUserId))
  if (!u) return { paused: 'The person this trigger runs as no longer exists.' }
  let actor: Actor
  try {
    actor = await actorFor(u, t.workspaceId, 'flow', f.name)
  } catch {
    return { paused: `${u.name} is no longer in this workspace.` }
  }
  if (actor.role === 'viewer') return { paused: `${u.name} is read-only now and can't run flows.` }
  if (!(await canSee(actor, f))) return { paused: `${u.name} can't see ${f.name} anymore, so it can't run as them.` }
  if (f.manifest && scopeWidened(t.approvedScope, f.manifest.uses)) {
    // If the run-as person made the change themselves, their edit is their approval.
    const [last] = await getDb()
      .select({ authorId: nodeVersion.authorId })
      .from(nodeVersion)
      .where(and(eq(nodeVersion.nodeId, f.manifestNodeId!), eq(nodeVersion.version, f.manifestVersion!)))
    if (last?.authorId !== t.runAsUserId) {
      return { paused: `${f.name} now asks for more access (${describeScope(f.manifest.uses).join('; ')}). ${u.name} has to approve it again.` }
    }
  }
  if (f.manifest && t.approvedScopeHash !== f.scopeHash) {
    await getDb().update(flowTrigger).set({ approvedScope: f.manifest.uses, approvedScopeHash: f.scopeHash! }).where(eq(flowTrigger.id, t.id))
  }
  return { ...actor, via: 'flow', clientName: f.name }
}

/** Approve a flow's new scope for a paused trigger and turn it back on. */
export async function approveTriggerScope(actor: Actor, triggerId: string) {
  const [t] = await getDb().select().from(flowTrigger).where(and(eq(flowTrigger.id, triggerId), eq(flowTrigger.workspaceId, actor.workspaceId)))
  if (!t) throw notFound(`Trigger "${triggerId}"`)
  if (t.runAsUserId !== actor.userId) throw forbidden('Only the person a trigger runs as can approve its access.')
  const f = await refreshFlow((await getDb().select().from(flow).where(eq(flow.id, t.flowId)))[0]!)
  if (!(await canSee(actor, f))) throw notFound(`Trigger "${triggerId}"`)
  if (f.status !== 'ok' || !f.manifest) throw invalid(`Flow "${f.name}" has problems: ${f.error}`)
  await getDb()
    .update(flowTrigger)
    .set({
      approvedScope: f.manifest.uses,
      approvedScopeHash: f.scopeHash!,
      enabled: true,
      pausedReason: null,
      nextRunAt: t.kind === 'schedule' && t.cron ? nextRun(t.cron, t.timezone ?? 'UTC') : null,
    })
    .where(eq(flowTrigger.id, t.id))
  notify(f, 'flow_trigger')
  return { approved: describeScope(f.manifest.uses) }
}

async function pauseTrigger(t: TriggerRow, reason: string) {
  await getDb().update(flowTrigger).set({ enabled: false, pausedReason: reason, lastStatus: 'paused' }).where(eq(flowTrigger.id, t.id))
  const [u] = await getDb().select().from(user).where(eq(user.id, t.runAsUserId))
  if (u) {
    const { sendEmail } = await import('../email')
    const url = `${appUrl()}/app/flows`
    background(
      sendEmail({
        to: u.email,
        subject: `Flow paused: ${t.name}`,
        text: `${reason}\n\nReview it: ${url}`,
        html: `<p>${esc(reason)}</p><p><a href="${url}">Review it in Brainspace</a></p>`,
      }),
    )
  }
}

/** Cron tick: start every schedule that is due. */
export async function runDueSchedules(now = new Date()) {
  const db = getDb()
  const due = await db
    .select()
    .from(flowTrigger)
    .where(and(eq(flowTrigger.enabled, true), eq(flowTrigger.kind, 'schedule'), lte(flowTrigger.nextRunAt, now)))
    .limit(50)
  for (const t of due) {
    const slot = t.nextRunAt!.getTime()
    // Claim the slot first so overlapping ticks can't both fire it. After downtime, catch up once.
    const next = nextRun(t.cron!, t.timezone ?? 'UTC', now)
    const claimed = await db
      .update(flowTrigger)
      .set({ nextRunAt: next })
      .where(and(eq(flowTrigger.id, t.id), eq(flowTrigger.nextRunAt, t.nextRunAt!)))
      .returning({ id: flowTrigger.id })
    if (!claimed.length) continue
    try {
      const [f0] = await db.select().from(flow).where(eq(flow.id, t.flowId))
      if (!f0) continue
      const f = await refreshFlow(f0)
      if (f.status !== 'ok') {
        await db.update(flowTrigger).set({ lastStatus: 'skipped', lastRunAt: now }).where(eq(flowTrigger.id, t.id))
        continue
      }
      const who = await triggerActor(t, f)
      if ('paused' in who) {
        await pauseTrigger(t, who.paused)
        continue
      }
      await startRun(who, f, { inputs: t.inputs, deliver: t.deliver, trigger: t, runId: `run_${t.id.slice(4)}_${slot.toString(36)}`, startedBy: 'schedule' })
    } catch (err) {
      console.error('[flows] schedule failed', t.id, err)
      await db.update(flowTrigger).set({ lastStatus: `error: ${String((err as Error).message).slice(0, 200)}`, lastRunAt: now }).where(eq(flowTrigger.id, t.id))
    }
  }
  return due.length
}

/** POST /api/flows/hook/<token> */
export async function handleWebhook(token: string, body: unknown) {
  const hash = await sha256Hex(token)
  const [t] = await getDb().select().from(flowTrigger).where(eq(flowTrigger.webhookTokenHash, hash))
  if (!t || t.kind !== 'webhook') throw notFound('Webhook')
  if (!t.enabled) throw new AppError('conflict', `This webhook is paused${t.pausedReason ? `: ${t.pausedReason}` : '.'}`)
  const [f0] = await getDb().select().from(flow).where(eq(flow.id, t.flowId))
  if (!f0) throw notFound('Flow')
  const f = await refreshFlow(f0)
  const who = await triggerActor(t, f)
  if ('paused' in who) {
    await pauseTrigger(t, who.paused)
    throw new AppError('conflict', who.paused)
  }
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const inputs = { ...t.inputs, ...((b.inputs as Record<string, unknown>) ?? b) }
  const r = await startRun(who, f, { inputs, deliver: t.deliver, trigger: t, startedBy: 'webhook' })
  return { runId: r.runId, status: r.status }
}

// ------------------------------------------------------------------ run tokens

export async function verifyRunToken(token: string) {
  const dot = token.lastIndexOf('.')
  if (dot < 0) return null
  const runId = token.slice(0, dot)
  return (await hmacVerify(`flowrun:${runId}`, token.slice(dot + 1))) ? runId : null
}

// ------------------------------------------------------------------ delivery

export function sampleVars() {
  return { date: '2026-01-01', time: '09-00', run: 'run_x', flow: 'flow', trigger: 'manual', inputs: {}, outputs: {}, links: {} }
}

type Vars = Record<string, unknown>

/** Fill {date}, {inputs.x}, {outputs.x}, {links.run}... Unknown keys stay as written. */
export function renderTemplate(tpl: string, vars: Vars): string {
  return tpl.replace(/\{([a-zA-Z_][\w.]*)\}/g, (whole, key: string) => {
    let v: unknown = vars
    for (const part of key.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined
    if (v === undefined || v === null) return whole
    return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)
  })
}

export function renderDeep(value: Json, vars: Vars): Json {
  if (typeof value === 'string') {
    // A value that is exactly one placeholder keeps its type (objects, numbers).
    const only = value.match(/^\{([a-zA-Z_][\w.]*)\}$/)
    if (only) {
      let v: unknown = vars
      for (const part of only[1]!.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined
      if (v !== undefined) return v as Json
    }
    return renderTemplate(value, vars)
  }
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, vars))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderDeep(v, vars)]))
  return value
}

export function deliveryLabel(d: FlowDestination) {
  switch (d.to) {
    case 'space':
      return `${d.mode === 'version' ? 'update' : d.mode === 'append' ? 'append to' : 'save'} ${d.path}`
    case 'connection':
      return `${d.connection} · ${d.tool}`
    case 'email':
      return `email ${d.members.join(', ')}`
    case 'webhook':
      return `POST ${new URL(d.url).host}`
  }
}

export function datedVars(tz: string | null | undefined) {
  const now = new Date()
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}-${parts.minute}`, datetime: now.toISOString() }
}

export function outputText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```'
}

export async function membersForEmail(runAs: Actor, list: string[]) {
  const rows = await getDb()
    .select({ id: user.id, email: user.email, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.workspaceId, runAs.workspaceId))
  const out = new Set<string>()
  for (const raw of list) {
    const k = raw.trim().toLowerCase()
    if (k === 'me' || k === 'owner' || k === 'runner') out.add(runAs.email)
    else if (k === 'team' || k === 'everyone') rows.forEach((r) => out.add(r.email))
    else {
      const m = rows.find((r) => r.email.toLowerCase() === k || r.id === raw || r.name.toLowerCase() === k)
      if (m) out.add(m.email)
    }
  }
  return [...out].slice(0, 50)
}

