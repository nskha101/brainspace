import { and, desc, eq, sql } from 'drizzle-orm'
import type { Actor } from '../actor'
import { background } from '../env'
import { batch, getDb, node, nodeRead, user } from '../db'

/**
 * One person counts as one read per window. Opening a doc, a refresh, the page
 * re-fetching after a save and an agent reading it twice in a row are all one read.
 */
export const READ_WINDOW_MS = 10 * 60_000

/**
 * Note that someone read a doc, file or database. Runs after the response, so
 * reads never wait on it or fail because of it.
 */
export function recordRead(actor: Actor, n: { id: string; kind: string }) {
  if (n.kind === 'folder') return
  background(record(actor, n.id))
}

async function record(actor: Actor, nodeId: string) {
  const db = getDb()
  const now = Date.now()
  const at = new Date(now)
  // A flow or bot running as someone is not that person using the doc: it gets its own row and total.
  const source = actor.via === 'flow' || actor.via === 'bot' ? ('flow' as const) : ('person' as const)
  const mine = and(eq(nodeRead.nodeId, nodeId), eq(nodeRead.userId, actor.userId), eq(nodeRead.source, source))
  const won = sql`exists (select 1 from ${nodeRead} where ${mine} and ${nodeRead.lastAt} = ${now})`
  // One transaction. The upsert only touches this row when its last counted
  // read is outside the window; the node's totals move only if it did (the
  // row now carries this exact timestamp).
  await batch([
    db
      .insert(nodeRead)
      .values({
        nodeId,
        userId: actor.userId,
        source,
        workspaceId: actor.workspaceId,
        count: 1,
        via: actor.via,
        clientName: actor.clientName ?? null,
        firstAt: at,
        lastAt: at,
      })
      .onConflictDoUpdate({
        target: [nodeRead.nodeId, nodeRead.userId, nodeRead.source],
        set: { count: sql`${nodeRead.count} + 1`, lastAt: at, via: actor.via, clientName: actor.clientName ?? null },
        setWhere: sql`${nodeRead.lastAt} < ${now - READ_WINDOW_MS}`,
      }),
    source === 'flow'
      ? db
          .update(node)
          .set({ flowReadCount: sql`${node.flowReadCount} + 1`, flowReadAt: sql`max(coalesce(${node.flowReadAt}, 0), ${now})` })
          .where(and(eq(node.id, nodeId), won))
      : db
          .update(node)
          .set({
            readCount: sql`${node.readCount} + 1`,
            // A first read by this person (their count is 1) adds a reader.
            readerCount: sql`${node.readerCount} + (select count(*) from ${nodeRead} where ${mine} and ${nodeRead.count} = 1)`,
            // Reads can finish out of order; the latest one wins.
            readAt: sql`max(coalesce(${node.readAt}, 0), ${now})`,
            readBy: sql`case when coalesce(${node.readAt}, 0) <= ${now} then ${actor.userId} else ${node.readBy} end`,
          })
          .where(and(eq(node.id, nodeId), won)),
  ])
}

/** Who has read a node (people, then flows), most recent first. */
export async function readersOf(nodeId: string, limit = 50) {
  const rows = await getDb()
    .select({
      userId: nodeRead.userId,
      source: nodeRead.source,
      name: user.name,
      email: user.email,
      image: user.image,
      count: nodeRead.count,
      via: nodeRead.via,
      clientName: nodeRead.clientName,
      firstAt: nodeRead.firstAt,
      lastAt: nodeRead.lastAt,
    })
    .from(nodeRead)
    .leftJoin(user, eq(user.id, nodeRead.userId))
    .where(eq(nodeRead.nodeId, nodeId))
    .orderBy(desc(nodeRead.lastAt))
    .limit(limit)
  const out = rows.map((r) => ({ ...r, firstAt: r.firstAt.getTime(), lastAt: r.lastAt.getTime() }))
  return { people: out.filter((r) => r.source === 'person'), flows: out.filter((r) => r.source === 'flow') }
}
