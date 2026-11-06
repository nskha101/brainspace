import { and, eq, isNull } from 'drizzle-orm'
import { getDb, node, nodeText } from '../db'
import { getEnv } from '../env'
import { publishSystemChange } from '../live'
import { extOf } from '../paths'
import { contextDevKeyFor } from './connections'
import { ftsReindex, vectorIndex } from './search'

/** File types Context.dev's parser turns into useful markdown. Images are left out (OCR on photos is rarely useful). */
const PARSEABLE: Record<string, string> = {
  pdf: 'pdf',
  docx: 'docx',
  doc: 'doc',
  rtf: 'rtf',
  odt: 'odt',
  pptx: 'pptx',
  ppt: 'ppt',
  odp: 'odp',
  xlsx: 'xlsx',
  xls: 'xls',
  ods: 'ods',
  epub: 'epub',
}

const MAX_PARSE_BYTES = 50 * 1024 * 1024
/** D1 rows top out near 2 MB; longer text lives in R2 and D1 keeps the head for search. */
const D1_TEXT_CAP = 600_000

export function isParseable(name: string) {
  return !!PARSEABLE[extOf(name)]
}

export type ExtractMessage = { nodeId: string; version: number; ocr?: boolean }

export async function queueExtraction(msg: ExtractMessage) {
  await getEnv().EXTRACT_QUEUE.send(msg)
}

class ExtractError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message)
  }
}

async function setStatus(nodeId: string, status: 'pending' | 'done' | 'failed', error: string | null, chars?: number | null) {
  await getDb()
    .update(node)
    .set({ textStatus: status, textError: error?.slice(0, 500) ?? null, ...(chars !== undefined ? { textChars: chars } : {}) })
    .where(eq(node.id, nodeId))
}

async function callParse(key: string, bytes: ArrayBuffer, ext: string, mime: string | null, ocr: boolean) {
  const qs = new URLSearchParams({ extension: ext })
  if (ext === 'pdf') {
    qs.set('includeNumberedPages', 'true')
    if (ocr) qs.set('ocr', 'true')
  }
  const res = await fetch(`https://api.context.dev/v1/parse?${qs}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': mime || 'application/octet-stream' },
    body: bytes,
    signal: AbortSignal.timeout(5 * 60_000),
  })
  const body = (await res.json().catch(() => ({}))) as { markdown?: string; message?: string; error?: string; code?: string }
  if (!res.ok) {
    const msg = body.message || body.error || body.code || `HTTP ${res.status}`
    throw new ExtractError(`Context.dev couldn't parse this file: ${msg}`, res.status === 429 || res.status >= 500)
  }
  return body.markdown ?? ''
}

/**
 * Parse one file version and index its text. Safe to run more than once: it
 * skips files that changed or were deleted since the job was queued.
 */
export async function runExtraction(msg: ExtractMessage) {
  const db = getDb()
  const [n] = await db
    .select()
    .from(node)
    .where(and(eq(node.id, msg.nodeId), isNull(node.deletedAt)))
  if (!n || n.kind !== 'file' || n.version !== msg.version || !n.r2Key) return { skipped: true as const }
  const ext = PARSEABLE[extOf(n.name)]
  if (!ext) return { skipped: true as const }

  const key = await contextDevKeyFor(n.workspaceId)
  if (!key) {
    await setStatus(n.id, 'failed', 'Text extraction needs Context.dev. Connect it with an API key under Connections.')
    return { skipped: true as const }
  }
  const obj = await getEnv().FILES.get(n.r2Key)
  if (!obj) throw new ExtractError('The stored file is missing.', false)
  if (obj.size > MAX_PARSE_BYTES) {
    await setStatus(n.id, 'failed', 'Files over 50 MB are stored but not parsed.')
    return { skipped: true as const }
  }
  // OCR only runs on PDF pages without a text layer, so it's safe to leave on.
  const markdown = (await callParse(key, await obj.arrayBuffer(), ext, n.mimeType, msg.ocr ?? true)).trim()

  // The file may have changed while we were parsing.
  const [still] = await db.select({ version: node.version }).from(node).where(eq(node.id, n.id))
  if (still?.version !== n.version) return { skipped: true as const }

  const pages = ext === 'pdf' ? (markdown.match(/<!-- page \d+ -->/g)?.length ?? null) : null
  let r2Key: string | null = null
  if (markdown.length > D1_TEXT_CAP) {
    r2Key = `${n.r2Key}.md`
    await getEnv().FILES.put(r2Key, markdown, { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } })
  }
  const stored = markdown.slice(0, D1_TEXT_CAP)
  await db
    .insert(nodeText)
    .values({ nodeId: n.id, version: n.version, markdown: stored, r2Key, chars: markdown.length, pages })
    .onConflictDoUpdate({
      target: nodeText.nodeId,
      set: { version: n.version, markdown: stored, r2Key, chars: markdown.length, pages, createdAt: new Date() },
    })
  await setStatus(n.id, 'done', null, markdown.length)
  await ftsReindex([n])
  await vectorIndex(n, stored)
  publishSystemChange(n.workspaceId, { spaceId: n.spaceId, path: n.path, action: 'text_extracted' })
  return { chars: markdown.length, pages }
}

/** Queue consumer: retry transient failures, record permanent ones on the file. */
export async function handleExtractBatch(batch: MessageBatch<ExtractMessage>) {
  for (const message of batch.messages) {
    try {
      await runExtraction(message.body)
      message.ack()
    } catch (err) {
      const e = err instanceof ExtractError ? err : new ExtractError(String((err as Error)?.message ?? err), true)
      if (e.retry && message.attempts < 4) {
        message.retry({ delaySeconds: 30 * message.attempts })
      } else {
        await setStatus(message.body.nodeId, 'failed', e.message).catch(() => {})
        message.ack()
      }
    }
  }
}

/** The extracted text for a file's current version, if any (full text, from R2 when long). */
export async function getFileText(n: { id: string; version: number }) {
  const [t] = await getDb().select().from(nodeText).where(eq(nodeText.nodeId, n.id))
  if (!t || t.version !== n.version) return null
  let markdown = t.markdown
  if (t.r2Key) {
    const obj = await getEnv().FILES.get(t.r2Key)
    if (obj) markdown = await obj.text()
  }
  return { markdown, chars: t.chars, pages: t.pages }
}
