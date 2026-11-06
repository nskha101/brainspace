import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authClient } from '../lib/auth-client'
import { consentInfoFn, getMe } from '../lib/api'
import { Wordmark } from '../components/Logo'
import { Avatar, Button } from '../components/ui'

export const Route = createFileRoute('/consent')({
  component: Consent,
})

const SCOPE_TEXT: Record<string, string> = {
  openid: 'Know who you are',
  profile: 'See your name and picture',
  email: 'See your email address',
  offline_access: 'Stay connected until you revoke it',
}

type Info = Awaited<ReturnType<typeof consentInfoFn>>
type Me = Awaited<ReturnType<typeof getMe>>

function Consent() {
  const [info, setInfo] = useState<Info | null>(null)
  const [me, setMe] = useState<Me>(null)
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null)

  useEffect(() => {
    const query = window.location.search.slice(1)
    consentInfoFn({ data: { query } }).then(setInfo)
    getMe().then(setMe)
  }, [])

  async function decide(accept: boolean) {
    setBusy(accept ? 'allow' : 'deny')
    const res = await authClient.oauth2.consent({ accept })
    const data = res.data as { url?: string; uri?: string } | null
    if (res.error || !(data?.url || data?.uri)) {
      toast.error(res.error?.message ?? 'Something went wrong. Start the connection again from your agent.')
      setBusy(null)
      return
    }
    window.location.href = (data.url || data.uri)!
  }

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-md">
        <Wordmark />
        {!info ? (
          <p className="mt-10 text-ink-3">Loading…</p>
        ) : !info.valid ? (
          <div className="mt-10">
            <h1 className="text-2xl font-semibold">This request expired</h1>
            <p className="mt-2 text-ink-2">Go back to your agent and connect again.</p>
          </div>
        ) : (
          <div className="mt-10 rounded-xl border border-line bg-sheet p-6">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">
              Allow <span className="text-agent">{info.clientName}</span> to use your Brainspace?
            </h1>
            {me?.current && (
              <div className="mt-4 flex items-center gap-2.5 rounded-lg bg-paper px-3 py-2.5 text-sm">
                <Avatar name={me.user.name} image={me.user.image} />
                <div>
                  <div className="font-medium">{me.user.email}</div>
                  <div className="text-ink-2">
                    Workspace {me.current.name}, as {me.current.role === 'viewer' ? 'read-only' : me.current.role}
                  </div>
                </div>
              </div>
            )}
            <p className="mt-5 text-sm text-ink-2">It will act as you, with your role. It can:</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li>Read and change docs in /team and your private /me space, as your role allows</li>
              <li>Use the connections your workspace has set up</li>
              {info.scopes.map((s) => (SCOPE_TEXT[s] ? <li key={s}>{SCOPE_TEXT[s]}</li> : null))}
            </ul>
            {me && !me.current && (
              <p className="mt-4 rounded-md bg-brand-wash px-3 py-2 text-sm text-brand-ink">
                You're not in a workspace yet. Create one at usebrain.space after connecting, or the agent won't have
                anything to work with.
              </p>
            )}
            <div className="mt-6 flex gap-2">
              <Button variant="brand" className="flex-1" onClick={() => decide(true)} loading={busy === 'allow'}>
                Allow access
              </Button>
              <Button className="flex-1" onClick={() => decide(false)} loading={busy === 'deny'}>
                Deny
              </Button>
            </div>
            <p className="mt-4 text-xs text-ink-3">You can disconnect agents any time from Agents in the app.</p>
          </div>
        )}
      </div>
    </div>
  )
}
