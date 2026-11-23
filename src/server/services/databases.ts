import { and, asc, eq, isNull, inArray } from 'drizzle-orm'
import type { Actor } from '../actor'
import { TEAM, canReadSpace, canWriteSpace } from '../actor'
import { newId } from '../crypto'
import { getDb, node } from '../db'
import { AppError, forbidden, invalid, notFound } from '../errors'
import { displayPath, parsePath } from '../paths'
import type { DbRows, DbSchema, DbStatement, DbTable, DbValue } from '../databases/object'
import { databaseStub, dbAppError, destroyDatabase } from '../databases/store'
import { quoteIdent, sqlPreview } from '../databases/sql'
import { accessView, canSee } from './access'
import * as files from './files'
import { recordRead } from './reads'

/**
 * Databases in a space. A database is an entry like /team/customers/customers.db:
 * a real SQLite database that flows and agents keep up to date and query,
 * instead of rewriting a doc. The entry carries the path, description and
 * access rules; the rows live in the entry's own storage object.
 *
 * Anyone who can see the entry can query it. Members and admins can change it.
 */

/** A value as agents and the app get it: blobs become a short label. */
export type Cell = string | number | null

const cell = (v: DbValue): Cell => (v instanceof ArrayBuffer ? `[blob, ${v.byteLength} bytes]` : v)

function present(r: DbRows) {
  return { columns: r.columns, rows: r.rows.map((row) => row.map(cell)), truncated: r.truncated }
}

/** One line per table: "customers (132 rows): id INTEGER PK, name TEXT". Saved on the entry and indexed for search. */
export function summarize(schema: DbSchema) {
  if (!schema.tables.length) return ''
  return schema.tables
    .map((t) => {
      const cols = t.columns.map((c) => `${c.name}${c.type ? ` ${c.type}` : ''}${c.primaryKey ? ' PK' : ''}`).join(', ')
      const count = t.kind === 'view' ? ' (view)' : t.rows === null ? '' : ` (${t.rows.toLocaleString('en-US')} ${t.rows === 1 ? 'row' : 'rows'})`
      return `${t.name}${count}: ${cols}`
    })
    .join('\n')
}

function tableInfo(t: DbTable) {
  return {
    name: t.name,
    ...(t.kind !== 'table' ? { kind: t.kind } : {}),
    rows: t.rows,
    columns: t.columns.map((c) => ({
      name: c.name,
      type: c.type || 'ANY',
      ...(c.primaryKey ? { primaryKey: true } : {}),
      ...(c.notNull ? { notNull: true } : {}),
      ...(c.default !== null ? { default: c.default } : {}),
    })),
    ...(t.indexes.length ? { indexes: t.indexes.map((i) => ({ columns: i.columns, ...(i.unique ? { unique: true } : {}) })) } : {}),
    ...(t.foreignKeys.length ? { foreignKeys: t.foreignKeys.map((f) => `${f.column} -> ${f.table}${f.to ? `.${f.to}` : ''}`) } : {}),
  }
}

async function requireDatabase(actor: Actor, fullPath: string) {
  let r = await files.resolve(actor, fullPath)
  // "customers" finds "customers.db".
  if (!r.isRoot && !r.node && files.databasePath(fullPath) !== fullPath.trim()) r = await files.resolve(actor, files.databasePath(fullPath))
  if (r.isRoot || !r.node) {
    throw notFound(`Database "${fullPath}"`, 'db_list shows the databases you can use. Create one with db_create.')
  }
  if (r.node.kind !== 'database') {
    throw invalid(`${displayPath(actor, r.node.spaceId, r.node.path)} is a ${r.node.kind}, not a database.`, 'db_list shows the databases you can use.')
  }
  return r.node
}

function assertCanWrite(actor: Actor, n: files.NodeRow) {
  if (!canWriteSpace(actor, n.spaceId)) {
    throw forbidden(
      actor.role === 'viewer' ? 'Your role is read-only, so you can query this database but not change it.' : "You can't write to that space.",
      actor.role === 'viewer' ? 'Ask a workspace admin to make you a member.' : undefined,
    )
  }
}

