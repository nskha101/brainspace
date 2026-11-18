import { getEnv } from '../env'
import { AppError } from '../errors'
import type { BrainDatabase, DbError, DbTable, DbValue } from './object'
import { quoteIdent } from './sql'

/** The most a database can hold and still be copied (copy, promote with a kept copy). */
export const MAX_COPY_BYTES = 50 * 1024 * 1024

/** The storage object behind a database entry. Keyed by node id, so moves and renames don't touch it. */
export function databaseStub(nodeId: string): DurableObjectStub<BrainDatabase> {
  const ns = getEnv().DATABASES
  return ns.get(ns.idFromName(nodeId))
}

export function dbAppError(e: DbError) {
  return new AppError(e.code, e.message, { hint: e.hint })
}

/** Tables ordered so one that others reference with a foreign key is filled before they are. */
function parentsFirst(tables: DbTable[]) {
  const byName = new Map(tables.map((t) => [t.name, t]))
  const out: DbTable[] = []
  const seen = new Set<string>()
  const visit = (t: DbTable) => {
    if (seen.has(t.name)) return
    seen.add(t.name)
    for (const fk of t.foreignKeys) {
      const parent = byName.get(fk.table)
      if (parent) visit(parent)
    }
    out.push(t)
  }
  tables.forEach(visit)
  return out
}

/** Rebuild one database inside another, empty one: tables, rows, then indexes, views and triggers. */
export async function copyDatabaseData(fromNodeId: string, toNodeId: string) {
  const src = databaseStub(fromNodeId)
  const dest = databaseStub(toNodeId)
  const dump = await src.dumpSchema()
  if (dump.sizeBytes > MAX_COPY_BYTES) {
    throw new AppError('too_large', `This database is ${(dump.sizeBytes / 1e6).toFixed(0)} MB. Copies are limited to ${MAX_COPY_BYTES / 1024 / 1024} MB.`, {
      hint: 'Move it instead, or create a new database and copy the tables you need with SQL.',
    })
  }
  if (!dump.tables.length && !dump.after.length) return dest.schema()
  const made = await dest.exec(dump.tables.map((sql) => ({ sql })))
  if (!made.ok) throw dbAppError(made.error)
  const { tables } = await src.schema({ counts: false })
  for (const t of parentsFirst(tables)) {
    if (t.kind === 'view') continue
    const names = t.columns.map((c) => c.name)
    // Virtual tables (FTS5) keep their rows under rowid; carry it over so matches line up.
    const withRowid = t.kind === 'virtual'
    const select = `SELECT ${withRowid ? 'rowid, ' : ''}${names.map(quoteIdent).join(', ')} FROM ${quoteIdent(t.name)} LIMIT ? OFFSET ?`
    for (let offset = 0; ; ) {
      const page = await src.query(select, [2000, offset], { maxRows: 2000, maxBytes: 20_000_000 })
      if (!page.ok) throw dbAppError(page.error)
      if (!page.rows.length) break
      const res = await dest.insert(t.name, withRowid ? ['rowid', ...names] : names, page.rows as DbValue[][])
      if (!res.ok) throw dbAppError(res.error)
      // A page can come back short when it hits the size cap, so step by what arrived.
      offset += page.rows.length
      if (page.rows.length < 2000 && !page.truncated) break
    }
  }
  if (dump.after.length) {
    const rest = await dest.exec(dump.after.map((sql) => ({ sql })))
    if (!rest.ok) throw dbAppError(rest.error)
  }
  return dest.schema()
}

export async function destroyDatabase(nodeId: string) {
  await databaseStub(nodeId).destroy()
}
