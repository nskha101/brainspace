// drizzle-kit 1.x writes drizzle/<timestamp>_<name>/migration.sql.
// `wrangler d1 migrations apply` wants flat files, so mirror them into migrations/.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const src = 'drizzle'
const out = 'migrations'
mkdirSync(out, { recursive: true })
for (const dir of readdirSync(src).sort()) {
  const file = join(src, dir, 'migration.sql')
  if (!existsSync(file)) continue
  const target = join(out, `${dir}.sql`)
  writeFileSync(target, readFileSync(file))
  console.log(`${file} -> ${target}`)
}