async function afterWrite(actor: Actor, n: files.NodeRow, schema: DbSchema, change: { statements: number; changes: number; preview?: string; quiet?: boolean }) {
  return files.recordDatabaseWrite(actor, n, { summary: summarize(schema), size: schema.sizeBytes, ...change })
}

export async function createDatabase(
  actor: Actor,
  fullPath: string,
  opts: { description?: string; sql?: string; ifNotExists?: boolean } = {},
) {
  if (opts.ifNotExists) {
    const p = parsePath(actor, files.databasePath(fullPath))
    if (canReadSpace(actor, p.spaceId) && p.path !== '/') {
      const r = await files.resolve(actor, files.databasePath(fullPath))
      if (r.node?.kind === 'database') return { ...(await getSchema(actor, fullPath)), created: false }
    }
  }
  // Run the first schema before the entry exists, so SQL that doesn't parse leaves nothing behind.
  const taken = await files.resolve(actor, files.databasePath(fullPath))
  const id = newId('n')
  let schema: DbSchema = { tables: [], sizeBytes: 0 }
  if (opts.sql?.trim() && !taken.node) {
    const res = await databaseStub(id).exec([{ sql: opts.sql }])
    if (!res.ok) {
      await destroyDatabase(id).catch(() => {})
      throw dbAppError(res.error)
    }
    schema = res.schema
  }
  let row: files.NodeRow
  try {
    row = await files.createDatabaseNode(actor, fullPath, { id, description: opts.description })
  } catch (err) {
    await destroyDatabase(id).catch(() => {})
    throw err
  }
  const updated = schema.tables.length ? await afterWrite(actor, row, schema, { statements: 0, changes: 0, quiet: true }) : row
  return { ...describeDatabase(actor, updated, schema), created: true }
}

function describeDatabase(actor: Actor, n: files.NodeRow, schema: DbSchema) {
  return {
    path: displayPath(actor, n.spaceId, n.path),
    description: n.description,
    sizeBytes: schema.sizeBytes,
    updatedAt: n.updatedAt.getTime(),
    tables: schema.tables.map(tableInfo),
  }
}

export async function getSchema(actor: Actor, fullPath: string) {
  const n = await requireDatabase(actor, fullPath)
  return describeDatabase(actor, n, await databaseStub(n.id).schema())
}

export async function queryDatabase(
  actor: Actor,
  fullPath: string,
  sql: string,
  params?: unknown[],
  opts: { maxRows?: number; /** Don't count it as a read (an artifact refreshing its data). */ quiet?: boolean } = {},
) {
  const n = await requireDatabase(actor, fullPath)
  const res = await databaseStub(n.id).query(String(sql ?? ''), params, { maxRows: Math.max(1, Math.min(opts.maxRows ?? 200, 5000)) })
  if (!res.ok) throw dbAppError(res.error)
  if (!opts.quiet) recordRead(actor, n)
  return { path: displayPath(actor, n.spaceId, n.path), ...present(res) }
}

export type ExecInput = string | { sql: string; params?: unknown[] } | (string | { sql: string; params?: unknown[] })[]

function statementsOf(input: ExecInput, params?: unknown[]): DbStatement[] {
  const list = Array.isArray(input) ? input : [input]
  const out = list.map((s) => (typeof s === 'string' ? { sql: s } : { sql: String(s?.sql ?? ''), params: s?.params }))
  if (params?.length) {
    if (out.length !== 1) throw invalid('Top-level params only work with one statement.', 'Pass statements: [{ sql, params }, ...] instead.')
    out[0] = { ...out[0]!, params }
  }
  return out
}

/**
 * Change a database: any SQL, run as one transaction. `dryRun` runs it and
 * rolls back, which is how flow test runs check their SQL without keeping it.
 */
