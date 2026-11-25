// Flows, bots and skills can carry an emoji icon and a human title. Shared by the app and the server.

const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]️?⃣)/u

/** One emoji, or null when `raw` is empty or isn't one. */
export function cleanIcon(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.length > 16) return null
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)]
  if (graphemes.length !== 1 || !EMOJI.test(s)) return null
  return s
}

/** A title for display, or null when there's none worth showing. */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(/\s+/g, ' ')
  return s ? s.slice(0, 80) : null
}

/** "returning-signups" -> "Returning signups", for things that have only a slug. */
export function humanize(slug: string) {
  const words = slug.replace(/[-_]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : slug
}
