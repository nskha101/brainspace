import { getMe } from './api'

type Me = Awaited<ReturnType<typeof getMe>>

let cache: { value: Me; at: number } | null = null
let inflight: Promise<Me> | null = null

function refresh() {
  inflight ??= getMe()
    .then((value) => {
      cache = { value, at: Date.now() }
      return value
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * The signed-in user and their workspaces. In the browser this is cached and
 * revalidated in the background, so moving between pages doesn't wait on a
 * session round trip. On the server it is always fresh (never shared between
 * requests).
 */
export async function getMeCached(): Promise<Me> {
  if (typeof window === 'undefined') return getMe()
  if (cache && cache.value) {
    if (Date.now() - cache.at > 15_000) void refresh().catch(() => {})
    return cache.value
  }
  return refresh()
}

/** Call after anything that changes the user's workspaces, roles or names. */
export function clearMeCache() {
  cache = null
}