export async function execDatabase(
  actor: Actor,
  fullPath: string,
  input: ExecInput,
  opts: { params?: unknown[]; dryRun?: boolean; maxRows?: number } = {},
) {
  const n = await requireDatabase(actor, fullPath)
  assertCanWrite(actor, n)
  const statements = statementsOf(input, opts.params)
  const res = await databaseStub(n.id).exec(statements, { dryRun: opts.dryRun, maxRows: Math.max(1, Math.min(opts.maxRows ?? 200, 5000)) })
  if (!res.ok) throw dbAppError(res.error)
  if (res.wrote && !res.dryRun) {
    await afterWrite(actor, n, res.schema, { statements: res.results.length, changes: res.changes, preview: sqlPreview(statements.map((s) => s.sql).join('; ')) })
  }
  return {
    path: displayPath(actor, n.spaceId, n.path),
    changes: res.changes,
    ...(res.dryRun ? { dryRun: true } : {}),
    results: res.results.map((r) => ({ sql: r.sql, changes: r.changes, ...(r.columns.length ? present(r) : {}) })),
    tables: res.schema.tables.map((t) => ({ name: t.name, rows: t.rows })),
  }
}

const MAX_INSERT_ROWS = 5000

/** Add rows to a table from objects. With `upsertOn`, rows whose key matches update the existing row. */
export async function insertRows(
  actor: Actor,
  fullPath: string,
  table: string,
  rows: Record<string, unknown>[],
  opts: { upsertOn?: string[]; onConflict?: 'error' | 'ignore'; dryRun?: boolean } = {},
) {
  const n = await requireDatabase(actor, fullPath)
  assertCanWrite(actor, n)
  if (!table?.trim()) throw invalid('Pass the table to insert into.')
  if (!Array.isArray(rows) || !rows.length) throw invalid('Pass rows: an array of objects keyed by column name.')
  if (rows.length > MAX_INSERT_ROWS) {
    throw new AppError('too_large', `That's ${rows.length} rows. One call inserts at most ${MAX_INSERT_ROWS}.`, { hint: 'Send them in batches.' })
  }
  if (rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) throw invalid('Each row must be an object keyed by column name.')
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const keys = opts.upsertOn ?? []
  const missing = keys.filter((k) => !columns.includes(k))
  if (missing.length) throw invalid(`upsertOn names ${missing.join(', ')}, which the rows don't have.`)
  const values = rows.map((r) => columns.map((c) => (r[c] === undefined ? null : r[c])))
  const res = await databaseStub(n.id).insert(table, columns, values, { upsertOn: keys, onConflict: opts.onConflict, dryRun: opts.dryRun })
  if (!res.ok) throw dbAppError(res.error)
  if (res.changes > 0 && !res.dryRun) {
    await afterWrite(actor, n, res.schema, {
      statements: 1,
      changes: res.changes,
      preview: `${keys.length ? 'Upsert' : 'Insert'} ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} into ${table}`,
    })
  }
  return {
    path: displayPath(actor, n.spaceId, n.path),
    table,
    changes: res.changes,
    ...(res.dryRun ? { dryRun: true } : {}),
    rows: res.schema.tables.find((t) => t.name === table)?.rows ?? null,
  }
}

/** Databases the actor can see, with the saved summary of their tables. Doesn't wake any database. */
export async function listDatabases(actor: Actor, opts: { pathPrefix?: string; limit?: number } = {}) {
  const spaces = [TEAM, actor.userId].filter((id) => canReadSpace(actor, id))
  const rows = await getDb()
    .select()
    .from(node)
    .where(and(eq(node.workspaceId, actor.workspaceId), inArray(node.spaceId, spaces), eq(node.kind, 'database'), isNull(node.deletedAt)))
    .orderBy(asc(node.path))
    .limit(1000)
  const view = await accessView(actor)
  const prefix = opts.pathPrefix?.trim().replace(/\/+$/, '')
  return rows
    .filter((r) => canSee(view, r.spaceId, r.path))
    .map((r) => ({
      path: displayPath(actor, r.spaceId, r.path),
      description: r.description,
      tables: (r.content ?? '').split('\n').filter(Boolean),
      sizeBytes: r.size,
      updatedAt: r.updatedAt.getTime(),
    }))
    .filter((r) => !prefix || r.path === prefix || r.path.startsWith(prefix + '/'))
    .slice(0, Math.min(opts.limit ?? 100, 500))
}

// ------------------------------------------------------------------ the app's grid

export type BrowseOpts = { table?: string | null; limit?: number; offset?: number; orderBy?: string | null; desc?: boolean; search?: string | null }

