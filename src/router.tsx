import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { PageSkeleton } from './components/PageSkeleton'
import { RouteError, reloadForNewBuild } from './components/RouteError'

if (typeof window !== 'undefined') {
  // Vite fires this when a chunk's dependencies fail to load, which after a
  // deploy means they're from the old build.
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault()
  })
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    // Hovering a link loads its data, and that data is used when the click lands.
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 30_000,
    // Revisited pages render cached data at once and refresh in the background.
    defaultStaleTime: 0,
    // If data takes longer than a blink, show a skeleton instead of a frozen page.
    defaultPendingMs: 120,
    defaultPendingMinMs: 250,
    defaultPendingComponent: PageSkeleton,
    // After a deploy, pages this tab hasn't loaded yet point at old files. This reloads.
    defaultErrorComponent: RouteError,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
