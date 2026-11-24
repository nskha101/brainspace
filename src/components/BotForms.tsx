import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { botCreateFn, botUpdateFn } from '../lib/api'
import { Button, Field, Input, Modal, Select, Textarea } from './ui'
import { PRESETS, TIMEZONES, presetFor } from './FlowForms'
import { cn, errMessage } from '../lib/utils'

export type BotData = {
  id: string
  name: string
  description: string | null
  instructions: string
  visibility: 'private' | 'team'
  model: string | null
  cron: string | null
  timezone: string
  paths: { read: string[]; write: string[] }
  tools: string[] | null
  allTools: string[]
}

const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)

/** Create a bot, or change one. The schedule, model and access all have sensible defaults, so only a name and instructions are needed. */
export function BotDialog({ open, onClose, bot, defaultModel }: { open: boolean; onClose: () => void; bot?: BotData | null; defaultModel?: string }) {
  const router = useRouter()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'team'>('private')
  const [scheduled, setScheduled] = useState(true)
  const [preset, setPreset] = useState('weekdays')
  const [time, setTime] = useState('09:00')
  const [cron, setCron] = useState('')
  const [tz, setTz] = useState('UTC')
  const [model, setModel] = useState('')
  const [read, setRead] = useState('')
  const [write, setWrite] = useState('')
  const [tools, setTools] = useState<string[] | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const p = presetFor(bot?.cron)
    setName(bot?.name ?? '')
    setDescription(bot?.description ?? '')
    setInstructions(bot?.instructions ?? '')
    setVisibility(bot?.visibility ?? 'private')
    setScheduled(bot ? !!bot.cron : true)
    setPreset(p.preset)
    setTime(p.time)
    setCron(bot?.cron ?? '0 9 * * 1-5')
    setTz(bot?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC')
    setModel(bot?.model ?? '')
    setRead(bot?.paths.read.join('\n') ?? '')
    setWrite(bot?.paths.write.join('\n') ?? '')
    setTools(bot?.tools ?? null)
    setAdvanced(false)
  }, [open, bot])

  const effectiveCron = useMemo(() => {
    if (!scheduled) return null
    if (preset === 'custom') return cron
    const [h, m] = time.split(':').map(Number)
    return PRESETS.find((p) => p.id === preset)!.cron(h ?? 9, m ?? 0)
  }, [scheduled, preset, time, cron])

  const save = async () => {
    setBusy(true)
    try {
      // Untouched access boxes mean "the default for this visibility", which the server works out.
      const paths = read.trim() || write.trim() ? { read: lines(read), write: lines(write) } : null
      const input = {
        name,
        description: description || null,
        instructions,
        visibility,
        cron: effectiveCron,
        timezone: tz,
        model: model.trim() || null,
        tools,
        paths,
      }
      if (bot) {
        await botUpdateFn({ data: { id: bot.id, input } })
        toast.success('Saved')
        await router.invalidate()
        onClose()
      } else {
        const r = await botCreateFn({ data: input })
        onClose()
        navigate({ to: '/app/bots/$botId', params: { botId: r.id } })
      }
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const allTools = bot?.allTools ?? []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={bot ? `Edit ${bot.name}` : 'New bot'}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {bot ? 'Save' : 'Create bot'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!bot && (
          <p className="text-[13.5px] text-ink-2">
            The easiest way is to ask your agent: <span className="italic">"Make a Brainspace bot that…"</span>. It writes the instructions and picks the schedule. Or set one up here.
          </p>
        )}
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monday competitor digest" maxLength={60} />
        </Field>
        <Field label="What it does" hint="Brief it like a colleague: what to check, where to write the result, and what to do when there's nothing new. It sees only this.">
          <Textarea
            rows={7}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Read the notes in /team/meetings from the last day. Add any action items to /team/meetings/action-items.md under the person who owns them. If there are none, change nothing."
          />
        </Field>
        <Field label="Runs">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-wash p-1 text-[13px]">
              {(
                [
                  [true, 'On a schedule'],
                  [false, 'Only when asked'],
                ] as const
              ).map(([v, l]) => (
                <button key={l} type="button" onClick={() => setScheduled(v)} className={cn('rounded-md py-1.5 font-medium', scheduled === v ? 'bg-sheet text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>
                  {l}
                </button>
              ))}
            </div>
            {scheduled && (
              <>
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
                <Select value={tz} onChange={(e) => setTz(e.target.value)}>
                  {(TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES]).map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              </>
            )}
          </div>
        </Field>
        <Field label="Who can see it" hint={visibility === 'team' ? 'Everyone sees it and its runs. It works in /team only, still acting as you.' : 'Only you. It can use /team and your personal space.'}>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-wash p-1 text-[13px]">
            {(
              [
                ['private', 'Just me'],
                ['team', 'The team'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setVisibility(v)} className={cn('rounded-md py-1.5 font-medium', visibility === v ? 'bg-sheet text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>
                {l}
              </button>
            ))}
          </div>
        </Field>

        <button type="button" onClick={() => setAdvanced((a) => !a)} className="text-[13px] font-medium text-ink-2 hover:text-ink">
          {advanced ? 'Hide' : 'Show'} model and access
        </button>
        {advanced && (
          <div className="space-y-4 rounded-lg border border-line p-4">
            <Field label="One-line description (optional)">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
            </Field>
            <Field label="Model" hint="An AI Gateway id that supports tool calling. Leave empty for the workspace default.">
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={defaultModel ?? 'anthropic/claude-sonnet-5.5'} className="font-mono text-[13px]" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="May read" hint="One path per line. Empty means everything it can see.">
                <Textarea rows={3} value={read} onChange={(e) => setRead(e.target.value)} placeholder="/team/research" className="font-mono text-[12.5px]" />
              </Field>
              <Field label="May change" hint="It can read these too.">
                <Textarea rows={3} value={write} onChange={(e) => setWrite(e.target.value)} placeholder="/team/research/digests" className="font-mono text-[12.5px]" />
              </Field>
            </div>
            {allTools.length > 0 && (
              <Field label="Tools" hint={tools ? `${tools.length} of ${allTools.length} allowed.` : 'All of them. Untick any it should not have.'}>
                <div className="flex flex-wrap gap-1.5">
                  {allTools.map((t) => {
                    const on = !tools || tools.includes(t)
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          const next = on ? (tools ?? allTools).filter((x) => x !== t) : [...(tools ?? []), t]
                          setTools(next.length === allTools.length ? null : next)
                        }}
                        className={cn('rounded border px-1.5 py-0.5 font-mono text-[11.5px]', on ? 'border-line-2 bg-sheet text-ink' : 'border-line bg-paper text-ink-3 line-through')}
                      >
                        {t}
                      </button>
                    )
                  })}
                </div>
              </Field>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