/** One page of one table, plus every table's shape, for the database page. */
export async function browseDatabase(actor: Actor, fullPath: string, opts: BrowseOpts = {}) {
  // Not counted here: the page loader also runs for link preloads (files.markRead counts real opens).
  const n = await requireDatabase(actor, fullPath)
  const res = await databaseStub(n.id).browse(opts.table ?? null, opts)
  // The saved summary can go stale if a write's bookkeeping was interrupted; opening the page puts it right.
  const summary = summarize(res.schema)
  if (summary !== (n.content ?? '') && canWriteSpace(actor, n.spaceId)) {
    await files.recordDatabaseWrite(actor, n, { summary, size: res.schema.sizeBytes, statements: 0, changes: 0, refreshOnly: true }).catch(() => {})
  }
  return {
    node: files.nodeInfo(actor, n),
    sizeBytes: res.schema.sizeBytes,
    tables: res.schema.tables.map((t) => ({
      name: t.name,
      kind: t.kind,
      rows: t.rows,
      editable: t.hasRowid,
      sql: t.sql,
      columns: t.columns.map((c) => ({ name: c.name, type: c.type, primaryKey: c.primaryKey > 0, notNull: c.notNull, default: c.default })),
      indexes: t.indexes,
      foreignKeys: t.foreignKeys,
    })),
    table: res.table,
    columns: res.columns,
    rows: res.rows.map((row) => row.map(cell)),
    rowids: res.rowids,
    total: res.total,
    error: res.error ?? null,
  }
}

