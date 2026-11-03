import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM } from '../actor'
import { batch, getDb, node, raw } from '../db'
import { getEnv } from '../env'
import { displayPath } from '../paths'

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5'
const CHUNK_CHARS = 1800
const CHUNK_OVERLAP = 200
const MAX_CHUNKS = 60

type IndexableNode = {
  id: string
  workspaceId: string
  driveId: string
  name: string
  path: string
  kind: string
  content: string | null
  description?: string | null
  chunkCount: number
}

/** Keyword index statements, meant to run inside the same batch as the write. */
export function ftsStatements(n: IndexableNode) {
  const text = [n.description ?? '', n.kind === 'doc' ? (n.content ?? '') : ''].join('\n')
  return [
    raw('DELETE FROM node_fts WHERE node_id = ?', n.id),
    raw(
      'INSERT INTO node_fts (node_id, workspace_id, drive_id, name, path, content) VALUES (?, ?, ?, ?, ?, ?)',
      n.id,
      n.workspaceId,
      n.driveId,
      n.name,
      n.path,
      text,
    ),
  ]
}

export async function ftsDelete(nodeIds: string[]) {
  if (!nodeIds.length) return
  const env = getEnv()
  const stmts = nodeIds.map((id) => env.DB.prepare('DELETE FROM node_fts WHERE node_id = ?').bind(id))
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50))
}

export async function ftsReindex(nodes: IndexableNode[]) {
  const stmts = nodes.flatMap((n) => ftsStatements(n))
  for (let i = 0; i < stmts.length; i += 50) await batch(stmts.slice(i, i + 50))
}

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r/g, '').trim()
  if (!clean) return []
  const chunks: string[] = []
  let start = 0
  while (start < clean.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(start + CHUNK_CHARS, clean.length)
    if (end < clean.length) {
      const para = clean.lastIndexOf('\n\n', end)
      const line = clean.lastIndexOf('\n', end)
      if (para > start + CHUNK_CHARS / 2) end = para
      else if (line > start + CHUNK_CHARS / 2) end = line
    }
    chunks.push(clean.slice(start, end).trim())
    if (end >= clean.length) break
    start = Math.max(end - CHUNK_OVERLAP, start + 1)
  }
  return chunks.filter(Boolean)
}

async function embed(texts: string[]): Promise<number[][]> {
  const env = getEnv()
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 50) {
    const res = (await env.AI.run(EMBED_MODEL, { text: texts.slice(i, i + 50) })) as {
      data: number[][]
    }
    out.push(...res.data)
  }
  return out
}

/** Semantic index. Runs in the background after a write. Returns the new chunk count. */
export async function vectorIndex(n: IndexableNode): Promise<number> {
  const env = getEnv()
  const body = n.kind === 'doc' ? (n.content ?? '') : ''
  const header = `${n.path}\n${n.description ?? ''}`.trim()
  const chunks = body ? chunkText(body) : [header]
  const vectors = await embed(chunks.map((c) => `${header}\n\n${c}`))
  if (vectors.length) {
    await env.VECTORS.upsert(
      vectors.map((values, i) => ({
        id: `${n.id}:${i}`,
        values,
        metadata: {
          workspaceId: n.workspaceId,
          driveId: n.driveId,
          nodeId: n.id,
          chunk: i,
          text: chunks[i]!.slice(0, 1500),
        },
      })),
    )
  }
  const stale = []
  for (let i = vectors.length; i < n.chunkCount; i++) stale.push(`${n.id}:${i}`)
  if (stale.length) await env.VECTORS.deleteByIds(stale)
  await getDb().update(node).set({ chunkCount: vectors.length }).where(eq(node.id, n.id))
  return vectors.length
}

export async function vectorDelete(nodes: { id: string; chunkCount: number }[]) {
  const ids = nodes.flatMap((n) => Array.from({ length: n.chunkCount }, (_, i) => `${n.id}:${i}`))
  if (!ids.length) return
  const env = getEnv()
  for (let i = 0; i < ids.length; i += 500) await env.VECTORS.deleteByIds(ids.slice(i, i + 500))
}

export type SearchHit = {
  id: string
  path: string
  name: string
  kind: string
  drive: 'team' | 'me'
  version: number
  updatedAt: number
  snippet: string
  score: number
  matchedBy: ('keyword' | 'semantic')[]
}

