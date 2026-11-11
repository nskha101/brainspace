import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { createWorkspaceFn, getMe } from '../lib/api'
import { Wordmark } from '../components/Logo'
import { Button, Input } from '../components/ui'
import { errMessage, suggestWorkspaceName } from '../lib/utils'

export const Route = createFileRoute('/onboarding')({
  beforeLoad: async () => {
    const me = await getMe()
    if (!me) throw redirect({ to: '/login' })
    return { me }
  },
  component: Onboarding,
})

function Onboarding() {
  const { me } = Route.useRouteContext()
  const navigate = useNavigate()
  const [name, setName] = useState(() => suggestWorkspaceName(me.user.email))
  const [busy, setBusy] = useState(false)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await createWorkspaceFn({ data: { name } })
      navigate({ to: '/welcome' })
    } catch (err) {
      toast.error(errMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-md">
        <Wordmark />
        <h1 className="mt-10 text-2xl font-semibold tracking-[-0.02em]">Name your workspace</h1>
        <p className="mt-2 text-ink-2">
          Usually your company. You'll get a team space with starter folders for your brand kit, company overview and
          skills. If a teammate already set one up, ask them for an invite instead.
        </p>
        <form onSubmit={create} className="mt-8 space-y-3">
          <Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme" className="h-10" />
          <Button type="submit" variant="brand" className="h-10 w-full" loading={busy}>
            Create workspace
          </Button>
        </form>
      </div>
    </div>
  )
}
