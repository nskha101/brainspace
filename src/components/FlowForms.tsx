import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { FilePen, Mail, Plug, Plus, Trash2, Webhook, Check, Clock, Loader2, X, Pause, CircleDashed } from 'lucide-react'
import { common, createLowlight } from 'lowlight'
import { connectionsFn, flowCreateFn, flowRunFn, flowTriggerSetFn } from '../lib/api'
import { Badge, Button, CopyField, Field, Input, Modal, Select, Textarea } from './ui'
import { cn, errMessage } from '../lib/utils'

export type InputSpec = { type: string; description?: string; required?: boolean; default?: unknown; enum?: string[] }
export type Destination = import('../server/db').FlowDestination
type Json = import('../server/db').Json

// ------------------------------------------------------------ status

export function RunStatus({ status, test }: { status: string; test?: boolean }) {
  const map: Record<string, { tone: 'neutral' | 'ok' | 'danger' | 'brand'; icon: ReactNode; label: string }> = {
    queued: { tone: 'neutral', icon: <CircleDashed className="size-3" />, label: 'Queued' },
    running: { tone: 'brand', icon: <Loader2 className="size-3 animate-spin" />, label: 'Running' },
    waiting: { tone: 'neutral', icon: <Clock className="size-3" />, label: 'Needs approval' },
    succeeded: { tone: 'ok', icon: <Check className="size-3" />, label: 'Succeeded' },
    failed: { tone: 'danger', icon: <X className="size-3" />, label: 'Failed' },
    cancelled: { tone: 'neutral', icon: <Pause className="size-3" />, label: 'Cancelled' },
  }
  const s = map[status] ?? map.queued!
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={s.tone} className={status === 'waiting' ? 'bg-[#fbeccb] text-[#8a5a00]' : undefined}>
        {s.icon}
        {s.label}
      </Badge>
      {test && <Badge>Test</Badge>}
    </span>
  )
}

