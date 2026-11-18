import { z } from 'zod'
import { AppError } from '../errors'
import * as dbs from '../services/databases'
import { notesAbove } from '../services/files'
import type { ToolDef } from './tools'

const dbPath = z.string().describe('Path of the database, e.g. /team/customers/customers.db.')
const params = z
  .array(z.any())
  .max(100)
  .optional()
  .describe('Values for the ? placeholders, in order. Always pass values this way instead of writing them into the SQL. Objects and arrays are stored as JSON text.')

export const DB_TOOLS: ToolDef[] = [
  {
    name: 'db_list',
    title: 'List databases',
    description:
      'Databases are SQLite databases kept in folders (paths ending in .db). They hold records that flows and agents keep up to date and query, like the list of active customers, where a doc would have to be rewritten each time. Lists the ones you can see with their tables, columns and row counts.',
    schema: z.object({ pathPrefix: z.string().optional().describe('Only databases under this folder, e.g. /team/customers.') }),
    readOnly: true,
    run: async (actor, a) => {
      const databases = await dbs.listDatabases(actor, a)
      return databases.length
        ? { databases }
        : { databases, note: 'No databases here yet. Create one with db_create when the team needs records that get updated over time.' }
    },
  },
  {
    name: 'db_schema',
    title: 'Database schema',
    description: 'The tables in a database: columns with types, keys, indexes and row counts. Call it before you write SQL against a database you have not used in this session.',
    schema: z.object({ path: dbPath }),
    readOnly: true,
    run: async (actor, a) => dbs.getSchema(actor, a.path),
  },
  {
    name: 'db_query',
    title: 'Query a database',
    description:
      'Run one read-only SQL statement (SQLite: SELECT, WITH, joins, aggregates, json_extract, FTS5 MATCH). Returns columns and rows. Up to 200 rows by default: filter and aggregate in SQL instead of pulling every row, and page with LIMIT and OFFSET when truncated is true.',
    schema: z.object({
      path: dbPath,
      sql: z.string().describe('One SELECT statement.'),
      params,
      maxRows: z.number().int().min(1).max(5000).optional().describe('Default 200.'),
    }),
    readOnly: true,
    run: async (actor, a) => {
      const r = await dbs.queryDatabase(actor, a.path, a.sql, a.params, { maxRows: a.maxRows })
      // One row per line: far fewer tokens than pretty-printed JSON, and still valid JSON.
      const head = JSON.stringify({ path: r.path, columns: r.columns, rowCount: r.rows.length, truncated: r.truncated })
      return `${head.slice(0, -1)},"rows":[\n${r.rows.map((row) => JSON.stringify(row)).join(',\n')}\n]}`
    },
  },
  {
    name: 'db_create',
    title: 'Create a database',
    description:
      'Create a database in a folder. Put it next to the docs or the flow it belongs to (/team/customers/customers.db, /team/flows/renewals/state.db); ".db" is added if you leave it off. Pass sql with CREATE TABLE statements to set up the tables in the same call, and a description saying what the data is and what keeps it current. Give key columns a PRIMARY KEY or UNIQUE constraint so rows can be upserted. Use a database for records that get added to, updated or queried; use a doc for prose.',
    schema: z.object({
      path: dbPath,
      description: z.string().max(300).optional().describe('What it holds and what updates it. Shown in listings and search.'),
      sql: z.string().optional().describe('CREATE TABLE (and index) statements to run right away, separated by semicolons.'),
    }),
    minRole: 'member',
    run: async (actor, a) => {
      const r = await dbs.createDatabase(actor, a.path, a)
      const folderNotes = await notesAbove(actor, r.path)
      return { ...r, ...(folderNotes.length ? { folderNotes } : {}) }
    },
  },
  {
    name: 'db_exec',
    title: 'Change a database',
    description:
      'Run SQL that changes a database: INSERT, UPDATE, DELETE, CREATE TABLE, ALTER TABLE, CREATE INDEX and so on. Everything in one call runs as one transaction, so either all of it applies or none of it does (leave out BEGIN and COMMIT). Pass sql with params for one statement, or statements for several. RETURNING rows come back in results. There is no undo and no version history for rows: check a risky UPDATE or DELETE with db_query first, and confirm with the user before deleting data or dropping a table.',
    schema: z.object({
      path: dbPath,
      sql: z.string().optional().describe('One statement, or a script of several separated by semicolons (a script takes no params).'),
      params,
      statements: z
        .array(z.object({ sql: z.string(), params: z.array(z.any()).max(100).optional() }))
        .max(200)
        .optional()
        .describe('Several statements, each with its own params, run in order as one transaction.'),
    }),
    minRole: 'member',
    run: async (actor, a) => {
      if (!a.sql && !a.statements?.length) throw new AppError('invalid', 'Pass sql or statements.')
      if (a.sql && a.statements?.length) throw new AppError('invalid', 'Pass sql or statements, not both.')
      return dbs.execDatabase(actor, a.path, a.statements?.length ? a.statements : a.sql, { params: a.params })
    },
  },
  {
    name: 'db_insert',
    title: 'Insert or upsert rows',
    description:
      'Add rows to a table from JSON objects keyed by column name, up to 5000 per call, as one transaction. Pass upsertOn with the key columns to update the rows that already exist and insert the rest: the way to keep a table in step with another system. upsertOn needs a PRIMARY KEY or UNIQUE constraint on those columns. The table must exist (create it with db_exec).',
    schema: z.object({
      path: dbPath,
      table: z.string(),
      rows: z.array(z.record(z.string(), z.any())).min(1).max(5000).describe('Objects keyed by column name. Missing columns are stored as NULL.'),
      upsertOn: z.array(z.string()).optional().describe('Key columns, e.g. ["email"]. A row matching an existing key updates it.'),
      onConflict: z.enum(['error', 'ignore']).optional().describe('Without upsertOn: fail on a duplicate key (default) or skip that row.'),
    }),
    minRole: 'member',
    run: async (actor, a) => dbs.insertRows(actor, a.path, a.table, a.rows, a),
  },
]