function ftsQuery(q: string, mode: 'and' | 'or') {
  const tokens = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 12)
  if (!tokens.length) return null
  return tokens.map((t) => `"${t}"*`).join(mode === 'and' ? ' AND ' : ' OR ')
}

export async function search(
  actor: Actor,
  query: string,
  opts: { drive?: 'team' | 'me' | 'all'; mode?: 'hybrid' | 'keyword' | 'semantic'; limit?: number; pathPrefix?: string } = {},
): Promise<SearchHit[]> {
  const env = getEnv()
  const limit = Math.min(opts.limit ?? 10, 50)
  const mode = opts.mode ?? 'hybrid'
  const drives =
    opts.drive === 'team' ? [TEAM] : opts.drive === 'me' ? [actor.userId] : [TEAM, actor.userId]
  const hits = new Map<string, { score: number; snippet: string; matchedBy: Set<'keyword' | 'semantic'> }>()

  if (mode !== 'semantic') {
    for (const m of ['and', 'or'] as const) {
      const fq = ftsQuery(query, m)
      if (!fq) break
      const placeholders = drives.map(() => '?').join(',')
      const res = await env.DB.prepare(
        `SELECT node_id, bm25(node_fts, 0, 0, 0, 8.0, 4.0, 1.0) AS rank,
                snippet(node_fts, 5, '**', '**', '…', 24) AS snip
         FROM node_fts
         WHERE node_fts MATCH ? AND workspace_id = ? AND drive_id IN (${placeholders})
         ORDER BY rank LIMIT ?`,
      )
        .bind(fq, actor.workspaceId, ...drives, limit * 2)
        .all<{ node_id: string; rank: number; snip: string }>()
      res.results.forEach((r, i) => {
        const score = 1 / (60 + i)
        hits.set(r.node_id, { score, snippet: r.snip, matchedBy: new Set(['keyword']) })
      })
      if (res.results.length) break
    }
  }

  if (mode !== 'keyword') {
    try {
      const [vec] = await embed([query])
      const res = await env.VECTORS.query(vec!, {
        topK: Math.min(limit * 3, 50),
        returnMetadata: 'all',
        filter: { workspaceId: actor.workspaceId, driveId: { $in: drives } },
      })
      const seen = new Set<string>()
      let rank = 0
      for (const m of res.matches) {
        const md = m.metadata as { nodeId?: string; text?: string; driveId?: string } | undefined
        if (!md?.nodeId || seen.has(md.nodeId) || !drives.includes(md.driveId ?? '')) continue
        seen.add(md.nodeId)
        const score = 1 / (60 + rank++)
        const prev = hits.get(md.nodeId)
        if (prev) {
          prev.score += score
          prev.matchedBy.add('semantic')
        } else {
          hits.set(md.nodeId, {
            score,
            snippet: (md.text ?? '').slice(0, 300),
            matchedBy: new Set(['semantic']),
          })
        }
      }
    } catch (err) {
      console.error('[search] semantic search failed', err)
    }
  }

  if (!hits.size) return []
  const ids = [...hits.keys()]
  const rows = await getDb()
    .select({
      id: node.id,
      driveId: node.driveId,
      path: node.path,
      name: node.name,
      kind: node.kind,
      version: node.version,
      updatedAt: node.updatedAt,
    })
    .from(node)
    .where(and(inArray(node.id, ids), eq(node.workspaceId, actor.workspaceId), isNull(node.deletedAt)))

  const prefix = opts.pathPrefix?.replace(/\/$/, '')
  return rows
    .filter((r) => drives.includes(r.driveId))
    .map((r) => {
      const h = hits.get(r.id)!
      return {
        id: r.id,
        path: displayPath(actor, r.driveId, r.path),
        name: r.name,
        kind: r.kind,
        drive: (r.driveId === TEAM ? 'team' : 'me') as 'team' | 'me',
        version: r.version,
        updatedAt: r.updatedAt.getTime(),
        snippet: h.snippet,
        score: Number(h.score.toFixed(5)),
        matchedBy: [...h.matchedBy],
      }
    })
    .filter((r) => !prefix || r.path === prefix || r.path.startsWith(prefix + '/'))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
