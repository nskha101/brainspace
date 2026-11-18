import { DurableObject } from 'cloudflare:workers'
import { isTransactionControl, quoteIdent, splitStatements, sqlPreview, startsLikeRead } from './sql'

/** A value SQLite stores. Blobs travel as ArrayBuffers. */
export type DbValue = string | number | null | ArrayBuffer

export type DbStatement = { sql: string; params?: unknown[] }

export type DbError = { code: 'invalid' | 'too_large' | 'conflict'; message: string; hint?: string }

export type DbRows = {
  columns: string[]
  rows: DbValue[][]
  /** More rows matched than were returned. */
  truncated: boolean
  rowsRead: number
  /** Storage writes, index entries included. Zero means the statement only read. */
  rowsWritten: number
  /** Rows inserted, updated or deleted. */
  changes: number
}

export type DbColumn = { name: string; type: string; notNull: boolean; primaryKey: number; default: string | null; hidden?: boolean }

export type DbTable = {
  name: string
  kind: 'table' | 'view' | 'virtual'
  columns: DbColumn[]
  /** Null for views and when counting was skipped. */
  rows: number | null
  /** False for WITHOUT ROWID tables, views and virtual tables: rows there can't be addressed by rowid. */
  hasRowid: boolean
  sql: string | null
  indexes: { name: string; unique: boolean; columns: string[] }[]
  foreignKeys: { column: string; table: string; to: string | null }[]
}

export type DbSchema = { tables: DbTable[]; sizeBytes: number }

export type QueryResult = ({ ok: true } & DbRows) | { ok: false; error: DbError }

export type ExecResult =
  | { ok: true; results: (DbRows & { sql: string })[]; changes: number; wrote: boolean; schema: DbSchema; dryRun: boolean }
  | { ok: false; error: DbError; statement?: number }

type Caps = { maxRows: number; maxBytes: number }

const DEFAULT_CAPS: Caps = { maxRows: 1000, maxBytes: 900_000 }
/** Databases stop growing here. The platform's own ceiling is 10 GB per object. */
export const MAX_DB_BYTES = 1024 * 1024 * 1024
const MAX_STATEMENTS = 200
const MAX_PARAMS = 100

/** Leaves out SQLite's own tables and the ones the platform keeps for itself. */
const VISIBLE = "name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE '\\_\\_miniflare%' ESCAPE '\\'"

class Rollback extends Error {
  constructor(public detail: DbError | null) {
    super('rollback')
  }
}

function bind(params: unknown[] | undefined): DbValue[] {
  return (params ?? []).map((p) => {
    if (p === undefined || p === null) return null
    if (typeof p === 'boolean') return p ? 1 : 0
    if (typeof p === 'number' || typeof p === 'string') return p
    if (p instanceof ArrayBuffer) return p
    if (ArrayBuffer.isView(p)) return p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength) as ArrayBuffer
    // Objects and arrays are stored as JSON text, which json_extract() can read back.
    return JSON.stringify(p)
  })
}

function sizeOf(v: unknown) {
  if (v === null || v === undefined) return 4
  if (typeof v === 'string') return v.length + 2
  if (v instanceof ArrayBuffer) return v.byteLength
  return 8
}

/** SQLite's messages are good; a few get a hint about what to do next. */
function sqlError(err: unknown, stmt?: string): DbError {
  const raw = String((err as Error)?.message ?? err).replace(/: SQLITE_[A-Z_]+(?: \(extended: [A-Z_]+\))?$/, '')
  const about = stmt ? ` (in: ${sqlPreview(stmt, 120)})` : ''
  let hint: string | undefined
  if (/no such table/i.test(raw)) hint = 'Check the table names with db_schema.'
  else if (/no such column/i.test(raw)) hint = 'Check the column names with db_schema. String values go in single quotes or, better, in params.'
  else if (/UNIQUE constraint failed|PRIMARY KEY/i.test(raw)) hint = 'A row with that key already exists. Use INSERT ... ON CONFLICT (...) DO UPDATE, or db_insert with upsertOn.'
  else if (/NOT NULL constraint failed/i.test(raw)) hint = 'That column needs a value.'
  else if (/FOREIGN KEY constraint failed/i.test(raw)) hint = 'A row points at a row that is not there. Insert the row it refers to first, or delete the rows that refer to it before deleting it.'
  else if (/syntax error/i.test(raw)) hint = 'This is SQLite. Check the statement, and pass values through params instead of building them into the SQL.'
  else if (/not authorized|SQLITE_AUTH/i.test(raw)) hint = "That statement isn't allowed in a Brainspace database (ATTACH, some PRAGMAs and internal tables are off limits)."
  else if (/Wrong number of parameter bindings/i.test(raw)) hint = 'Pass one value in params for each ? in the statement.'
  return { code: 'invalid', message: `${raw}${about}`, hint }
}

