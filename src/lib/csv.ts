/** Parse CSV text into rows of cells. Handles quoted cells, doubled quotes, CRLF and a leading BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"' && cell === '') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

export type CsvColumn = { name: string; type: 'TEXT' | 'INTEGER' | 'REAL' }

const INT = /^-?\d{1,15}$/
const NUM = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/

/** Column names from the header row (made unique and tidy) and a type guessed from the values. */
export function csvColumns(header: string[], body: string[][]): CsvColumn[] {
  const seen = new Map<string, number>()
  return header.map((raw, i) => {
    let name = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `column_${i + 1}`
    if (/^\d/.test(name)) name = `c_${name}`
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    if (n > 1) name = `${name}_${n}`
    const values = body.map((r) => (r[i] ?? '').trim()).filter((v) => v !== '')
    // Leading zeros (zip codes, phone numbers) mean it's text that happens to be digits.
    const numeric = (re: RegExp) => values.length > 0 && values.every((v) => re.test(v) && !/^-?0\d/.test(v))
    return { name, type: numeric(INT) ? 'INTEGER' : numeric(NUM) ? 'REAL' : 'TEXT' }
  })
}

/** Rows as objects keyed by column, with numbers as numbers and blanks as null. */
export function csvRows(columns: CsvColumn[], body: string[][]) {
  return body.map((r) =>
    Object.fromEntries(
      columns.map((c, i) => {
        const v = (r[i] ?? '').trim()
        if (v === '') return [c.name, null]
        return [c.name, c.type === 'TEXT' ? (r[i] ?? '') : Number(v)]
      }),
    ) as Record<string, string | number | null>,
  )
}
