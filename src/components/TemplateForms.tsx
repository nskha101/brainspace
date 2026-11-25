import { useEffect, useState } from 'react'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CircleCheck, CircleDashed } from 'lucide-react'
import { templateCreateFn, templateUseFn } from '../lib/api'
import { Button, CopyField, Field, Input, Modal } from './ui'
import { cn, errMessage } from '../lib/utils'

/** Where a template's page lives in the app, from its folder path (/team/templates/x). */
export function templateHref(path: string) {
  const [, space, , name] = path.split('/')
  return { to: '/app/templates/$space/$name' as const, params: { space: space!, name: name! } }
}

/** Save a bot, and the flows that run it, as a template teammates can set up for themselves. */
export function SaveTemplateDialog({
  open,
  onClose,
  bot,
}: {
  open: boolean
  onClose: () => void
  bot: { id: string; name: string; description: string | null; flows: { id: string; name: string }[] }
}) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [flows, setFlows] = useState<string[]>([])
  const [share, setShare] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(bot.name)
    setDescription(bot.description ?? '')
    setFlows(bot.flows.map((f) => f.id))
    setShare(false)
    // Only when it opens: the bot page refreshes while runs go on, and that mustn't wipe what's typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bot.id])

  const save = async () => {
    setBusy(true)
    try {
      const r = await templateCreateFn({
        data: { bots: [bot.id], flows, title: title.trim() || undefined, description: description.trim() || undefined, space: share ? 'team' : 'me' },
      })
      toast.success(`Saved ${r.title} as a template. Check its files for anything that's only yours.`)
      onClose()
      navigate(templateHref(r.path))
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
      title="Save as a template"
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Save template
          </Button>
        </>
      }
    >
      <p className="mb-4 text-[13.5px] text-ink-2">
        Teammates get their own copy of this bot, running with their own logins, secrets and docs. Your name and email become theirs. Memory, webhook URLs and runs stay with yours.
      </p>
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </Field>
        <Field label="What someone gets" hint="One line, shown on the Bots page.">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </Field>
        {bot.flows.length > 0 && (
          <Field label="Flows to include" hint="The flows that run this bot. Leave one out if it only makes sense for you.">
            <div className="space-y-1.5">
              {bot.flows.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-[13.5px]">
                  <input
                    type="checkbox"
                    checked={flows.includes(f.id)}
                    onChange={(e) => setFlows((list) => (e.target.checked ? [...list, f.id] : list.filter((x) => x !== f.id)))}
                  />
                  <span className="font-mono text-[12.5px]">{f.name}</span>
                </label>
              ))}
            </div>
          </Field>
        )}
        <Field
          label="Who can use it"
          hint={share ? 'It goes to /team/templates right away.' : 'It starts in /me/templates so you can check it, then you share it from its page.'}
        >
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-wash p-1 text-[13px]">
            {(
              [
                [false, 'Just me for now'],
                [true, 'The team'],
              ] as const
            ).map(([v, l]) => (
              <button key={l} type="button" onClick={() => setShare(v)} className={cn('rounded-md py-1.5 font-medium', share === v ? 'bg-sheet text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>
                {l}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  )
}

type UseResult = Awaited<ReturnType<typeof templateUseFn>>

/** Make your own copy of a template: ask for its fields, then show what was made and what's left. */
export function UseTemplateDialog({
  open,
  onClose,
  template,
  userName,
}: {
  open: boolean
  onClose: () => void
  template: { path: string; title: string; fields: { name: string; about: string }[]; ask: string }
  userName: string
}) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<UseResult | null>(null)

  useEffect(() => {
    if (!open) return
    setValues({})
    setResult(null)
  }, [open])

  const close = () => {
    if (result) router.invalidate()
    onClose()
  }

  const submit = async () => {
    setBusy(true)
    try {
      const fields = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()))
      setResult(await templateUseFn({ data: { path: template.path, fields } }))
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <Modal open={open} onClose={close} title={`${template.title} is set up`} width={560} footer={<Button variant="primary" onClick={close}>Done</Button>}>
        <div className="space-y-4 text-[13.5px]">
          <div>
            <p className="text-ink-2">Made for you, private and running as you:</p>
            <ul className="mt-1.5 space-y-1">
              {result.bots.map((b) => (
                <li key={b.id}>
                  <Link to="/app/bots/$botId" params={{ botId: b.id }} className="font-medium hover:underline">
                    {b.name}
                  </Link>
                </li>
              ))}
              {result.flows.map((f) => (
                <li key={f.path} className="font-mono text-[12.5px]">
                  {f.path}
                </li>
              ))}
            </ul>
          </div>
          {result.webhooks && (
            <div>
              <p className="text-ink-2">{result.webhookNote}</p>
              <div className="mt-2 space-y-2">
                {result.webhooks.map((w) => (
                  <div key={w.url}>
                    <div className="mb-1 text-[12px] text-ink-3">{w.for}</div>
                    <CopyField value={w.url} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {result.todo.length > 0 && (
            <div>
              <p className="font-medium">Still to do</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-2">
                {result.todo.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p className="mt-3 text-ink-2">The template page keeps this list up to date. Your agent can walk you through it:</p>
              <CopyField value={template.ask} mono={false} className="mt-1.5" />
            </div>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Set up ${template.title}`}
      width={520}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Make my copy
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-ink-2">
        You get your own private copy, running as {userName} with your logins and secrets. Where the template names its maker, it names you.
      </p>
      {template.fields.length > 0 && (
        <div className="mt-4 space-y-4">
          {template.fields.map((f) => (
            <Field key={f.name} label={f.name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())} hint={f.about}>
              <Input value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
            </Field>
          ))}
          <p className="text-[12.5px] text-ink-3">Anything you leave empty can be filled in later.</p>
        </div>
      )}
    </Modal>
  )
}

/** One line of the setup checklist. */
export function CheckRow({ done, children, detail }: { done: boolean; children: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 px-4 py-3">
      {done ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-ink-3" />}
      <div className="min-w-0 flex-1 text-[13.5px]">
        <div className={cn(done && 'text-ink-2')}>{children}</div>
        {detail && <div className="mt-0.5 text-[12.5px] text-ink-3">{detail}</div>}
      </div>
    </li>
  )
}
