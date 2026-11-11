import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authClient } from '../lib/auth-client'
import { acceptInviteFn, consentInfoFn, createWorkspaceFn, getMe, pendingInvitesFn } from '../lib/api'
import { Wordmark } from '../components/Logo'
import { Avatar, Button, Input } from '../components/ui'
import { errMessage, suggestWorkspaceName } from '../lib/utils'

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
            {me && <WorkspacePicker email={me.user.email} hasWorkspace={!!me.current} onDone={() => getMe().then(setMe)} />}
            <div className="mt-6 flex gap-2">
              <Button
                variant="brand"
                className="flex-1"
                onClick={() => decide(true)}
                loading={busy === 'allow'}
                disabled={!!me && !me.current}
              >
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

type Invite = Awaited<ReturnType<typeof pendingInvitesFn>>[number]

/**
 * Invites waiting for this email, plus a way to start a workspace when there's none, so someone who
 * signs in from their agent never has to leave the sign-in to get set up.
 */
function WorkspacePicker({ email, hasWorkspace, onDone }: { email: string; hasWorkspace: boolean; onDone: () => void }) {
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [name, setName] = useState(() => suggestWorkspaceName(email))
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    pendingInvitesFn()
      .then(setInvites)
      .catch(() => setInvites([]))
  }, [])

  if (hasWorkspace && !invites?.length) return null

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    try {
      await fn()
      onDone()
      setInvites(await pendingInvitesFn().catch(() => []))
    } catch (e) {
      toast.error(errMessage(e))
    }
    setBusy(null)
  }

  return (
    <div className="mt-5 rounded-lg border border-line bg-paper p-4 text-sm">
      <div className="font-medium">{hasWorkspace ? 'You have an invite' : 'First, pick a workspace'}</div>
      <p className="mt-1 text-ink-2">
        {hasWorkspace
          ? 'Join it to connect your agent there. You can switch workspaces any time.'
          : "Your agent works inside a workspace, and you're not in one yet."}
      </p>
      {invites?.map((inv) => (
        <div key={inv.token} className="mt-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{inv.workspaceName}</div>
            <div className="text-[13px] text-ink-3">
              {inv.inviter ? `${inv.inviter} invited you` : 'You were invited'} as{' '}
              {inv.role === 'viewer' ? 'read-only' : inv.role}
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            loading={busy === inv.token}
            onClick={() => act(inv.token, () => acceptInviteFn({ data: { token: inv.token } }))}
          >
            Join
          </Button>
        </div>
      ))}
      {!hasWorkspace && (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault()
            act('create', () => createWorkspaceFn({ data: { name } }))
          }}
        >
          <div className="text-[13px] font-medium text-ink-2">
            {invites?.length ? 'Or start a new one' : 'Name your workspace, usually your company'}
          </div>
          <div className="mt-1.5 flex gap-2">
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme" />
            <Button type="submit" loading={busy === 'create'}>
              Create
            </Button>
          </div>
          {!invites?.length && (
            <p className="mt-2 text-[13px] text-ink-3">If a teammate already set one up, ask them for an invite instead.</p>
          )}
        </form>
      )}
    </div>
  )
}