/**
 * One SQLite database, kept in this object's own storage. Brainspace creates
 * one per database entry in a space (named by the node id), so moving or
 * renaming the entry never touches the data. Callers check who may read or
 * write before they get here; this class only runs SQL and reports what's inside.
 */
export class BrainDatabase extends DurableObject {
  private get sql() {
    return this.ctx.storage.sql
  }

  private collect(cursor: SqlStorageCursor<Record<string, SqlStorageValue>>, caps: Caps, drain: boolean): DbRows {
    const columns = cursor.columnNames
    const rows: DbValue[][] = []
    let bytes = 0
    let truncated = false
    for (const row of cursor.raw()) {
      if (truncated) {
        if (!drain) break
        continue
      }
      if (rows.length >= caps.maxRows) {
        truncated = true
        if (!drain) break
        continue
      }
      for (const v of row) bytes += sizeOf(v)
      if (bytes > caps.maxBytes && rows.length > 0) {
        truncated = true
        if (!drain) break
        continue
      }
      rows.push(row as DbValue[])
    }
    return { columns, rows, truncated, rowsRead: cursor.rowsRead, rowsWritten: cursor.rowsWritten, changes: 0 }
  }

  private totalChanges() {
    return Number(this.sql.exec<{ n: number }>('SELECT total_changes() AS n').one().n)
  }

  /**
   * Rows the statement that just ran inserted, updated or deleted itself, not
   * counting what its triggers did. `before` is totalChanges() from before it
   * ran: changes() keeps its old value after a statement that changed nothing.
   */
  private changesSince(before: number) {
    const r = this.sql.exec<{ t: number; c: number }>('SELECT total_changes() AS t, changes() AS c').one()
    return Number(r.t) > before ? Number(r.c) : 0
  }

  /** One read-only statement. Anything that would write is rolled back and refused. */
  async query(sql: string, params?: unknown[], caps: Partial<Caps> = {}): Promise<QueryResult> {
    const stmts = splitStatements(sql)
    if (!stmts.length) return { ok: false, error: { code: 'invalid', message: 'The SQL is empty.' } }
    if (stmts.length > 1) {
      return { ok: false, error: { code: 'invalid', message: `db_query takes one statement, and this has ${stmts.length}.`, hint: 'Run them one at a time, or use db_exec for a script that changes data.' } }
    }
    const stmt = stmts[0]!
    const readOnly: DbError = { code: 'invalid', message: 'db_query only reads.', hint: 'Use db_exec for statements that change data or the schema.' }
    if (!startsLikeRead(stmt)) return { ok: false, error: readOnly }
    const limits = { ...DEFAULT_CAPS, ...caps }
    let out: DbRows | undefined
    try {
      this.ctx.storage.transactionSync(() => {
        const cursor = this.sql.exec(stmt, ...bind(params))
        out = this.collect(cursor, limits, false)
        if (cursor.rowsWritten > 0) throw new Rollback(readOnly)
      })
    } catch (err) {
      if (err instanceof Rollback) return { ok: false, error: err.detail ?? readOnly }
      return { ok: false, error: sqlError(err) }
    }
    return { ok: true, ...out! }
  }

