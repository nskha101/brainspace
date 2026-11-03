import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authClient } from '../lib/auth-client'
import { authConfigFn } from '../lib/api'
import { Wordmark } from '../components/Logo'
import { Button, Input } from '../components/ui'

export const Route = createFileRoute('/login')({
  loader: () => authConfigFn(),
  component: Login,
})

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M22.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h6c-.3 1.4-1 2.5-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-7.9z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2.1v2.8C3.9 20.5 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.7 14.1c-.2-.7-.4-1.4-.4-2.1s.1-1.4.4-2.1V7.1H2.1C1.4 8.6 1 10.2 1 12s.4 3.4 1.1 4.9l3.6-2.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1C17.5 2.1 15 1 12 1 7.7 1 3.9 3.5 2.1 7.1l3.6 2.8c.9-2.6 3.4-4.5 6.3-4.5z" />
    </svg>
  )
}

function Login() {
  const config = Route.useLoaderData()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState<'google' | 'email' | null>(null)
  const { data: session, isPending } = authClient.useSession()

  const search = typeof window !== 'undefined' ? window.location.search : ''
  const params = new URLSearchParams(search)
  const isOAuth = params.has('client_id') && params.has('sig')
  const redirect = params.get('redirect') || '/app'
  // Come back here after sign-in so an MCP client's authorization can continue.
  const callbackURL = isOAuth ? `/login${search}` : redirect

  useEffect(() => {
    if (isPending || !session) return
    if (isOAuth) window.location.href = `/api/auth/oauth2/authorize${search}`
    else navigate({ to: redirect })
  }, [session, isPending])

  async function google() {
    setBusy('google')
    const res = await authClient.signIn.social({ provider: 'google', callbackURL })
    if (res.error) {
      toast.error(res.error.message ?? 'Google sign-in failed')
      setBusy(null)
    }
  }

  async function magic(e: React.FormEvent) {
    e.preventDefault()
    setBusy('email')
    const res = await authClient.signIn.magicLink({ email, callbackURL })
    setBusy(null)
    if (res.error) toast.error(res.error.message ?? 'Could not send the link')
    else setSent(true)
  }

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm">
        <a href="/" className="inline-block">
          <Wordmark />
        </a>
        <h1 className="mt-10 text-2xl font-semibold tracking-[-0.02em]">{isOAuth ? 'Sign in to connect your agent' : 'Sign in'}</h1>
        <p className="mt-1.5 text-[15px] text-ink-2">
          {isOAuth
            ? 'An MCP client wants access to your Brainspace. Sign in, then approve it.'
            : 'Use your work Google account or get a link by email.'}
        </p>

        {sent ? (
          <div className="mt-8 rounded-lg border border-line bg-sheet p-5">
            <p className="font-medium">Check your inbox</p>
            <p className="mt-1 text-sm text-ink-2">
              We sent a sign-in link to <span className="font-medium text-ink">{email}</span>. It works for 10 minutes.
            </p>
            <button className="mt-4 text-sm text-brand-ink underline underline-offset-4" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            {config.google && (
              <>
                <Button className="h-10 w-full" onClick={google} loading={busy === 'google'}>
                  <GoogleIcon /> Continue with Google
                </Button>
                <div className="flex items-center gap-3 text-xs text-ink-3">
                  <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
                </div>
              </>
            )}
            <form onSubmit={magic} className="space-y-3">
              <Input
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10"
                autoComplete="email"
              />
              <Button type="submit" variant="primary" className="h-10 w-full" loading={busy === 'email'}>
                Email me a sign-in link
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
