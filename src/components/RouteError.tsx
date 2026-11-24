import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { PageSkeleton } from './PageSkeleton'

// A deploy replaces the hashed JS files, so a tab opened before it asks for
// files that no longer exist when it moves to a page it hasn't loaded yet.
// TanStack reloads once for that, but while a deploy is still reaching every
// edge the reload can get the old page again and fail the same way, and then
// TanStack shows its bare "Something went wrong!". This is the second chance
// and a clearer screen. The timestamp stops a reload loop.
const RELOAD_KEY = 'brainspace:stale-build-reload'

/** True when the error is a JS or CSS file from an older build failing to load. */
export function isStaleBuildError(error: unknown) {
  const message = (error as { message?: unknown } | null)?.message
  if (typeof message !== 'string') return false
  return (
    message.startsWith('Failed to fetch dynamically imported module') || // Chrome
    message.startsWith('error loading dynamically imported module') || // Firefox
    message.startsWith('Importing a module script failed') || // Safari
    message.startsWith('Unable to preload CSS') // Vite
  )
}

/** Reloads the page unless it already did in the last 10 seconds. Returns whether it reloaded. */
export function reloadForNewBuild() {
  if (typeof window === 'undefined') return false
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < 10_000) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

/** The router's default error screen. Old-build errors reload the page instead of showing it. */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter()
  const stale = isStaleBuildError(error)
  if (stale && reloadForNewBuild()) return <PageSkeleton />

  return (
    <div className="grid min-h-[50vh] place-items-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">{stale ? 'Brainspace was updated' : "This page didn't load"}</h1>
        <p className="mt-2 text-sm text-ink-2">
          {stale ? 'Reload to get the new version.' : (error as Error)?.message || 'Something went wrong.'}
        </p>
        <div className="mt-6 flex justify-center gap-4 text-sm">
          <button className="font-medium text-brand-ink underline underline-offset-4" onClick={() => window.location.reload()}>
            Reload
          </button>
          {!stale && (
            // Reruns the loaders, which also clears this error.
            <button className="text-ink-2 underline underline-offset-4 hover:text-ink" onClick={() => router.invalidate()}>
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