/** Values typed into the grid arrive as text; store numbers as numbers where the column wants them. */
function coerce(value: string | number | null, type: string): string | number | null {
  if (value === null || value === '') return null
  if (typeof value === 'number') return value
  if (/INT|REAL|FLOA|DOUB|NUM|DEC/i.test(type) && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  return value
}

async function editableTable(actor: Actor, fullPath: string, table: string) {
  const n = await requireDatabase(actor, fullPath)
  assertCanWrite(actor, n)
  const schema = await databaseStub(n.id).schema({ counts: false })
  const t = schema.tables.find((x) => x.name === table)
  if (!t) throw notFound(`Table "${table}"`)
  return { n, t }
}

export async function updateCell(actor: Actor, fullPath: string, table: string, rowid: number, column: string, value: string | number | null) {
  const { t } = await editableTable(actor, fullPath, table)
  if (!t.hasRowid) throw invalid(`Rows in ${table} can't be edited here.`, 'Use the SQL box instead.')
  const col = t.columns.find((c) => c.name === column)
  if (!col) throw notFound(`Column "${column}"`)
  return execDatabase(actor, fullPath, { sql: `UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = ? WHERE rowid = ?`, params: [coerce(value, col.type), rowid] })
}

export async function addRow(actor: Actor, fullPath: string, table: string, values: Record<string, string | number | null>) {
  const { t } = await editableTable(actor, fullPath, table)
  const entries = t.columns.map((c) => [c, coerce(values[c.name] ?? null, c.type)] as const).filter(([, v]) => v !== null)
  const sql = entries.length
    ? `INSERT INTO ${quoteIdent(table)} (${entries.map(([c]) => quoteIdent(c.name)).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`
    : `INSERT INTO ${quoteIdent(table)} DEFAULT VALUES`
  return execDatabase(actor, fullPath, { sql, params: entries.map(([, v]) => v) })
}

export async function deleteRows(actor: Actor, fullPath: string, table: string, rowids: number[]) {
  const { t } = await editableTable(actor, fullPath, table)
  if (!t.hasRowid) throw invalid(`Rows in ${table} can't be deleted here.`, 'Use the SQL box instead.')
  const ids = rowids.map(Number).filter((x) => Number.isFinite(x)).slice(0, 90)
  if (!ids.length) throw invalid('Pick at least one row.')
  return execDatabase(actor, fullPath, { sql: `DELETE FROM ${quoteIdent(table)} WHERE rowid IN (${ids.map(() => '?').join(', ')})`, params: ids })
}

const COLUMN_TYPES = ['TEXT', 'INTEGER', 'REAL'] as const
export type NewColumn = { name: string; type: (typeof COLUMN_TYPES)[number]; primaryKey?: boolean; unique?: boolean }

function columnDef(c: NewColumn) {
  const name = String(c.name ?? '').trim()
  if (!name) throw invalid('Every column needs a name.')
  const type = COLUMN_TYPES.includes(c.type) ? c.type : 'TEXT'
  return `${quoteIdent(name)} ${type}${c.primaryKey ? ' PRIMARY KEY' : c.unique ? ' UNIQUE' : ''}`
}

export async function createTable(actor: Actor, fullPath: string, table: string, columns: NewColumn[]) {
  const name = String(table ?? '').trim()
  if (!name) throw invalid('Give the table a name.')
  if (!columns.length) throw invalid('Add at least one column.')
  if (columns.filter((c) => c.primaryKey).length > 1) throw invalid('Only one column can be the key here.', 'Use the SQL box for a key made of several columns.')
  return execDatabase(actor, fullPath, `CREATE TABLE ${quoteIdent(name)} (${columns.map(columnDef).join(', ')})`)
}

export async function addColumn(actor: Actor, fullPath: string, table: string, column: NewColumn) {
  return execDatabase(actor, fullPath, `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${columnDef({ ...column, primaryKey: false, unique: false })}`)
}

export async function dropTable(actor: Actor, fullPath: string, table: string) {
  const { t } = await editableTable(actor, fullPath, table)
  return execDatabase(actor, fullPath, `DROP ${t.kind === 'view' ? 'VIEW' : 'TABLE'} ${quoteIdent(table)}`)
}

/**
 * Run what someone typed in the SQL box. A single read goes through the
 * read-only path, so read-only members can use the box too; anything else is a write.
 */
export async function runConsole(actor: Actor, fullPath: string, sql: string) {
  const n = await requireDatabase(actor, fullPath)
  if (canWriteSpace(actor, n.spaceId)) {
    const r = await execDatabase(actor, fullPath, sql, { maxRows: 500 })
    const last = [...r.results].reverse().find((x) => 'columns' in x) as ({ columns: string[]; rows: Cell[][]; truncated: boolean } & { sql: string }) | undefined
    return { changes: r.changes, statements: r.results.length, columns: last?.columns ?? [], rows: last?.rows ?? [], truncated: last?.truncated ?? false }
  }
  const r = await queryDatabase(actor, fullPath, sql, undefined, { maxRows: 500 })
  return { changes: 0, statements: 1, columns: r.columns, rows: r.rows, truncated: r.truncated }
}

function csvCell(v: Cell) {
  if (v === null) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** A whole table as CSV, streamed a page at a time. */
export async function exportCsv(actor: Actor, nodeId: string, table: string) {
  const n = await files.getNodeById(actor, nodeId)
  if (n.kind !== 'database') throw invalid('That is not a database.')
  const stub = databaseStub(n.id)
  const schema = await stub.schema({ counts: false })
  const t = schema.tables.find((x) => x.name === table)
  if (!t) throw notFound(`Table "${table}"`)
  const select = `SELECT * FROM ${quoteIdent(t.name)}${t.hasRowid ? ' ORDER BY rowid' : ''} LIMIT ? OFFSET ?`
  const enc = new TextEncoder()
  let offset = 0
  let header = false
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const page = await stub.query(select, [2000, offset], { maxRows: 2000, maxBytes: 8_000_000 })
      if (!page.ok) return controller.error(new Error(page.error.message))
      if (!header) {
        controller.enqueue(enc.encode((page.columns.length ? page.columns : t.columns.map((c) => c.name)).map(csvCell).join(',') + '\n'))
        header = true
      }
      if (page.rows.length) controller.enqueue(enc.encode(page.rows.map((r) => r.map((v) => csvCell(cell(v))).join(',')).join('\n') + '\n'))
      offset += page.rows.length
      if (!page.rows.length || (page.rows.length < 2000 && !page.truncated) || offset >= 500_000) controller.close()
    },
  })
  return { body, filename: `${n.name.replace(/\.(db|sqlite3?)$/i, '')}-${t.name}.csv` }
}
