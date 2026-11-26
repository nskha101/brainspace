import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM } from '../actor'
import { bot, getDb, node } from '../db'
import type { FlowManifest } from '../db'
import { parseFlowDoc } from '../flows/manifest'
import { outermost, privateUses, repoint } from '../flows/share'
import { inSubtree } from '../paths'
import * as files from './files'
import { flowFolders, visibleFlows } from './flows'

/** Something private a flow needs, which moves to the team space when the flow is shared. */
export type ShareItem = {
  from: string
  to: string
  kind: 'flow' | 'folder' | 'doc' | 'file' | 'database'
  /** Files inside, for a folder or a flow. */
  files: number
}

export type FlowSharePlan = {
  /** What moves to /team along with the flow. */
  items: ShareItem[]
  /** Every /me path that becomes a /team path, the flow's own folder included. */
  moves: { from: string; to: string }[]
  /** The flow or one of its subflows lists /me paths, so its files need rewriting. */
  usesPrivate: boolean
  /** Private bots it runs. They stay private: a bot keeps its own access, so sharing it is a separate decision. */
  bots: string[]
  /** Reasons the flow can't be shared as it is. */
  blocked: string[]
}

/**
 * What sharing a private flow takes with it. A team flow can't reach personal
 * spaces, so the private files, databases and subflows it uses have to move to
 * /team too. Null when `src` isn't a private flow's folder.
 */
export async function planFlowShare(actor: Actor, src: { spaceId: string; path: string }, destPath: string): Promise<FlowSharePlan | null> {
  if (src.spaceId !== actor.userId || !/^\/flows\/[^/]+$/.test(src.path)) return null
  const folders = await flowFolders(actor.workspaceId, [actor.userId])
  const root = folders.find((f) => f.folder.path === src.path)
  if (!root) return null

  const manifests = new Map<string, FlowManifest | null>(
    folders.map((f) => {
      try {
        return [f.folder.path, parseFlowDoc(f.manifest!.content ?? '').manifest]
      } catch {
        return [f.folder.path, null]
      }
    }),
  )
  const teamNames = new Set((await visibleFlows(actor)).filter((f) => f.spaceId === TEAM && f.status !== 'missing').map((f) => f.name.toLowerCase()))

  const flows = new Map([[root.folder.path, root]])
  const paths: string[] = []
  const botNames = new Set<string>()
  const blocked: string[] = []
  let usesPrivate = false
  const queue = [root]
  const add = (f: (typeof folders)[number]) => {
    if (flows.has(f.folder.path)) return
    flows.set(f.folder.path, f)
    queue.push(f)
  }
  while (queue.length) {
    const fl = queue.shift()!
    const m = manifests.get(fl.folder.path)
    if (!m) continue
    for (const p of privateUses(m.uses)) {
      usesPrivate = true
      // A path in another private flow's folder: that flow would lose its files, so it comes along whole.
      const owner = folders.find((f) => p === f.folder.path || p.startsWith(f.folder.path + '/'))
      if (owner) add(owner)
      else if (p === '/' || p === '/flows') {
        blocked.push(`${m.name} lists /me${p === '/' ? '' : p} under uses, which is ${p === '/' ? 'your whole personal space' : 'every private flow you have'}. Narrow it to what the flow needs.`)
      } else paths.push(p)
    }
    for (const name of m.uses.flows ?? []) {
      // A team flow runs the team's flow of that name when there is one.
      if (teamNames.has(name.toLowerCase())) continue
      const sub = folders.find((f) => manifests.get(f.folder.path)?.name === name)
      if (sub) add(sub)
    }
    for (const b of m.uses.bots ?? []) botNames.add(b.toLowerCase())
  }

  const db = getDb()
  const countFiles = async (path: string) => {
    const [r] = await db
      .select({ n: sql<number>`count(*)` })
      .from(node)
      .where(and(eq(node.workspaceId, actor.workspaceId), eq(node.spaceId, actor.userId), inSubtree(node.path, path), isNull(node.deletedAt), ne(node.kind, 'folder')))
    return r?.n ?? 0
  }
  const taken = async (to: string) => {
    if ((await files.resolve(actor, to)).node) blocked.push(`${to} already exists in the team space, so /me${to.slice(5)} can't move there. Move or rename one of them first.`)
  }

  const items: ShareItem[] = []
  const moves = [{ from: `/me${root.folder.path}`, to: `/team${destPath}` }]
  for (const f of flows.values()) {
    if (f === root) continue
    const item = { from: `/me${f.folder.path}`, to: `/team${f.folder.path}` }
    await taken(item.to)
    items.push({ ...item, kind: 'flow', files: await countFiles(f.folder.path) })
    moves.push(item)
  }
  for (const p of outermost(paths)) {
    const item = { from: `/me${p}`, to: `/team${p}` }
    moves.push(item)
    // Nothing there yet, like a report the flow hasn't written: only the path changes.
    const n = (await files.resolve(actor, item.from)).node
    if (!n) continue
    await taken(item.to)
    items.push({ ...item, kind: n.kind, files: n.kind === 'folder' ? await countFiles(p) : 1 })
  }

  const bots = botNames.size
    ? (await db.select({ name: bot.name }).from(bot).where(and(eq(bot.workspaceId, actor.workspaceId), eq(bot.ownerId, actor.userId), ne(bot.visibility, 'team'))))
        .map((b) => b.name)
        .filter((n) => botNames.has(n.toLowerCase()))
    : []
  return { items, moves, usesPrivate, bots, blocked }
}

/** Whether sharing the flow needs more than moving its folder. */
export function needsWork(plan: FlowSharePlan | null): plan is FlowSharePlan {
  return !!plan && (plan.items.length > 0 || plan.usesPrivate || plan.blocked.length > 0)
}

/** "/me/leads (a folder, 3 files)" */
export function describeItem(i: ShareItem) {
  const what = i.kind === 'flow' ? 'a flow' : i.kind === 'folder' ? 'a folder' : i.kind === 'database' ? 'a database' : 'a file'
  return i.kind === 'flow' || i.kind === 'folder' ? `${i.from} (${what}, ${i.files} ${i.files === 1 ? 'file' : 'files'})` : `${i.from} (${what})`
}

/**
 * Point the person's private flows at the team paths, before the files move.
 * That covers the flows being shared and any other private flow that used the
 * same files, which would otherwise look for them where they no longer are.
 */
export async function repointFlows(actor: Actor, plan: FlowSharePlan) {
  for (const f of await flowFolders(actor.workspaceId, [actor.userId])) {
    for (const d of [f.manifest, f.code]) {
      if (!d?.content) continue
      const next = repoint(d.content, plan.moves)
      if (next !== d.content) await files.write(actor, `/me${d.path}`, next, { message: 'Updated paths: what this flow uses moved to the team space' })
    }
  }
}
