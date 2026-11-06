import { HeadContent, Scripts, createRootRoute, Outlet } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Brainspace' },
      {
        name: 'description',
        content: "Your team's shared brain for AI agents. Versioned docs, brand kit, skills and connected tools behind one MCP server.",
      },
    ],
    links: [
      { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap',
      },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  shellComponent: RootDocument,
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="grid min-h-screen place-items-center p-8">
      <div className="max-w-sm text-center">
        <p className="font-mono text-sm text-ink-3">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Nothing lives at this address</h1>
        <a href="/app" className="mt-6 inline-block text-brand-ink underline underline-offset-4">
          Go to your space
        </a>
      </div>
    </div>
  ),
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen">
        {children}
        <Toaster position="bottom-right" toastOptions={{ style: { fontFamily: 'var(--font-sans)' } }} />
        <Scripts />
      </body>
    </html>
  )
}
