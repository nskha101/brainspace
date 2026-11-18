/**
 * Small SQL text helpers for folder databases. No parser: just enough to split
 * a script into statements and to tell a read from a write before running it.
 */

/** "customers" -> "\"customers\"", safe to splice into SQL as a table or column name. */
export function quoteIdent(name: string) {
  return `"${String(name).replace(/"/g, '""')}"`
}

type Split = { text: string; bare: string }

/**
 * Split a script on semicolons, leaving alone the ones inside strings, quoted
 * names, comments and trigger bodies. `bare` is the statement with comments
 * dropped and string contents blanked, for keyword checks.
 */
function split(sql: string): Split[] {
  const out: Split[] = []
  let text = ''
  let bare = ''
  const push = () => {
    if (bare.trim()) out.push({ text: text.trim(), bare: bare.trim() })
    text = ''
    bare = ''
  }
  const n = sql.length
  let i = 0
  while (i < n) {
    const c = sql[i]!
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? n : end
      text += sql.slice(i, stop)
      bare += ' '
      i = stop
      continue
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      text += sql.slice(i, stop)
      bare += ' '
      i = stop
      continue
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      let j = i + 1
      while (j < n) {
        if (sql[j] === close) {
          // A doubled quote is an escaped quote, not the end.
          if (close !== ']' && sql[j + 1] === close) {
            j += 2
            continue
          }
          break
        }
        j++
      }
      const stop = Math.min(j + 1, n)
      text += sql.slice(i, stop)
      // Keep quoted names (they matter for nothing we check); blank string contents.
      bare += c === "'" ? "''" : sql.slice(i, stop)
      i = stop
      continue
    }
    if (c === ';') {
      // A trigger body holds its own statements; it ends at the END that closes it.
      if (/^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(bare.trim())) {
        const ends = (bare.match(/\bEND\b/gi) ?? []).length
        const cases = (bare.match(/\bCASE\b/gi) ?? []).length
        if (!/\bEND\s*$/i.test(bare) || ends <= cases) {
          text += c
          bare += c
          i++
          continue
        }
      }
      push()
      i++
      continue
    }
    text += c
    bare += c
    i++
  }
  push()
  return out
}

/** The statements in a script, in order. Empty and comment-only ones are dropped. */
export function splitStatements(sql: string): string[] {
  return split(sql).map((s) => s.text)
}

const READ_KEYWORDS = new Set(['SELECT', 'WITH', 'VALUES', 'EXPLAIN', 'PRAGMA'])
const TRANSACTION_KEYWORDS = new Set(['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'])

function firstKeyword(stmt: string) {
  const bare = split(stmt)[0]?.bare ?? ''
  return (bare.match(/^[\s(]*([A-Za-z]+)/)?.[1] ?? '').toUpperCase()
}

/**
 * True when a statement starts like a read. `WITH ... INSERT` also starts like
 * one, so callers still check that nothing was written and roll back if it was.
 */
export function startsLikeRead(stmt: string) {
  const bare = split(stmt)[0]?.bare ?? ''
  const kw = firstKeyword(stmt)
  if (!READ_KEYWORDS.has(kw)) return false
  // "PRAGMA x = y" changes a setting.
  if (kw === 'PRAGMA' && /=/.test(bare)) return false
  return true
}

/** BEGIN, COMMIT, SAVEPOINT and friends, which the storage engine doesn't accept. */
export function isTransactionControl(stmt: string) {
  return TRANSACTION_KEYWORDS.has(firstKeyword(stmt))
}

/** A short one-line preview of a statement for logs and activity. */
export function sqlPreview(sql: string, max = 160) {
  const one = sql.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}