  /**
   * Run statements in order as one transaction: all of them apply, or none do.
   * `dryRun` runs everything and then rolls back, for flow test runs.
   */
  async exec(statements: DbStatement[], opts: { dryRun?: boolean } & Partial<Caps> = {}): Promise<ExecResult> {
    const list: DbStatement[] = []
    for (const s of statements) {
      const parts = splitStatements(String(s?.sql ?? ''))
      if (parts.length > 1 && s.params?.length) {
        return { ok: false, error: { code: 'invalid', message: 'params only work with a single statement.', hint: 'Pass statements: [{ sql, params }, ...] with one statement each.' } }
      }
      for (const p of parts) list.push({ sql: p, params: s.params })
    }
    if (!list.length) return { ok: false, error: { code: 'invalid', message: 'The SQL is empty.' } }
    if (list.length > MAX_STATEMENTS) {
      return { ok: false, error: { code: 'too_large', message: `That's ${list.length} statements. One call runs at most ${MAX_STATEMENTS}.`, hint: 'Insert many rows with db_insert, or split the script.' } }
    }
    for (const [i, s] of list.entries()) {
      if (isTransactionControl(s.sql)) {
        return { ok: false, statement: i, error: { code: 'invalid', message: `${sqlPreview(s.sql, 40)} isn't needed.`, hint: 'Every db_exec call is already one transaction: all its statements apply, or none do. Remove BEGIN, COMMIT and SAVEPOINT.' } }
      }
      if ((s.params?.length ?? 0) > MAX_PARAMS) {
        return { ok: false, statement: i, error: { code: 'too_large', message: `A statement takes at most ${MAX_PARAMS} params.`, hint: 'Use db_insert for many rows.' } }
      }
    }
    const limits = { ...DEFAULT_CAPS, ...opts }
    const results: (DbRows & { sql: string })[] = []
    let at = 0
    let schema: DbSchema | undefined
    try {
      this.ctx.storage.transactionSync(() => {
        for (const [i, s] of list.entries()) {
          at = i
          const before = this.totalChanges()
          const cursor = this.sql.exec(s.sql, ...bind(s.params))
          const rows = this.collect(cursor, limits, true)
          results.push({ sql: sqlPreview(s.sql), ...rows, changes: this.changesSince(before) })
        }
        at = -1
        if (this.sql.databaseSize > MAX_DB_BYTES) {
          throw new Rollback({ code: 'too_large', message: 'This would take the database past 1 GB, the most one database can hold.', hint: 'Delete rows you no longer need, or split the data across databases.' })
        }
        schema = this.readSchema(true)
        if (opts.dryRun) throw new Rollback(null)
      })
    } catch (err) {
      if (err instanceof Rollback) {
        if (err.detail) return { ok: false, error: err.detail }
      } else {
        return { ok: false, error: sqlError(err, at >= 0 ? list[at]?.sql : undefined), ...(at >= 0 ? { statement: at } : {}) }
      }
    }
    return {
      ok: true,
      results,
      changes: results.reduce((n, r) => n + r.changes, 0),
      wrote: results.some((r) => r.rowsWritten > 0),
      schema: schema!,
      dryRun: !!opts.dryRun,
    }
  }

  async schema(opts: { counts?: boolean } = {}): Promise<DbSchema> {
    return this.readSchema(opts.counts !== false)
  }

