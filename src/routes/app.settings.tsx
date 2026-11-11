import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { aiSettingsFn, getWorkspaceFn, removeSecretFn, renameWorkspaceFn, secretsFn, setAiSettingsFn, setSecretFn } from '../lib/api'
import { KeyRound, Lock, Trash2 } from 'lucide-react'
import { Badge, Select } from '../components/ui'
import { timeAgo } from '../lib/utils'
import { Button, Field, Input, PageHeader, Textarea } from '../components/ui'
import { clearMeCache } from '../lib/me'
import { cn, errMessage } from '../lib/utils'

export const Route = createFileRoute('/app/settings')({
  loader: async () => {
    const [ws, ai, secrets] = await Promise.all([getWorkspaceFn(), aiSettingsFn(), secretsFn()])
    return { ...ws, ai, secrets }
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { workspace, role, ai, secrets } = Route.useLoaderData()
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
      <SecretsSettings data={secrets} />
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

type SecretItem = {
  id: string
  name: string
  scope: 'team' | 'me'
  hosts: string[]
  description: string | null
  createdBy: string
  updatedAt: number
  lastUsedAt: number | null
  canEdit: boolean
  people: { userId: string; name: string }[] | null
  canUse: boolean
  canChangePeople: boolean
}
type SecretMember = { userId: string; name: string; email: string }
type SecretForm = {
  name: string
  value: string
  hosts: string
  scope: 'team' | 'me'
  replacing?: boolean
  /** Null: any run can use it. Otherwise the user ids whose runs may. */
  people: Set<string> | null
  canChangePeople: boolean
}

function peopleNames(people: { userId: string; name: string }[], youId: string) {
  const list = [...people].sort((a, b) => Number(b.userId === youId) - Number(a.userId === youId)).map((p) => (p.userId === youId ? 'you' : p.name))
  if (list.length <= 1) return list[0] ?? 'nobody'
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

function SecretsSettings({ data }: { data: { secrets: SecretItem[]; canEdit: boolean; userId: string; members: SecretMember[] } }) {
  const router = useRouter()
  const [form, setForm] = useState<SecretForm | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!form) return
    setBusy(true)
    try {
      await setSecretFn({
        data: {
          name: form.name,
          value: form.value || undefined,
          hosts: form.hosts.split(/[\s,]+/).filter(Boolean),
          scope: form.scope,
          ...(form.scope === 'team' && form.canChangePeople ? { people: form.people ? [...form.people] : null } : {}),
        },
      })
      toast.success(`Saved ${form.name.toUpperCase()}`)
      setForm(null)
      router.invalidate()
    } catch (err) {
      toast.error(errMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (s: SecretItem) => {
    if (!confirm(`Remove ${s.name}? Flows that use it will stop working until it's added again.`)) return
    try {
      await removeSecretFn({ data: { name: s.name, scope: s.scope } })
      toast.success(`Removed ${s.name}`)
      router.invalidate()
    } catch (err) {
      toast.error(errMessage(err))
    }
  }
  return (
    <section id="secrets" className="mt-12 scroll-mt-6 border-t border-line pt-8 pb-10">
      <h2 className="text-[15px] font-semibold">Secrets for flows</h2>
      <p className="mt-1 text-[13.5px] text-ink-2">
        API keys that flows use. Flow code never sees a value: Brainspace adds it to outgoing requests, and only to the hosts you list. Your
        personal secrets take the place of team ones with the same name when a run acts as you.
      </p>
      {data.secrets.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {data.secrets.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <KeyRound className="size-4 shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <code className="text-[13px] font-medium">{s.name}</code>
                  <Badge tone={s.scope === 'team' ? 'neutral' : 'agent'}>{s.scope === 'team' ? 'Team' : 'Only you'}</Badge>
                  {s.people && (
                    <span className="flex items-center gap-1 text-[12px] text-ink-3">
                      <Lock className="size-3" /> Only {peopleNames(s.people, data.userId)} can use it
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[12.5px] text-ink-3">
                  Sent only to {s.hosts.join(', ')} · added by {s.createdBy} · {s.lastUsedAt ? `used ${timeAgo(s.lastUsedAt)}` : 'not used yet'}
                </div>
              </div>
              {s.canEdit && data.canEdit && (
                <>
                  <Button size="sm" onClick={() =>
                      setForm({
                        name: s.name,
                        value: '',
                        hosts: s.hosts.join(', '),
                        scope: s.scope,
                        replacing: true,
                        people: s.people ? new Set(s.people.map((p) => p.userId)) : null,
                        canChangePeople: s.canChangePeople,
                      })
                    }>
                    Replace
                  </Button>
                  <button className="rounded p-1.5 text-ink-3 hover:bg-wash hover:text-danger" onClick={() => remove(s)} aria-label={`Remove ${s.name}`}>
                    <Trash2 className="size-4" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.canEdit &&
        (form ? (
          <div className="mt-4 space-y-3 rounded-lg border border-line bg-paper/50 p-4">
            <div className="grid grid-cols-[1fr_140px] gap-2">
              <Input
                value={form.name}
                disabled={form.replacing}
                onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
                placeholder="WEATHER_API_KEY"
                className="font-mono text-[13px]"
              />
              <Select value={form.scope} disabled={form.replacing} onChange={(e) => setForm({ ...form, scope: e.target.value as 'team' | 'me' })}>
                <option value="team">Team</option>
                <option value="me">Only me</option>
              </Select>
            </div>
            <Input type="password" autoComplete="off" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={form.replacing ? 'New value (leave empty to keep the current one)' : 'Value'} />
            <Input value={form.hosts} onChange={(e) => setForm({ ...form, hosts: e.target.value })} placeholder="Hosts it may be sent to, e.g. api.openweathermap.org" className="font-mono text-[13px]" />
            {form.scope === 'team' && form.canChangePeople && (
              <div>
                <Select
                  value={form.people ? 'some' : 'everyone'}
                  onChange={(e) => setForm({ ...form, people: e.target.value === 'some' ? new Set([data.userId]) : null })}
                >
                  <option value="everyone">Any run in the workspace can use it</option>
                  <option value="some">Only runs by certain people</option>
                </Select>
                {form.people && (
                  <>
                    <p className="mt-1.5 text-[12.5px] text-ink-3">Runs by anyone else, admins included, can't use it. Use this for a token that acts as a person, like a Slack user token.</p>
                    <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line bg-sheet">
                      {data.members.map((m) => {
                        const you = m.userId === data.userId
                        return (
                          <li key={m.userId} className="border-b border-line last:border-0">
                            <label className={cn('flex items-center gap-3 px-3 py-1.5 text-[13px]', you ? 'cursor-default' : 'cursor-pointer hover:bg-wash')}>
                              <input
                                type="checkbox"
                                className="size-3.5 accent-[var(--color-brand)]"
                                checked={you || form.people!.has(m.userId)}
                                disabled={you}
                                onChange={(e) => {
                                  const next = new Set(form.people)
                                  if (e.target.checked) next.add(m.userId)
                                  else next.delete(m.userId)
                                  setForm({ ...form, people: next })
                                }}
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {m.name || m.email}
                                {you && <span className="text-ink-3"> (you)</span>}
                              </span>
                              <span className="truncate text-[12px] text-ink-3">{m.email}</span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
              </div>
            )}
            {form.scope === 'team' && !form.canChangePeople && form.people && (
              <p className="text-[12.5px] text-ink-3">Only whoever added {form.name} can change who may use it.</p>
            )}
            <div className="flex gap-2">
              <Button variant="primary" loading={busy} disabled={!form.name || !form.hosts.trim() || (!form.replacing && !form.value)} onClick={save}>
                Save secret
              </Button>
              <Button onClick={() => setForm(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button className="mt-4" onClick={() => setForm({ name: '', value: '', hosts: '', scope: 'team', people: null, canChangePeople: true })}>
            <KeyRound className="size-4" /> Add a secret
          </Button>
        ))}
    </section>
  )
}
