import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { PageSkeleton } from './components/PageSkeleton'

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
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