  private readSchema(counts: boolean): DbSchema {
    type Master = { name: string; type: string; tbl_name: string; sql: string | null }
    const master = this.sql
      .exec<Master>(`SELECT name, type, tbl_name, sql FROM sqlite_schema WHERE ${VISIBLE} ORDER BY name`)
      .toArray()
    // Virtual tables (FTS5 and the like) keep their data in shadow tables nobody should touch directly.
    const virtual = master.filter((m) => m.type === 'table' && /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(m.sql ?? '')).map((m) => m.name)
    const isShadow = (name: string) => virtual.some((v) => name !== v && name.startsWith(`${v}_`))
    const tables: DbTable[] = []
    for (const m of master) {
      if ((m.type !== 'table' && m.type !== 'view') || isShadow(m.name)) continue
      const kind = m.type === 'view' ? 'view' : virtual.includes(m.name) ? 'virtual' : 'table'
      type Info = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number }
      let info: Info[] = []
      try {
        info = this.sql.exec<Info>(`SELECT name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(${quoteIdent(m.name)})`).toArray()
      } catch {
        // A view over a dropped table can't be described; list it without columns.
      }
      const columns = info
        // hidden = 1 marks a virtual table's internal columns.
        .filter((c) => c.hidden !== 1)
        .map((c) => ({ name: c.name, type: c.type || '', notNull: !!c.notnull, primaryKey: c.pk, default: c.dflt_value, ...(c.hidden ? { hidden: true } : {}) }))
      let rows: number | null = null
      if (counts && kind !== 'view') {
        try {
          rows = Number(this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM ${quoteIdent(m.name)}`).one().n)
        } catch {
          rows = null
        }
      }
      const indexes: DbTable['indexes'] = []
      const foreignKeys: DbTable['foreignKeys'] = []
      if (kind === 'table') {
        try {
          for (const ix of this.sql.exec<{ name: string; unique: number }>(`SELECT name, "unique" FROM pragma_index_list(${quoteIdent(m.name)})`).toArray()) {
            const cols = this.sql.exec<{ name: string | null }>(`SELECT name FROM pragma_index_info(${quoteIdent(ix.name)})`).toArray()
            indexes.push({ name: ix.name, unique: !!ix.unique, columns: cols.map((c) => c.name ?? '(expression)') })
          }
          for (const fk of this.sql.exec<{ from: string; table: string; to: string | null }>(`SELECT "from", "table", "to" FROM pragma_foreign_key_list(${quoteIdent(m.name)})`).toArray()) {
            foreignKeys.push({ column: fk.from, table: fk.table, to: fk.to })
          }
        } catch {
          // Best effort: the columns are what matter.
        }
      }
      tables.push({
        name: m.name,
        kind,
        columns,
        rows,
        hasRowid: kind === 'table' && !/\bWITHOUT\s+ROWID\b/i.test(m.sql ?? ''),
        sql: m.sql,
        indexes,
        foreignKeys,
      })
    }
    return { tables, sizeBytes: this.sql.databaseSize }
  }

  /**
   * Insert rows into one table as a single transaction. With `upsertOn`, a row
   * whose key columns match an existing row updates it instead.
   */
  async insert(
    table: string,
    columns: string[],
    rows: unknown[][],
    opts: { upsertOn?: string[]; onConflict?: 'error' | 'ignore'; dryRun?: boolean } = {},
  ): Promise<{ ok: true; changes: number; schema: DbSchema; dryRun: boolean } | { ok: false; error: DbError }> {
    if (!columns.length) return { ok: false, error: { code: 'invalid', message: 'The rows have no columns.' } }
    if (columns.length > MAX_PARAMS) return { ok: false, error: { code: 'too_large', message: `A row can have at most ${MAX_PARAMS} columns.` } }
    const cols = columns.map(quoteIdent).join(', ')
    const keys = opts.upsertOn ?? []
    const rest = columns.filter((c) => !keys.includes(c))
    const conflict = keys.length
      ? ` ON CONFLICT (${keys.map(quoteIdent).join(', ')}) DO ${rest.length ? `UPDATE SET ${rest.map((c) => `${quoteIdent(c)} = excluded.${quoteIdent(c)}`).join(', ')}` : 'NOTHING'}`
      : ''
    const head = `INSERT${opts.onConflict === 'ignore' && !keys.length ? ' OR IGNORE' : ''} INTO ${quoteIdent(table)} (${cols}) VALUES `
    const perStmt = Math.max(1, Math.floor(MAX_PARAMS / columns.length))
    const tuple = `(${columns.map(() => '?').join(', ')})`
    let changes = 0
    let schema: DbSchema | undefined
    let failing = ''
    try {
      this.ctx.storage.transactionSync(() => {
        for (let i = 0; i < rows.length; i += perStmt) {
          const chunk = rows.slice(i, i + perStmt)
          failing = `${head}… (rows ${i + 1}-${i + chunk.length})`
          const sql = head + chunk.map(() => tuple).join(', ') + conflict
          const before = this.totalChanges()
          // Drain the cursor so every row lands before the next statement.
          this.sql.exec(sql, ...bind(chunk.flat())).toArray()
          changes += this.changesSince(before)
        }
        failing = ''
        if (this.sql.databaseSize > MAX_DB_BYTES) {
          throw new Rollback({ code: 'too_large', message: 'This would take the database past 1 GB, the most one database can hold.', hint: 'Delete rows you no longer need, or split the data across databases.' })
        }
        schema = this.readSchema(true)
        if (opts.dryRun) throw new Rollback(null)
      })
    } catch (err) {
      if (err instanceof Rollback) {
        if (err.detail) return { ok: false, error: err.detail }
      } else {
        const e = sqlError(err, failing || undefined)
        if (/ON CONFLICT clause does not match/i.test(e.message)) {
          e.hint = `upsertOn needs a PRIMARY KEY or UNIQUE constraint on (${keys.join(', ')}). Add one with CREATE UNIQUE INDEX, or pick the table's key columns.`
        }
        return { ok: false, error: e }
      }
    }
    return { ok: true, changes, schema: schema!, dryRun: !!opts.dryRun }
  }

