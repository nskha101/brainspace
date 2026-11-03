import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { acceptInviteFn, getInviteFn, getMe } from '../lib/api'
import { Wordmark } from '../components/Logo'
import { Button } from '../components/ui'
import { errMessage } from '../lib/utils'

export const Route = createFileRoute('/invite/$token')({
  loader: async ({ params }) => ({
    invite: await getInviteFn({ data: { token: params.token } }),
    me: await getMe(),
  }),
  component: Invite,
})

function Invite() {
  const { invite, me } = Route.useLoaderData()
  const { token } = Route.useParams()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const roleText = invite?.role === 'viewer' ? 'read-only member' : invite?.role

  async function accept() {
    setBusy(true)
    try {
      await acceptInviteFn({ data: { token } })
      navigate({ to: '/app' })
    } catch (e) {
      toast.error(errMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-md">
        <Wordmark />
        {!invite || !invite.usable ? (
          <div className="mt-10">
            <h1 className="text-2xl font-semibold">This invite has expired</h1>
            <p className="mt-2 text-ink-2">Ask whoever invited you for a new link.</p>
          </div>
        ) : (
          <div className="mt-10">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Join {invite.workspaceName}</h1>
            <p className="mt-2 text-ink-2">
              {invite.inviter ?? 'A teammate'} invited you as {roleText === 'admin' ? 'an' : 'a'} {roleText}.
              {invite.email ? ` The invite is for ${invite.email}.` : ''}
            </p>
            <div className="mt-8">
              {me ? (
                <div className="space-y-3">
                  <Button variant="brand" className="h-10 w-full" onClick={accept} loading={busy}>
                    Join as {me.user.email}
                  </Button>
                  {invite.email && invite.email.toLowerCase() !== me.user.email.toLowerCase() && (
                    <p className="text-sm text-danger">
                      You're signed in as {me.user.email}, but this invite is for {invite.email}.
                    </p>
                  )}
                </div>
              ) : (
                <Link
                  to="/login"
                  search={{ redirect: `/invite/${token}` } as never}
                  className="inline-flex h-10 w-full items-center justify-center rounded-md bg-brand font-medium text-white hover:bg-brand-ink"
                >
                  Sign in to join
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
