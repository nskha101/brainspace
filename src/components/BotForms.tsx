import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { botCreateFn, botUpdateFn, teammatesFn } from '../lib/api'
import { Button, Field, IconPicker, Input, Modal, Select, Textarea, type Choice } from './ui'
import { PRESETS, TIMEZONES, presetFor } from './FlowForms'
import { WHO_EVERYONE, WHO_ME, WHO_SOME, WhoFields, namesList, sameIds, type Who } from './Share'
import { cn, errMessage } from '../lib/utils'

export type BotData = {
  id: string
  name: string
  /** workspace: the workspace's own bot. It has no schedule, sharing or paths to edit. */
  kind?: 'bot' | 'workspace'
  icon: string | null
  description: string | null
  instructions: string
  visibility: 'private' | 'team'
  sharedWith: { userId: string; name: string }[] | null
  model: string | null
  cron: string | null
  timezone: string
  paths: { read: string[]; write: string[] }
  tools: string[] | null
  allTools: string[]
}

type Sharing = Pick<BotData, 'visibility' | 'sharedWith'>
type Teammates = Awaited<ReturnType<typeof teammatesFn>>

/** Who a bot is shared with, in the terms of the share dropdown. */
export const botWho = (b: Sharing): Who => (b.visibility !== 'team' ? 'me' : b.sharedWith ? 'some' : 'everyone')

const BOT_WHO: Choice<Who>[] = [
  { ...WHO_ME, detail: 'It can use /team and your personal space.' },
  { ...WHO_EVERYONE, detail: 'They see it and its runs, and can run it.' },
  { ...WHO_SOME, detail: 'Only they see it and its runs, and can run it.' },
]
const TEAM_NOTE = 'A shared bot works in /team only, still acting as you, and stays out of folders only some people can open.'

/** The people a bot can be shared with, loaded when a dialog that needs them opens. */
function useTeammates(open: boolean) {
  const [data, setData] = useState<Teammates | null>(null)
  useEffect(() => {
    if (!open || data) return
    teammatesFn()
      .then(setData)
      .catch((e) => toast.error(errMessage(e)))
  }, [open])
  return data
}

/** What to send bot_update for a choice in the share dropdown. */
const sharingInput = (who: Who, picked: Set<string>, youId: string) =>
  who === 'me' ? { visibility: 'private' as const } : { visibility: 'team' as const, people: who === 'some' ? [...picked].filter((id) => id !== youId) : null }

/** Share a bot you own: keep it to yourself, or share it and its runs with everyone or with the people picked. */
export function BotShareDialog({ bot, open, onClose }: { bot: Sharing & { id: string; name: string }; open: boolean; onClose: () => void }) {
  const router = useRouter()
  const mates = useTeammates(open)
  const [who, setWho] = useState<Who>('me')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const saved = (bot.sharedWith ?? []).map((p) => p.userId)

  useEffect(() => {
    if (!open) return
    setWho(botWho(bot))
    setPicked(new Set(saved))
  }, [open, bot])

  const others = !!mates && [...picked].some((id) => id !== mates.userId)
  const changed = !!mates && (who !== botWho(bot) || (who === 'some' && !sameIds(picked, saved, mates.userId)))

  const save = async () => {
    if (!mates) return
    setBusy(true)
    try {
      await botUpdateFn({ data: { id: bot.id, input: sharingInput(who, picked, mates.userId) } })
      const people = mates.members.filter((m) => m.userId === mates.userId || picked.has(m.userId))
      toast.success(who === 'me' ? `Only you can see ${bot.name} now` : who === 'some' ? `Only ${namesList(people, mates.userId)} can see ${bot.name} now` : `${bot.name} is shared with everyone`)
      await router.invalidate()
      onClose()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Share ${bot.name}`}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!changed || (who === 'some' && !others)}>
            Save
          </Button>
        </>
      }
    >
      {!mates ? (
        <div className="flex justify-center py-8 text-ink-3">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <WhoFields who={who} onWho={setWho} options={BOT_WHO} people={mates.members} picked={picked} onPicked={setPicked} youId={mates.userId} />
          {who !== 'me' && <p className="text-xs text-ink-3">{TEAM_NOTE}</p>}
        </div>
      )}
    </Modal>
  )
}

const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)

/** Create a bot, or change one. The schedule, model and access all have sensible defaults, so only a name and instructions are needed. */
export function BotDialog({ open, onClose, bot, defaultModel }: { open: boolean; onClose: () => void; bot?: BotData | null; defaultModel?: string }) {
  const router = useRouter()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const mates = useTeammates(open)
  const [who, setWho] = useState<Who>('me')
  const [picked, setPicked] = useState<Set<string>>(new Set())
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
    setIcon(bot?.icon ?? null)
    setDescription(bot?.description ?? '')
    setInstructions(bot?.instructions ?? '')
    setWho(bot ? botWho(bot) : 'me')
    setPicked(new Set((bot?.sharedWith ?? []).map((p) => p.userId)))
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

  const general = bot?.kind === 'workspace'

  const save = async () => {
    setBusy(true)
    try {
      if (bot && general) {
        // The workspace's own bot is always shared, unscheduled and in /team, so only these change.
        await botUpdateFn({ data: { id: bot.id, input: { name, icon, description: description || null, instructions, model: model.trim() || null, tools } } })
        toast.success('Saved')
        await router.invalidate()
        onClose()
        return
      }
      // Untouched access boxes mean "the default for this visibility", which the server works out.
      const paths = read.trim() || write.trim() ? { read: lines(read), write: lines(write) } : null
      const input = {
        name,
        icon,
        description: description || null,
        instructions,
        ...sharingInput(who, picked, mates?.userId ?? ''),
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
          <Button variant="primary" onClick={save} loading={busy} disabled={!general && who === 'some' && ![...picked].some((id) => id !== mates?.userId)}>
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
        <Field label="Icon and name">
          <IconPicker value={icon} onChange={setIcon} kind="bot">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monday competitor digest" maxLength={60} className="h-[42px] flex-1" aria-label="Name" />
          </IconPicker>
        </Field>
        <Field
          label={general ? 'Instructions' : 'What it does'}
          hint={
            general
              ? 'How it should work for everyone who asks: what the team is about, where things live, how to answer. It follows these on every request.'
              : "Brief it like a colleague: what to check, where to write the result, and what to do when there's nothing new. It sees only this."
          }
        >
          <Textarea
            rows={7}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Read the notes in /team/meetings from the last day. Add any action items to /team/meetings/action-items.md under the person who owns them. If there are none, change nothing."
          />
        </Field>
        {!general && <Field label="Runs">
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
        </Field>}
        {!general && <WhoFields who={who} onWho={setWho} options={BOT_WHO} people={mates?.members ?? []} picked={picked} onPicked={setPicked} youId={mates?.userId ?? ''} />}
        {!general && who !== 'me' && <p className="-mt-2 text-xs text-ink-3">{TEAM_NOTE}</p>}

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
            {!general && <div className="grid gap-4 sm:grid-cols-2">
              <Field label="May read" hint="One path per line. Empty means everything it can see.">
                <Textarea rows={3} value={read} onChange={(e) => setRead(e.target.value)} placeholder="/team/research" className="font-mono text-[12.5px]" />
              </Field>
              <Field label="May change" hint="It can read these too.">
                <Textarea rows={3} value={write} onChange={(e) => setWrite(e.target.value)} placeholder="/team/research/digests" className="font-mono text-[12.5px]" />
              </Field>
            </div>}
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