export function duration(from: number, to?: number | null) {
  const ms = (to ?? Date.now()) - from
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 90) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m}m`
  return `${(m / 60).toFixed(1)}h`
}

export function when(ms: number) {
  const diff = ms - Date.now()
  const abs = Math.abs(diff)
  const fmt = new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  if (abs < 60_000) return diff > 0 ? 'in under a minute' : 'just now'
  if (diff > 0 && abs < 86_400_000) {
    const h = Math.floor(abs / 3_600_000)
    const m = Math.round((abs % 3_600_000) / 60_000)
    return `in ${h ? `${h}h ` : ''}${m}m`
  }
  return fmt
}

// ------------------------------------------------------------ inputs

export function InputsForm({
  specs,
  values,
  onChange,
}: {
  specs: Record<string, InputSpec>
  values: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
}) {
  const keys = Object.keys(specs)
  if (!keys.length) return <p className="text-[13px] text-ink-3">This flow takes no inputs.</p>
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v })
  return (
    <div className="space-y-3.5">
      {keys.map((k) => {
        const s = specs[k]!
        const v = values[k]
        const label = `${k}${s.required ? '' : ' (optional)'}`
        const hint = [s.description, s.default !== undefined ? `Default: ${Array.isArray(s.default) ? s.default.join(', ') : String(s.default)}` : null].filter(Boolean).join('. ')
        if (s.enum?.length) {
          return (
            <Field key={k} label={label} hint={hint}>
              <Select className="w-full" value={String(v ?? '')} onChange={(e) => set(k, e.target.value)}>
                <option value="">Choose…</option>
                {s.enum.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            </Field>
          )
        }
        if (s.type === 'boolean') {
          return (
            <label key={k} className="flex items-center gap-2 text-[13.5px]">
              <input type="checkbox" checked={v === true || v === 'true'} onChange={(e) => set(k, e.target.checked)} />
              <span className="font-medium text-ink-2">{k}</span>
              {s.description && <span className="text-ink-3">{s.description}</span>}
            </label>
          )
        }
        if (s.type === 'markdown' || s.type === 'json' || s.type.endsWith('[]')) {
          const text = Array.isArray(v) ? v.join('\n') : typeof v === 'object' && v ? JSON.stringify(v, null, 2) : String(v ?? '')
          return (
            <Field key={k} label={label} hint={s.type.endsWith('[]') ? `One per line. ${hint}` : hint}>
              <Textarea
                rows={s.type === 'markdown' ? 6 : 3}
                className={s.type === 'json' ? 'font-mono text-[12.5px]' : undefined}
                value={text}
                onChange={(e) => set(k, s.type.endsWith('[]') ? e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) : e.target.value)}
              />
            </Field>
          )
        }
        return (
          <Field key={k} label={label} hint={hint}>
            <Input type={s.type === 'number' ? 'number' : 'text'} value={String(v ?? '')} onChange={(e) => set(k, e.target.value)} />
          </Field>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------ destinations

type ConnOption = { slug: string; name: string }

export function destinationLabel(d: Destination) {
  switch (d.to) {
    case 'drive':
      return d.path
    case 'connection':
      return `${d.connection} · ${d.tool}`
    case 'email':
      return `Email ${d.members.join(', ')}`
    case 'webhook':
      try {
        return `POST ${new URL(d.url).host}`
      } catch {
        return 'Webhook'
      }
  }
}

export function DestinationsEditor({
  value,
  onChange,
  outputs,
  flowName,
}: {
  value: Destination[]
  onChange: (v: Destination[]) => void
  outputs: string[]
  flowName: string
}) {
  const [conns, setConns] = useState<ConnOption[] | null>(null)
  useEffect(() => {
    if (conns || !value.some((d) => d.to === 'connection')) return
    connectionsFn()
      .then((r) => setConns(r.connections.filter((c) => c.usable).map((c) => ({ slug: c.slug, name: c.name }))))
      .catch(() => setConns([]))
  }, [value, conns])
  const update = (i: number, d: Destination) => onChange(value.map((x, j) => (j === i ? d : x)))
  const add = (d: Destination) => onChange([...value, d])
  const outputSelect = (d: { output?: string }, i: number, cur: Destination) =>
    outputs.length > 1 && (
      <Select className="w-full" value={d.output ?? outputs[0]} onChange={(e) => update(i, { ...cur, output: e.target.value } as Destination)}>
        {outputs.map((o) => (
          <option key={o} value={o}>
            Output: {o}
          </option>
        ))}
      </Select>
    )

  return (
    <div className="space-y-2.5">
      {value.length === 0 && <p className="text-[13px] text-ink-3">Results stay on the run page. Add a destination to save or send them.</p>}
      {value.map((d, i) => (
        <div key={i} className="rounded-lg border border-line bg-paper/50 p-3">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-ink-2">
            {d.to === 'drive' ? <FilePen className="size-3.5" /> : d.to === 'connection' ? <Plug className="size-3.5" /> : d.to === 'email' ? <Mail className="size-3.5" /> : <Webhook className="size-3.5" />}
            {d.to === 'drive' ? 'Save to the drive' : d.to === 'connection' ? 'Send with a connection' : d.to === 'email' ? 'Email' : 'Webhook'}
            <button type="button" className="ml-auto rounded p-1 text-ink-3 hover:bg-wash hover:text-danger" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove">
              <Trash2 className="size-3.5" />
            </button>
          </div>
          {d.to === 'drive' && (
            <div className="space-y-2">
              <Input value={d.path} placeholder={`/team/reports/${flowName}/{date}.md`} onChange={(e) => update(i, { ...d, path: e.target.value })} className="font-mono text-[12.5px]" />
              <div className="flex gap-2">
                <Select className="w-full" value={d.mode ?? 'new'} onChange={(e) => update(i, { ...d, mode: e.target.value as 'new' })}>
                  <option value="new">A new doc each run</option>
                  <option value="version">A new version of the same doc</option>
                  <option value="append">Add to the end of the doc</option>
                </Select>
                {outputSelect(d, i, d)}
              </div>
              <p className="text-[12px] text-ink-3">
                Use <code>{'{date}'}</code>, <code>{'{time}'}</code> or <code>{'{inputs.name}'}</code> in the path.
              </p>
            </div>
          )}
          {d.to === 'connection' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Select className="w-full" value={d.connection} onChange={(e) => update(i, { ...d, connection: e.target.value })}>
                  <option value="">Connection…</option>
                  {(conns ?? []).map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Input value={d.tool} placeholder="Tool name" onChange={(e) => update(i, { ...d, tool: e.target.value })} className="font-mono text-[12.5px]" />
              </div>
              <JsonArgs value={d.args} onChange={(args) => update(i, { ...d, args })} />
              <p className="text-[12px] text-ink-3">
                Arguments can use <code>{'{outputs.report}'}</code>, <code>{'{links.run}'}</code>, <code>{'{links.doc}'}</code> and <code>{'{date}'}</code>.
              </p>
            </div>
          )}
          {d.to === 'email' && (
            <div className="space-y-2">
              <Input
                value={d.members.join(', ')}
                placeholder="me, team, or member emails"
                onChange={(e) => update(i, { ...d, members: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
              />
              <div className="flex gap-2">
                <Input value={d.subject ?? ''} placeholder={`${flowName} ({date})`} onChange={(e) => update(i, { ...d, subject: e.target.value || undefined })} />
                {outputSelect(d, i, d)}
              </div>
            </div>
          )}
          {d.to === 'webhook' && (
            <div className="space-y-2">
              <Input value={d.url} placeholder="https://hooks.example.com/…" onChange={(e) => update(i, { ...d, url: e.target.value })} className="font-mono text-[12.5px]" />
              <JsonArgs value={(d.headers ?? {}) as Record<string, Json>} onChange={(h) => update(i, { ...d, headers: Object.keys(h).length ? (h as Record<string, string>) : undefined })} placeholder={'{ "Authorization": "Bearer {secrets.HOOK_TOKEN}" }'} />
              <p className="text-[12px] text-ink-3">Optional headers. Use {'{secrets.NAME}'} for a saved secret bound to this host.</p>
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" onClick={() => add({ to: 'drive', path: `/team/reports/${flowName}/{date}.md`, mode: 'new' })}>
          <Plus className="size-3.5" /> Drive
        </Button>
        <Button type="button" size="sm" onClick={() => add({ to: 'connection', connection: '', tool: '', args: {} })}>
          <Plus className="size-3.5" /> Connection
        </Button>
        <Button type="button" size="sm" onClick={() => add({ to: 'email', members: ['me'] })}>
          <Plus className="size-3.5" /> Email
        </Button>
        <Button type="button" size="sm" onClick={() => add({ to: 'webhook', url: '' })}>
          <Plus className="size-3.5" /> Webhook
        </Button>
      </div>
    </div>
  )
}

function JsonArgs({ value, onChange, placeholder }: { value: Record<string, Json>; onChange: (v: Record<string, Json>) => void; placeholder?: string }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2))
  const [bad, setBad] = useState(false)
  return (
    <Textarea
      rows={4}
      value={text}
      className={cn('font-mono text-[12px]', bad && 'border-danger')}
      placeholder={placeholder ?? '{ "channel": "#growth", "text": "{outputs.report}" }'}
      onChange={(e) => {
        setText(e.target.value)
        try {
          onChange(JSON.parse(e.target.value || '{}'))
          setBad(false)
        } catch {
          setBad(true)
        }
      }}
    />
  )
}

function cleanDestinations(list: Destination[]) {
  return list.filter((d) => (d.to === 'drive' ? d.path.trim() : d.to === 'connection' ? d.connection && d.tool : d.to === 'email' ? d.members.length : d.url.trim()))
}

// ------------------------------------------------------------ run dialog

export function RunDialog({
  open,
  onClose,
  flow,
}: {
  open: boolean
  onClose: () => void
  flow: { id: string; name: string; inputs: Record<string, InputSpec>; outputs: string[]; secrets?: { name: string; team: boolean; mine: boolean }[] }
}) {
  const navigate = useNavigate()
  const [values, setValues] = useState<Record<string, unknown>>({})
  const missing = (flow.secrets ?? []).filter((s) => !s.team && !s.mine).map((s) => s.name)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [deliver, setDeliver] = useState<Destination[]>([])
  const [busy, setBusy] = useState<'run' | 'test' | null>(null)
  useEffect(() => {
    if (open) {
      setValues({})
      setDeliver([])
      setSecrets({})
    }
  }, [open])
  const start = async (test: boolean) => {
    setBusy(test ? 'test' : 'run')
    try {
      const given = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v))
      const r = await flowRunFn({ data: { id: flow.id, inputs: values, deliver: cleanDestinations(deliver), test, secrets: Object.keys(given).length ? given : undefined } })
      onClose()
      navigate({ to: '/app/flows/runs/$runId', params: { runId: r.runId } })
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Run ${flow.name}`}
      width={560}
      footer={
        <>
          <Button onClick={() => start(true)} loading={busy === 'test'} disabled={!!busy} title="Real reads and AI, but nothing is written or sent">
            Test run
          </Button>
          <Button variant="primary" onClick={() => start(false)} loading={busy === 'run'} disabled={!!busy}>
            Run now
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <InputsForm specs={flow.inputs} values={values} onChange={setValues} />
        {missing.length > 0 && (
          <div className="rounded-lg border border-[#e8c87a] bg-[#fdf6e7] p-3.5">
            <div className="text-[13px] font-medium text-[#8a5a00]">This flow needs {missing.length > 1 ? 'secrets that aren\'t' : 'a secret that isn\'t'} saved</div>
            <p className="mt-0.5 mb-2.5 text-[12.5px] text-ink-2">
              Paste {missing.length > 1 ? 'them' : 'it'} for this run only, or save {missing.length > 1 ? 'them' : 'it'} in Settings → Secrets so schedules can use {missing.length > 1 ? 'them' : 'it'}.
            </p>
            <div className="space-y-2">
              {missing.map((n) => (
                <Input key={n} type="password" autoComplete="off" placeholder={n} value={secrets[n] ?? ''} onChange={(e) => setSecrets({ ...secrets, [n]: e.target.value })} className="bg-sheet font-mono text-[13px]" />
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-2">Send results to</div>
          <DestinationsEditor value={deliver} onChange={setDeliver} outputs={flow.outputs} flowName={flow.name} />
        </div>
        <p className="text-[12px] text-ink-3">A test run does the real reads and AI calls, but records writes and deliveries instead of making them.</p>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------ trigger dialog

const PRESETS = [
  { id: 'weekdays', label: 'Every weekday', cron: (h: number, m: number) => `${m} ${h} * * 1-5` },
  { id: 'daily', label: 'Every day', cron: (h: number, m: number) => `${m} ${h} * * *` },
  { id: 'monday', label: 'Every Monday', cron: (h: number, m: number) => `${m} ${h} * * 1` },
  { id: 'friday', label: 'Every Friday', cron: (h: number, m: number) => `${m} ${h} * * 5` },
  { id: 'monthly', label: 'On the 1st of each month', cron: (h: number, m: number) => `${m} ${h} 1 * *` },
  { id: 'hourly', label: 'Every hour', cron: (_h: number, m: number) => `${m} * * * *` },
  { id: 'custom', label: 'Custom (cron)', cron: () => '' },
] as const

function presetFor(cron: string | null | undefined) {
  if (!cron) return { preset: 'weekdays', time: '09:00' }
  const parts = cron.trim().split(/\s+/)
  const [m, h] = parts
  const time = /^\d+$/.test(h ?? '') && /^\d+$/.test(m ?? '') ? `${h!.padStart(2, '0')}:${m!.padStart(2, '0')}` : '09:00'
  for (const p of PRESETS) {
    if (p.id === 'custom') continue
    const [hh, mm] = time.split(':').map(Number)
    if (p.cron(hh!, mm!) === cron.trim()) return { preset: p.id, time }
  }
  return { preset: 'custom', time }
}

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone')
  } catch {
    return ['UTC', 'America/New_York', 'America/Toronto', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Singapore', 'Australia/Sydney']
  }
})()

export type TriggerData = {
  id: string
  kind: 'manual' | 'schedule' | 'webhook'
  name: string
  cron: string | null
  timezone: string | null
  inputs: Record<string, unknown>
  deliver: Destination[]
  enabled: boolean
}

export function TriggerDialog({
  open,
  onClose,
  flow,
  trigger,
  initialKind = 'schedule',
}: {
  open: boolean
  onClose: () => void
  flow: { id: string; name: string; inputs: Record<string, InputSpec>; outputs: string[] }
  trigger?: TriggerData | null
  initialKind?: 'manual' | 'schedule' | 'webhook'
}) {
  const router = useRouter()
  const [kind, setKind] = useState<TriggerData['kind']>(initialKind)
  const [name, setName] = useState('')
  const [preset, setPreset] = useState('weekdays')
  const [time, setTime] = useState('09:00')
  const [cron, setCron] = useState('')
  const [tz, setTz] = useState('UTC')
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [deliver, setDeliver] = useState<Destination[]>([])
  const [busy, setBusy] = useState(false)
  const [hookUrl, setHookUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const p = presetFor(trigger?.cron)
    setKind(trigger?.kind ?? initialKind)
    setName(trigger?.name ?? '')
    setPreset(p.preset)
    setTime(p.time)
    setCron(trigger?.cron ?? '0 9 * * 1-5')
    setTz(trigger?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC')
    setValues(trigger?.inputs ?? {})
    setDeliver(trigger?.deliver ?? [])
    setHookUrl(null)
  }, [open, trigger, initialKind])

  const effectiveCron = useMemo(() => {
    if (preset === 'custom') return cron
    const [h, m] = time.split(':').map(Number)
    return PRESETS.find((p) => p.id === preset)!.cron(h ?? 9, m ?? 0)
  }, [preset, time, cron])

  const save = async () => {
    setBusy(true)
    try {
      const r = await flowTriggerSetFn({
        data: {
          flow: flow.id,
          id: trigger?.id,
          kind,
          name: name.trim() || undefined,
          cron: kind === 'schedule' ? effectiveCron : undefined,
          timezone: kind === 'schedule' ? tz : undefined,
          inputs: values,
          deliver: cleanDestinations(deliver),
        },
      })
      await router.invalidate()
      if (r.webhookNote && r.webhookUrl) {
        setHookUrl(r.webhookUrl)
      } else {
        toast.success(kind === 'schedule' ? `Scheduled: ${r.schedule}` : 'Saved')
        onClose()
      }
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (hookUrl) {
    return (
      <Modal open={open} onClose={onClose} title="Webhook ready" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <p className="mb-3 text-[13.5px] text-ink-2">POST JSON to this URL to start a run. The body becomes the inputs. This is the only time the URL is shown.</p>
        <CopyField value={hookUrl} />
        <pre className="mt-3 overflow-x-auto rounded-md bg-paper p-3 font-mono text-[12px] text-ink-2">{`curl -X POST ${hookUrl} \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(Object.fromEntries(Object.keys(flow.inputs).map((k) => [k, '…'])))}'`}</pre>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={trigger ? 'Edit trigger' : `Automate ${flow.name}`}
      width={580}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {trigger ? 'Save' : kind === 'schedule' ? 'Schedule it' : kind === 'webhook' ? 'Create webhook' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {!trigger && (
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-wash p-1 text-[13px]">
            {(
              [
                ['schedule', 'On a schedule'],
                ['webhook', 'From a webhook'],
                ['manual', 'Saved preset'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn('rounded-md py-1.5 font-medium', kind === k ? 'bg-sheet text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <Field label="Name (optional)">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'schedule' ? 'Weekly digest for the growth team' : kind === 'webhook' ? 'From our meeting recorder' : 'Acme account'} />
        </Field>
        {kind === 'schedule' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Select className="flex-1" value={preset} onChange={(e) => setPreset(e.target.value)}>
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
              {preset === 'custom' ? (
                <Input className="w-40 font-mono text-[12.5px]" value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 9 * * 1-5" />
              ) : preset === 'hourly' ? (
                <Select className="w-28" value={time.split(':')[1]} onChange={(e) => setTime(`00:${e.target.value}`)}>
                  {['00', '15', '30', '45'].map((m) => (
                    <option key={m} value={m}>
                      at :{m}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input type="time" className="w-32" value={time} onChange={(e) => setTime(e.target.value)} />
              )}
            </div>
            <Select className="w-full" value={tz} onChange={(e) => setTz(e.target.value)}>
              {TIMEZONES.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
            <p className="font-mono text-[11.5px] text-ink-3">cron: {effectiveCron || '…'}</p>
          </div>
        )}
        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-2">Inputs</div>
          <InputsForm specs={flow.inputs} values={values} onChange={setValues} />
          {kind === 'webhook' && <p className="mt-2 text-[12px] text-ink-3">These are defaults. The webhook's JSON body overrides them.</p>}
        </div>
        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-2">Send results to</div>
          <DestinationsEditor value={deliver} onChange={setDeliver} outputs={flow.outputs} flowName={flow.name} />
        </div>
        <p className="text-[12px] text-ink-3">
          It runs as you, with your access. If the flow later asks for more access, it pauses until you approve.
        </p>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------ new flow

export function NewFlowDialog({
  open,
  onClose,
  templates,
}: {
  open: boolean
  onClose: () => void
  templates: { id: string; title: string; description: string; needs: string[] }[]
}) {
  const navigate = useNavigate()
  const [template, setTemplate] = useState('blank')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setTemplate('blank')
      setName('')
    }
  }, [open])
  const create = async () => {
    setBusy(true)
    try {
      const r = await flowCreateFn({ data: { name: name || (template === 'blank' ? 'my-flow' : template), template } })
      onClose()
      navigate({ to: '/app/flows/$flowId', params: { flowId: r.id } })
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const all = [{ id: 'blank', title: 'Blank flow', description: 'Start from a minimal example.', needs: [] as string[] }, ...templates]
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New flow"
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={create} loading={busy}>
            Create in my drive
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-2">
          The easiest way is to ask your agent: <span className="italic">"Make a Brainspace flow that…"</span>. Or start from a template here and let your agent adapt it.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {all.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTemplate(t.id)
                if (!name || all.some((x) => x.id === name)) setName(t.id === 'blank' ? '' : t.id)
              }}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                template === t.id ? 'border-ink bg-paper ring-1 ring-ink' : 'border-line hover:border-line-2 hover:bg-paper',
              )}
            >
              <div className="text-[13.5px] font-medium">{t.title}</div>
              <div className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3">{t.description}</div>
              {t.needs.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {t.needs.map((n) => (
                    <Badge key={n}>{n}</Badge>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
        <Field label="Name" hint="Lowercase with dashes. It starts in /me/flows; promote it to share with the team.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="weekly-metrics" />
        </Field>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------ code view

const lowlight = createLowlight(common)

type Hast = { type: string; value?: string; tagName?: string; properties?: { className?: string[] }; children?: Hast[] }

function renderHast(n: Hast, key: number): ReactNode {
  if (n.type === 'text') return n.value
  const kids = (n.children ?? []).map((c, i) => renderHast(c, i))
  if (n.type === 'element') return <span key={key} className={(n.properties?.className ?? []).join(' ')}>{kids}</span>
  return kids
}

export function CodeView({ code, language = 'typescript' }: { code: string; language?: string }) {
  const tree = useMemo(() => {
    try {
      return lowlight.highlight(language, code) as unknown as Hast
    } catch {
      return { type: 'root', children: [{ type: 'text', value: code }] } as Hast
    }
  }, [code, language])
  const lines = code.split('\n').length
  return (
    <div className="doc-code flex overflow-x-auto rounded-lg border border-line bg-[#fbfafc] font-mono text-[12.5px] leading-[1.6]">
      <div className="shrink-0 border-r border-line px-3 py-3 text-right text-ink-3 select-none">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="hljs min-w-0 flex-1 px-4 py-3">
        <code>{renderHast(tree, 0)}</code>
      </pre>
    </div>
  )
}
