import { drizzle } from 'drizzle-orm/d1'
import * as authSchema from './auth-schema'
import * as appSchema from './app-schema'
import { getEnv } from '../env'

export const schema = { ...authSchema, ...appSchema }

export function createDb(d1: D1Database) {
  return drizzle(d1)
}

export type Db = ReturnType<typeof createDb>

let cached: { d1: D1Database; db: Db } | undefined

export function getDb(): Db {
  const d1 = getEnv().DB
  if (cached?.d1 !== d1) cached = { d1, db: createDb(d1) }
  return cached.db
}

export * from './auth-schema'
export * from './app-schema'

type DrizzleQuery = { toSQL(): { sql: string; params: unknown[] } }
export type Batchable = DrizzleQuery | D1PreparedStatement

/**
 * Run Drizzle queries and raw statements as one atomic D1 batch. Drizzle's own
 * batch() can't mix in raw statements (we need those for the FTS index).
 */
export async function batch(items: Batchable[]) {
  const d1 = getEnv().DB
  const stmts = items.map((i) => {
    if ('toSQL' in i) {
      const q = i.toSQL()
      return d1.prepare(q.sql).bind(...q.params)
    }
    return i
  })
  if (!stmts.length) return []
  return d1.batch(stmts)
}

export function raw(sqlText: string, ...params: unknown[]) {
  return getEnv().DB.prepare(sqlText).bind(...params)
}
