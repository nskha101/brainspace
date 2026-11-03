// The Better Auth CLI emits drizzle 0.x relations(); drizzle 1.x dropped that API
// and we don't use relational queries, so keep only the tables.
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'src/server/db/auth-schema.ts'
let s = readFileSync(p, 'utf8')
const i = s.indexOf('export const userRelations')
if (i > -1) s = s.slice(0, i).trimEnd() + '\n'
s = s.replace('import { relations, sql } from "drizzle-orm";', 'import { sql } from "drizzle-orm";')
writeFileSync(p, s)