  /** One page of a table for the app's grid, with the schema, in a single call. */
  async browse(
    table: string | null,
    opts: { limit?: number; offset?: number; orderBy?: string | null; desc?: boolean; search?: string | null } = {},
  ): Promise<{ schema: DbSchema; table: string | null; columns: string[]; rows: DbValue[][]; rowids: (number | null)[]; total: number; error?: string }> {
    const schema = this.readSchema(true)
    const t = schema.tables.find((x) => x.name === table) ?? schema.tables.find((x) => x.kind === 'table') ?? schema.tables[0]
    if (!t) return { schema, table: null, columns: [], rows: [], rowids: [], total: 0 }
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 500))
    const offset = Math.max(0, opts.offset ?? 0)
    const names = t.columns.map((c) => c.name)
    const params: DbValue[] = []
    let where = ''
    const q = (opts.search ?? '').trim()
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
      const searched = names.slice(0, 40)
      where = ` WHERE (${searched.map((c) => `CAST(${quoteIdent(c)} AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ')})`
      for (let i = 0; i < searched.length; i++) params.push(like)
    }
    const order = opts.orderBy && names.includes(opts.orderBy) ? ` ORDER BY ${quoteIdent(opts.orderBy)} ${opts.desc ? 'DESC' : 'ASC'}` : t.hasRowid ? ' ORDER BY rowid' : ''
    const from = quoteIdent(t.name)
    try {
      const total = Number(this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM ${from}${where}`, ...params).one().n)
      const cursor = this.sql.exec(`SELECT ${t.hasRowid ? 'rowid AS "__rowid__", ' : ''}* FROM ${from}${where}${order} LIMIT ? OFFSET ?`, ...params, limit, offset)
      const raw = [...cursor.raw()] as DbValue[][]
      const columns = t.hasRowid ? cursor.columnNames.slice(1) : cursor.columnNames
      return {
        schema,
        table: t.name,
        columns,
        rows: t.hasRowid ? raw.map((r) => r.slice(1)) : raw,
        rowids: raw.map((r) => (t.hasRowid ? Number(r[0]) : null)),
        total,
      }
    } catch (err) {
      return { schema, table: t.name, columns: names, rows: [], rowids: [], total: 0, error: sqlError(err).message }
    }
  }

  /** Everything needed to rebuild this database somewhere else: the schema, in the order to replay it. */
  async dumpSchema(): Promise<{ tables: string[]; after: string[]; sizeBytes: number }> {
    type Master = { name: string; type: string; sql: string | null }
    const master = this.sql
      .exec<Master>(`SELECT name, type, sql FROM sqlite_schema WHERE sql IS NOT NULL AND ${VISIBLE} ORDER BY rowid`)
      .toArray()
    const virtual = master.filter((m) => m.type === 'table' && /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(m.sql ?? '')).map((m) => m.name)
    const isShadow = (name: string) => virtual.some((v) => name !== v && name.startsWith(`${v}_`))
    return {
      tables: master.filter((m) => m.type === 'table' && !isShadow(m.name)).map((m) => m.sql!),
      // Indexes, views and triggers go in after the rows, so triggers don't fire during the copy.
      after: master.filter((m) => m.type !== 'table').map((m) => m.sql!),
      sizeBytes: this.sql.databaseSize,
    }
  }

  /** Delete the database for good. Called when its entry is purged from the trash. */
  async destroy(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }
}
