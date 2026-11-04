import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { aiSettingsFn, getWorkspaceFn, renameWorkspaceFn, setAiSettingsFn } from '../lib/api'
import { Button, Field, Input, PageHeader, Textarea } from '../components/ui'
import { clearMeCache } from '../lib/me'
import { errMessage } from '../lib/utils'

export const Route = createFileRoute('/app/settings')({
  loader: async () => {
    const [ws, ai] = await Promise.all([getWorkspaceFn(), aiSettingsFn()])
    return { ...ws, ai }
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { workspace, role, ai } = Route.useLoaderData()
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
            clearMeCache()
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
      <AiSettings ai={ai} />
    </div>
  )
}

function AiSettings({ ai }: { ai: { configured: boolean; model: string; defaultModel: string; models: { id: string; name: string }[]; canEdit: boolean } }) {
  const router = useRouter()
  const [key, setKey] = useState('')
  const [model, setModel] = useState(ai.model)
  const [busy, setBusy] = useState<string | null>(null)
  const save = async (what: 'key' | 'model' | 'remove') => {
    setBusy(what)
    try {
      await setAiSettingsFn({ data: what === 'key' ? { key } : what === 'remove' ? { key: null } : { model: model === ai.defaultModel ? null : model } })
      toast.success(what === 'remove' ? 'Key removed' : 'Saved')
      setKey('')
      router.invalidate()
    } catch (err) {
      toast.error(errMessage(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="mt-12 border-t border-line pt-8">
      <h2 className="text-[15px] font-semibold">AI for flows</h2>
      <p className="mt-1 text-[13.5px] text-ink-2">
        Flows call models through{' '}
        <a href="https://vercel.com/ai-gateway" target="_blank" rel="noreferrer" className="underline">
          Vercel AI Gateway
        </a>{' '}
        with this workspace's key, so usage bills to your Vercel account.
      </p>
      <div className="mt-5 space-y-5">
        <Field
          label="AI Gateway key"
          hint={ai.configured ? 'A key is saved. Paste a new one to replace it.' : 'Create one in the Vercel dashboard under AI Gateway → API keys.'}
        >
          {ai.canEdit ? (
            <div className="flex gap-2">
              <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={ai.configured ? '••••••••••••' : 'vck_…'} autoComplete="off" />
              <Button variant="primary" disabled={!key.trim()} loading={busy === 'key'} onClick={() => save('key')}>
                Save key
              </Button>
              {ai.configured && (
                <Button loading={busy === 'remove'} onClick={() => save('remove')}>
                  Remove
                </Button>
              )}
            </div>
          ) : (
            <div className="text-[13.5px] text-ink-2">{ai.configured ? 'Set up' : 'Not set up. Ask an admin.'}</div>
          )}
        </Field>
        <Field label="Default model" hint={`Flows can pick their own model in FLOW.md. Brainspace's default is ${ai.defaultModel}.`}>
          <div className="flex gap-2">
            <Input list="ai-models" value={model} disabled={!ai.canEdit} onChange={(e) => setModel(e.target.value)} className="font-mono text-[13px]" />
            <datalist id="ai-models">
              {ai.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </datalist>
            {ai.canEdit && (
              <Button disabled={model === ai.model} loading={busy === 'model'} onClick={() => save('model')}>
                Save
              </Button>
            )}
          </div>
        </Field>
      </div>
    </section>
  )
}
