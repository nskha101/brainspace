import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { KeyRound, Lock, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react'
import { removeSecretFn, secretsFn, setSecretFn } from '../lib/api'
import { PeoplePicker } from '../components/PeoplePicker'
import { Avatar, Badge, Button, Empty, Field, Input, ItemIcon, Menu, MenuItem, Modal, PageHeader } from '../components/ui'
import { cn, errMessage, timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/secrets')({
  loader: () => secretsFn(),
  component: SecretsPage,
})

type Data = Awaited<ReturnType<typeof secretsFn>>
type Secret = Data['secrets'][number]
type Person = Data['members'][number]
type Use = Data['uses'][string][number]

/** Which dialog is open. Each one changes a single thing about a secret, except `add`. */
type Open = { mode: 'add' } | { mode: 'value' | 'access' | 'details' | 'remove'; secret: Secret } | null

function namesList(people: { userId: string; name: string }[], youId: string) {
  const list = [...people].sort((a, b) => Number(b.userId === youId) - Number(a.userId === youId)).map((p) => (p.userId === youId ? 'You' : p.name))
  if (list.length <= 1) return list[0] ?? 'Nobody'
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** A signing secret has no hosts: it is read when a webhook arrives and never put on a request. */
const checksOnly = (s: Pick<Secret, 'hosts'>) => s.hosts.length === 0

function SecretsPage() {
  const data = Route.useLoaderData()
  const [open, setOpen] = useState<Open>(null)
  const [view, setView] = useState<'secrets' | 'people'>('secrets')
  const mine = data.secrets.filter((s) => s.scope === 'me')
  const team = data.secrets.filter((s) => s.scope === 'team')
  const byId = new Map(data.members.map((m) => [m.userId, m]))

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10">
      <PageHeader
        title="Secrets"
        description="API keys and signing secrets for flows. Once saved, a value is never shown again, and flow code never sees it."
        actions={
          data.canEdit && (
            <Button variant="primary" onClick={() => setOpen({ mode: 'add' })}>
              <Plus className="size-4" /> Add a secret
            </Button>
          )
        }
      />

      {data.secrets.length === 0 ? (
        <Empty
          title="No secrets yet"
          action={
            data.canEdit && (
              <Button variant="primary" onClick={() => setOpen({ mode: 'add' })}>
                <Plus className="size-4" /> Add a secret
              </Button>
            )
          }
        >
          Add one when a flow needs an API key, or a webhook needs to check its sender's signature. Your agent can also ask you to paste one here, so it stays out of the chat.
        </Empty>
      ) : (
        <>
          <div className="mb-6 inline-grid grid-cols-2 gap-1 rounded-lg bg-wash p-1 text-[13px]" role="group" aria-label="View">
            {(
              [
                ['secrets', 'Secrets'],
                ['people', 'Who can use what'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                aria-pressed={view === k}
                onClick={() => setView(k)}
                className={cn('rounded-md px-4 py-1.5 font-medium', view === k ? 'bg-sheet text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
              >
                {l}
              </button>
            ))}
          </div>

          {view === 'secrets' ? (
            <div className="space-y-10">
              <Group
                title="Team"
                about="Runs by anyone in the workspace use these, unless a secret is kept to certain people."
                secrets={team}
                empty="No team secrets."
                render={(s) => <Row key={s.id} s={s} data={data} byId={byId} shadowed={mine.some((m) => m.name === s.name)} onOpen={setOpen} />}
              />
              <Group
                title="Only you"
                about="Only runs that act as you use these. One with the same name as a team secret takes its place in your runs."
                secrets={mine}
                empty="You have no personal secrets."
                render={(s) => <Row key={s.id} s={s} data={data} byId={byId} onOpen={setOpen} />}
              />
            </div>
          ) : (
            <PeopleView data={data} team={team} mine={mine} />
          )}
        </>
      )}

      <SecretDialog open={open} onClose={() => setOpen(null)} data={data} />
    </div>
  )
}

function Group({ title, about, secrets, empty, render }: { title: string; about: string; secrets: Secret[]; empty: string; render: (s: Secret) => React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-sm font-semibold">
          {title} <span className="font-normal text-ink-3">{secrets.length || ''}</span>
        </h2>
        <p className="text-[13px] text-ink-3">{about}</p>
      </div>
      {secrets.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line">{secrets.map(render)}</ul>
      ) : (
        <p className="rounded-lg border border-dashed border-line-2 px-4 py-3 text-[13px] text-ink-3">{empty}</p>
      )}
    </section>
  )
}

function Row({ s, data, byId, shadowed, onOpen }: { s: Secret; data: Data; byId: Map<string, Person>; shadowed?: boolean; onOpen: (o: Open) => void }) {
  const uses = data.uses[s.name] ?? []
  const canEdit = s.canEdit && data.canEdit
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-wash text-ink-2 [&>svg]:size-4" aria-hidden>
        {checksOnly(s) ? <ShieldCheck /> : <KeyRound />}
      </span>
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-[13.5px] font-medium">{s.name}</code>
          {!s.canUse && <Badge tone="danger">Your runs can't use it</Badge>}
          {shadowed && s.canUse && <Badge>Your runs use your own {s.name}</Badge>}
        </div>
        {s.description && <p className="mt-0.5 text-[13px] text-ink-2">{s.description}</p>}
        <p className="mt-1 text-[12.5px] text-ink-3">
          {checksOnly(s) ? 'Checks incoming webhooks. Never sent anywhere.' : `Sent only to ${s.hosts.join(', ')}`}
          {' · '}added by {s.createdBy} · {s.lastUsedAt ? `used ${timeAgo(s.lastUsedAt)}` : `changed ${timeAgo(s.updatedAt)}`}
        </p>
        {uses.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-ink-3">Used by</span>
            {uses.map((u) => (
              <UseChip key={`${u.flowId}:${u.how}`} use={u} />
            ))}
          </div>
        )}
      </div>

      <div className="w-52 shrink-0">
        <div className="mb-1 text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">Who can use it</div>
        <Access s={s} byId={byId} youId={data.userId} />
        {canEdit && s.scope === 'team' && s.canChangePeople && (
          <button type="button" className="mt-1 text-[12.5px] text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink" onClick={() => onOpen({ mode: 'access', secret: s })}>
            Change
          </button>
        )}
      </div>

      {canEdit && (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" onClick={() => onOpen({ mode: 'value', secret: s })}>
            <RefreshCw className="size-3.5" /> Replace
          </Button>
          <Menu
            trigger={
              <Button size="sm" variant="ghost" aria-label={`More for ${s.name}`}>
                •••
              </Button>
            }
          >
            <MenuItem icon={<Pencil />} onClick={() => onOpen({ mode: 'details', secret: s })}>
              Edit details
            </MenuItem>
            {s.scope === 'team' && s.canChangePeople && (
              <MenuItem icon={<Users />} onClick={() => onOpen({ mode: 'access', secret: s })}>
                Change who can use it
              </MenuItem>
            )}
            <MenuItem icon={<Trash2 />} danger onClick={() => onOpen({ mode: 'remove', secret: s })}>
              Remove
            </MenuItem>
          </Menu>
        </div>
      )}
    </li>
  )
}

function UseChip({ use }: { use: Use }) {
  return (
    <Link
      to="/app/flows/$flowId"
      params={{ flowId: use.flowId }}
      title={use.how === 'checks' ? 'A webhook on this flow checks its sender with this secret' : "This flow's code sends this secret"}
      className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line bg-sheet pr-2 pl-1 text-[12.5px] text-ink-2 hover:border-line-2 hover:text-ink"
    >
      <ItemIcon icon={use.icon} kind="flow" size={16} />
      {use.title}
      {use.how === 'checks' && <span className="text-ink-3">webhook</span>}
    </Link>
  )
}

function Access({ s, byId, youId }: { s: Secret; byId: Map<string, Person>; youId: string }) {
  if (s.scope === 'me') {
    const you = byId.get(youId)
    return (
      <div className="flex items-center gap-2 text-[13px]">
        <Avatar name={you?.name} image={you?.image} size={20} />
        Only your runs
      </div>
    )
  }
  if (!s.people) {
    return (
      <div className="flex items-center gap-2 text-[13px]">
        <span className="grid size-5 place-items-center rounded-full bg-wash text-ink-2">
          <Users className="size-3" />
        </span>
        Everyone's runs
      </div>
    )
  }
  const people = [...s.people].sort((a, b) => Number(b.userId === youId) - Number(a.userId === youId))
  return (
    <div className="text-[13px]">
      <div className="flex items-center gap-2">
        <span className="flex -space-x-1">
          {people.slice(0, 4).map((p) => (
            <span key={p.userId} className="rounded-full ring-2 ring-sheet">
              <Avatar name={p.name} image={byId.get(p.userId)?.image} size={22} />
            </span>
          ))}
        </span>
        <Lock className="size-3 text-ink-3" aria-hidden />
      </div>
      <div className="mt-1 text-ink-2">{namesList(people, youId)} only</div>
    </div>
  )
}

/** The same facts turned round: for each person, the team secrets their runs can use. */
function PeopleView({ data, team, mine }: { data: Data; team: Secret[]; mine: Secret[] }) {
  const open = team.filter((s) => !s.people)
  const kept = team.filter((s) => s.people)
  const people = [...data.members].sort((a, b) => Number(b.userId === data.userId) - Number(a.userId === data.userId))
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-paper/50 px-4 py-3.5">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <Users className="size-4 text-ink-3" /> Everyone's runs can use
        </div>
        {open.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {open.map((s) => (
              <NameChip key={s.id} name={s.name} />
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[13px] text-ink-3">Nothing. Every team secret is kept to certain people.</p>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-sm font-semibold">Kept to certain people</h2>
          <p className="text-[13px] text-ink-3">On top of the ones above. Admins get no exception. Other people's personal secrets aren't listed: only they can see them.</p>
        </div>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {people.map((m) => {
            const you = m.userId === data.userId
            const theirs = kept.filter((s) => s.people!.some((p) => p.userId === m.userId))
            return (
              <li key={m.userId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="flex w-56 min-w-0 shrink-0 items-center gap-3">
                  <Avatar name={m.name} image={m.image} size={28} />
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium">
                      {m.name || m.email} {you && <span className="font-normal text-ink-3">(you)</span>}
                    </div>
                    <div className="truncate text-[12px] text-ink-3">{m.email}</div>
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {theirs.map((s) => (
                    <NameChip key={s.id} name={s.name} locked />
                  ))}
                  {you && mine.map((s) => <NameChip key={s.id} name={s.name} note="yours" />)}
                  {!theirs.length && !(you && mine.length) && <span className="text-[13px] text-ink-3">Only the ones everyone can use</span>}
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

function NameChip({ name, locked, note }: { name: string; locked?: boolean; note?: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line bg-sheet px-2 font-mono text-[12px] text-ink-2">
      {locked && <Lock className="size-3 text-ink-3" aria-hidden />}
      {name}
      {note && <span className="font-sans text-[11.5px] text-ink-3">{note}</span>}
    </span>
  )
}

function SecretDialog({ open, onClose, data }: { open: Open; onClose: () => void; data: Data }) {
  const router = useRouter()
  const s = open && open.mode !== 'add' ? open.secret : null
  const mode = open?.mode
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'team' | 'me'>('team')
  const [value, setValue] = useState('')
  const [purpose, setPurpose] = useState<'send' | 'check'>('send')
  const [hosts, setHosts] = useState('')
  const [description, setDescription] = useState('')
  const [limited, setLimited] = useState(false)
  const [people, setPeople] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(s?.name ?? '')
    setScope(s?.scope ?? 'team')
    setValue('')
    setPurpose(s && checksOnly(s) ? 'check' : 'send')
    setHosts(s?.hosts.join(', ') ?? '')
    setDescription(s?.description ?? '')
    setLimited(!!s?.people)
    setPeople(new Set(s?.people?.map((p) => p.userId) ?? [data.userId]))
  }, [open, s, data.userId])

  if (!open || !mode) return <Modal open={false} onClose={onClose} title="" children={null} />

  const adding = mode === 'add'
  const hostList = purpose === 'check' ? [] : hosts.split(/[\s,]+/).filter(Boolean)
  const uses = s ? (data.uses[s.name] ?? []) : []

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(done)
      onClose()
      router.invalidate()
    } catch (err) {
      toast.error(errMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const save = () => {
    const base = { name: adding ? name : s!.name, scope: adding ? scope : s!.scope }
    const access = scope === 'team' ? { people: limited ? [...new Set(people).add(data.userId)] : null } : {}
    if (mode === 'value') return act(() => setSecretFn({ data: { ...base, value } }), `Replaced ${base.name}`)
    if (mode === 'access') return act(() => setSecretFn({ data: { ...base, ...access } }), `Updated who can use ${base.name}`)
    if (mode === 'details') return act(() => setSecretFn({ data: { ...base, hosts: hostList, description } }), `Saved ${base.name}`)
    return act(() => setSecretFn({ data: { ...base, value, hosts: hostList, description: description || undefined, ...access } }), `Saved ${base.name}`)
  }

  if (mode === 'remove') {
    return (
      <Modal
        open
        onClose={onClose}
        title={`Remove ${s!.name}?`}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={() => act(() => removeSecretFn({ data: { name: s!.name, scope: s!.scope } }), `Removed ${s!.name}`)}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-ink-2">
          {uses.length
            ? `${uses.map((u) => u.title).join(', ')} ${uses.length > 1 ? 'use' : 'uses'} it and will stop working until it is added again.`
            : 'No flow you can see uses it.'}{' '}
          The value can't be recovered.
        </p>
      </Modal>
    )
  }

  const hostsOk = purpose === 'check' || hostList.length > 0
  const ready = mode === 'value' ? !!value : mode === 'access' ? true : mode === 'details' ? hostsOk : !!name && !!value && hostsOk
  const title = adding ? 'Add a secret' : mode === 'value' ? `Replace ${s!.name}` : mode === 'access' ? `Who can use ${s!.name}` : `Edit ${s!.name}`

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={save}>
            {adding ? 'Save secret' : mode === 'value' ? 'Replace value' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {adding && (
          <>
            <Field label="Name" hint="Flow code refers to it by this name.">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} placeholder="WEATHER_API_KEY" className="font-mono text-[13px]" />
            </Field>
            <Choice
              label="Whose is it"
              value={scope}
              onChange={setScope}
              options={[
                ['team', 'The team', "Everyone's runs can use it, or just the people you pick."],
                ['me', 'Only me', 'Only runs that act as you. It takes the place of a team secret with the same name.'],
              ]}
            />
          </>
        )}

        {(adding || mode === 'value') && (
          <Field label={adding ? 'Value' : 'New value'} hint={adding ? 'Saved encrypted. Nobody can read it back, you included.' : 'Takes effect on the next run. The old value is gone for good.'}>
            <Input autoFocus={!adding} type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste it here" />
          </Field>
        )}

        {(adding || mode === 'details') && (
          <>
            <Choice
              label="What it is for"
              value={purpose}
              onChange={setPurpose}
              options={[
                ['send', 'A flow sends it', 'An API key or token, put on requests to the hosts you list and nowhere else.'],
                ['check', 'It checks webhooks', "A signing secret. A webhook checks its sender's signature with it, and it is never sent anywhere."],
              ]}
            />
            {purpose === 'send' && (
              <Field label="Hosts it may be sent to" hint="Separate several with commas. Use *.example.com for every subdomain.">
                <Input value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="api.openweathermap.org" className="font-mono text-[13px]" />
              </Field>
            )}
            <Field label="Note (optional)" hint="What it is and where it came from, for whoever has to replace it later.">
              <Input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder="Read-only key from the OpenWeather dashboard" />
            </Field>
          </>
        )}

        {((adding && scope === 'team') || mode === 'access') && (
          <div>
            <Choice
              label="Who can use it"
              value={limited ? 'some' : 'everyone'}
              onChange={(v) => setLimited(v === 'some')}
              options={[
                ['everyone', "Everyone's runs", 'Any run in the workspace.'],
                ['some', 'Only certain people', "Runs by anyone else can't use it, admins included."],
              ]}
            />
            {limited && (
              <div className="mt-3">
                <PeoplePicker people={data.members} picked={new Set(people).add(data.userId)} onChange={setPeople} youId={data.userId} fixed={[data.userId]} />
                <p className="mt-2 text-[12.5px] text-ink-3">Use this for a token that acts as a person, like a Slack user token. You stay on the list so your own runs keep working.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Two options side by side, each with a line on what it means. */
function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string, string][] }) {
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-ink-2">{label}</div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
        {options.map(([v, title, about]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              'flex flex-col justify-start rounded-lg border px-3 py-2.5 text-left',
              value === v ? 'border-ink bg-paper/60 shadow-[0_0_0_1px_var(--color-ink)]' : 'border-line hover:border-line-2',
            )}
          >
            <div className="text-[13.5px] font-medium">{title}</div>
            <div className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{about}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
