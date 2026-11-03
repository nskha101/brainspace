import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { getWorkspaceFn, renameWorkspaceFn } from '../lib/api'
import { Button, Field, Input, PageHeader, Textarea } from '../components/ui'
import { errMessage } from '../lib/utils'

export const Route = createFileRoute('/app/settings')({
  loader: () => getWorkspaceFn(),
  component: SettingsPage,
})

function SettingsPage() {
  const { workspace, role } = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState(workspace.name)
  const [description, setDescription] = useState(workspace.description ?? '')
  const [busy, setBusy] = useState(false)
  const isAdmin = role === 'admin'

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 lg:px-10">
      <PageHeader title="Workspace settings" description={isAdmin ? undefined : 'Only admins can change these.'} />
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await renameWorkspaceFn({ data: { name, description } })
            toast.success('Saved')
            router.invalidate()
          } catch (err) {
            toast.error(errMessage(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <Field label="Name">
          <Input value={name} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" hint="A sentence about the company. Agents see it.">
          <Textarea rows={3} value={description} disabled={!isAdmin} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Workspace ID" hint="Send as the X-Brainspace-Workspace header to pin an OAuth agent to this workspace.">
          <Input value={workspace.slug} readOnly className="font-mono text-[13px]" />
        </Field>
        {isAdmin && (
          <Button type="submit" variant="primary" loading={busy}>
            Save
          </Button>
        )}
      </form>
    </div>
  )
}
