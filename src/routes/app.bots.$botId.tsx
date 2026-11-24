import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, AtSign, CalendarClock, ChevronRight, Lock, MoreHorizontal, Pause, Pencil, Play, ShieldCheck, Sparkles, Trash2, Users, Webhook, Workflow } from 'lucide-react'
import { botDeleteFn, botFn, botRunFn, botUpdateFn } from '../lib/api'
import { Badge, Button, CopyField, Field, Input, Menu, MenuItem, Modal, Textarea } from '../components/ui'
import { RunStatus, duration, when } from '../components/FlowForms'
import { BotDialog } from '../components/BotForms'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/table'
import { botRunStart, errMessage, spaceHref, timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/bots/$botId')({
  loader: ({ params }) => botFn({ data: { id: params.botId } }),
  component: BotPage,
})

function PathList({ paths }: { paths: string[] }) {
  if (!paths.length) return <span className="text-ink-3">nothing</span>
  return (
    <>
      {paths.map((p, i) => (
        <span key={p}>
          {i > 0 && ', '}
          <Link to={spaceHref(p) as never} className="font-mono text-[12px] text-ink hover:underline">
            {p}
          </Link>
        </span>
      ))}
    </>
  )
}

type BotData = Awaited<ReturnType<typeof botFn>>

/** Whether people can ask the bot things in Slack, and its @handle there. */
function SlackCard({ b }: { b: BotData }) {
  const router = useRouter()
  const s = b.slackInfo
  const [open, setOpen] = useState(false)
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const who = b.visibility === 'team' ? `Anyone in this Brainspace workspace can ask it, and it answers with ${b.mine ? 'your' : `${b.owner}'s`} access.` : 'Only you can ask it, since it is private.'

  const save = async (input: { slack: boolean; slackHandle?: string }) => {
    setBusy(true)
    try {
      const r = await botUpdateFn({ data: { id: b.id, input } })
      if (r.slackNote) toast(r.slackNote, { duration: 10_000 })
      else toast.success(input.slack ? 'On in Slack' : 'Taken out of Slack')
      setOpen(false)
      await router.invalidate()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-line p-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
        <AtSign className="size-4 text-ink-3" /> Slack
      </h2>
      {s.enabled ? (
        <>
          <p className="mt-1.5 text-[13px] text-ink-2">
            {s.handle ? (
              <>
                On. Mention <code className="rounded bg-paper px-1 py-0.5 text-[12px] text-ink">@{s.handle}</code> in a channel and it answers in the thread.
              </>
            ) : (
              <>
                On. Write <code className="rounded bg-paper px-1 py-0.5 text-[12px] text-ink">{s.mention}</code> and your question in a channel, and it answers in the thread.
              </>
            )}{' '}
            The person who asked can reply in the thread without mentioning it again.
          </p>
          <p className="mt-2 text-[12.5px] text-ink-3">
            {who} It only sees channels the Brainspace app is in. Add the app to one with /invite @Brainspace.
          </p>
          {!s.eventsReady && <p className="mt-2 text-[12.5px] text-danger">This Brainspace server isn't receiving Slack messages yet, so it won't answer. It needs the Slack app's signing secret (docs/slack-app.md).</p>}
          {b.canEdit && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setHandle(s.handle ?? s.suggestedHandle)
                  setOpen(true)
                }}
              >
                {s.handle ? 'Change handle' : 'Add a handle'}
              </Button>
              <Button size="sm" loading={busy && !open} onClick={() => confirm(`Take ${b.name} out of Slack? Mentions of it stop working.`) && save({ slack: false })}>
                Turn off
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mt-1.5 text-[13px] text-ink-2">
            Off. Turn it on to give the bot an @handle in {s.team ?? 'Slack'}, so people can ask it things there and get the answer in the thread.
          </p>
          {!s.connected ? (
            <p className="mt-2 text-[12.5px] text-ink-3">
              <Link to="/app/connections" className="font-medium text-ink underline">
                Add Slack under Connections
              </Link>{' '}
              first.
            </p>
          ) : s.needsReinstall ? (
            <p className="mt-2 text-[12.5px] text-ink-3">
              The Slack app needs new permissions for this.{' '}
              <Link to="/app/connections" className="font-medium text-ink underline">
                Use Reinstall in Slack on the connection
              </Link>
              , then come back.
            </p>
          ) : (
            b.canEdit && (
              <div className="mt-3">
                <Button
                  size="sm"
                  onClick={() => {
                    setHandle(s.suggestedHandle)
                    setOpen(true)
                  }}
                >
                  Turn on
                </Button>
              </div>
            )
          )}
        </>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={s.enabled ? `${b.name}'s Slack handle` : `Ask ${b.name} things in Slack`}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => save({ slack: true, slackHandle: handle.trim() || undefined })}>
              {s.enabled ? 'Save' : 'Turn on'}
            </Button>
          </>
        }
      >
        <Field label="Handle" hint="What people type to mention it. It becomes a user group in Slack, so it has to differ from every person, channel and group there.">
          <div className="flex items-center gap-1.5">
            <span className="text-ink-3">@</span>
            <Input value={handle} onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))} placeholder={s.suggestedHandle} maxLength={21} />
          </div>
        </Field>
        <p className="mt-3 text-[13px] text-ink-2">{who}</p>
      </Modal>
    </div>
  )
}

function BotPage() {
  const b = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [edit, setEdit] = useState(false)
  const [runOpen, setRunOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [hookUrl, setHookUrl] = useState<string | null>(null)
  const active = b.runs.some((r) => r.status === 'queued' || r.status === 'running')

  // Live events refresh this page; a slow poll covers anything missed.
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => router.invalidate(), 10_000)
    return () => clearInterval(t)
  }, [active, router])

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast.success(ok)
      await router.invalidate()
    } catch (e) {
      toast.error(errMessage(e))
    }
  }

  const newWebhook = async () => {
    if (b.webhook && !confirm('Make a new webhook URL? The current one stops working.')) return
    try {
      const r = await botUpdateFn({ data: { id: b.id, input: { webhook: true } } })
      if (r.webhookUrl) setHookUrl(r.webhookUrl)
      await router.invalidate()
    } catch (e) {
      toast.error(errMessage(e))
    }
  }

  const start = async () => {
    setBusy(true)
    try {
      const r = await botRunFn({ data: { id: b.id, prompt: prompt.trim() || undefined } })
      setRunOpen(false)
      setPrompt('')
      navigate({ to: '/app/bots/runs/$runId', params: { runId: r.runId } })
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 lg:px-10">
      <div className="mb-1 text-[13px] text-ink-3">
        <Link to="/app/bots" className="hover:text-ink">
          Bots
        </Link>{' '}
        / {b.visibility === 'team' ? 'Team' : 'Private'}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {b.name}
            {!b.enabled && <Badge>Paused</Badge>}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-4 text-ink-3" />
              {b.schedule ?? (b.webhook ? 'No schedule' : b.flows.length ? `Runs in ${b.flows.map((f) => f.name).join(', ')}` : 'Runs when asked')}
            </span>
            {b.webhook && (
              <span className="inline-flex items-center gap-1.5 text-ink-3">
                <Webhook className="size-3.5" /> Wakes on its webhook
              </span>
            )}
            {b.nextRunAt && <span className="text-ink-3">Next {when(b.nextRunAt)}</span>}
            <span className="inline-flex items-center gap-1.5 text-ink-3">
              {b.visibility === 'team' ? <Users className="size-3.5" /> : <Lock className="size-3.5" />}
              {b.visibility === 'team' ? 'Shared with the team' : 'Only you'}
            </span>
          </p>
          {b.description && <p className="mt-2 max-w-2xl text-[14px] text-ink-2">{b.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {b.canManage && (
            <Menu
              trigger={
                <Button aria-label="More">
                  <MoreHorizontal className="size-4" />
                </Button>
              }
            >
              {b.canEdit && (
                <MenuItem icon={<Pencil />} onClick={() => setEdit(true)}>
                  Edit
                </MenuItem>
              )}
              {b.enabled ? (
                <MenuItem icon={<Pause />} onClick={() => act(() => botUpdateFn({ data: { id: b.id, input: { enabled: false } } }), 'Paused')}>
                  Pause
                </MenuItem>
              ) : (
                b.canEdit && (
                  <MenuItem icon={<Play />} onClick={() => act(() => botUpdateFn({ data: { id: b.id, input: { enabled: true } } }), 'Resumed')}>
                    Resume
                  </MenuItem>
                )
              )}
              <MenuItem
                danger
                icon={<Trash2 />}
                onClick={async () => {
                  if (!confirm(`Delete ${b.name}? Its schedule, memory and run history go with it. What it wrote stays.`)) return
                  try {
                    await botDeleteFn({ data: { id: b.id } })
                    navigate({ to: '/app/bots' })
                  } catch (e) {
                    toast.error(errMessage(e))
                  }
                }}
              >
                Delete
              </MenuItem>
            </Menu>
          )}
          {b.canRun && (
            <Button variant="primary" disabled={active} onClick={() => (b.mine ? setRunOpen(true) : start())} loading={busy && !runOpen}>
              <Play className="size-4" /> {active ? 'Running' : 'Run now'}
            </Button>
          )}
        </div>
      </div>

      {b.pausedReason && (
        <div className="mt-5 flex gap-2.5 rounded-lg border border-danger/30 bg-danger-wash/60 p-4 text-[13.5px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <div>
            <div className="font-medium text-danger">This bot paused itself</div>
            <p className="mt-1 text-ink-2">{b.pausedReason}</p>
          </div>
        </div>
      )}
      {!b.aiConfigured && (
        <div className="mt-5 flex gap-2.5 rounded-lg border border-[#e8c87a] bg-[#fdf6e7] p-3.5 text-[13.5px]">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-[#8a5a00]" />
          <div>
            Runs will fail until the workspace has an AI Gateway key.{' '}
            <Link to="/app/settings" className="font-medium underline">
              An admin can add one in Settings
            </Link>
            .
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <section className="rounded-xl border border-line p-5">
            <h2 className="text-[13px] font-semibold">Instructions</h2>
            <p className="mt-2 text-[14px] leading-relaxed whitespace-pre-wrap text-ink-2">{b.instructions}</p>
          </section>
          {b.memory !== undefined && (
            <section className="rounded-xl border border-line p-5">
              <h2 className="text-[13px] font-semibold">Memory</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-3">Notes the bot keeps for its next run. Only you see them.</p>
              <p className="mt-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{b.memory || <span className="text-ink-3">Nothing yet.</span>}</p>
            </section>
          )}
        </div>

        <aside className="space-y-5">
          <div className="rounded-lg border border-line p-4">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <ShieldCheck className="size-4 text-agent" /> What it can touch
            </h2>
            <ul className="mt-2 space-y-1.5 text-[13px] text-ink-2">
              <li>
                Reads <PathList paths={[...new Set([...b.paths.read, ...b.paths.write])]} />
              </li>
              <li>
                Changes <PathList paths={b.paths.write} />
              </li>
              <li>{b.connections ? (b.connections.length ? `Uses ${b.connections.join(', ')}` : 'No connections') : `Any connection ${b.mine ? 'you' : b.owner} can use`}</li>
              <li>{b.tools ? `${b.tools.length} of ${b.allTools.length} tools` : 'All bot tools'}</li>
            </ul>
            {b.tools && (
              <div className="mt-2 flex flex-wrap gap-1">
                {b.tools.map((t) => (
                  <code key={t} className="rounded bg-paper px-1.5 py-0.5 text-[11.5px] text-ink-2">
                    {t}
                  </code>
                ))}
              </div>
            )}
            <p className="mt-3 text-[12px] text-ink-3">
              Runs act as {b.mine ? 'you' : b.owner} and can't do more than {b.mine ? 'you' : 'they'} can. Bots can't delete files, change access or manage the workspace.
            </p>
          </div>
          <div className="rounded-lg border border-line p-4">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Webhook className="size-4 text-ink-3" /> Webhook
            </h2>
            <p className="mt-1.5 text-[13px] text-ink-2">
              {b.webhook
                ? 'On. A POST to its URL wakes the bot, and what was sent reaches the run as data. Events that arrive during a run wait for the next one.'
                : 'Off. Turn it on to let another system wake the bot: a site monitor, a form, a CRM.'}
            </p>
            {b.canEdit && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={newWebhook}>
                  {b.webhook ? 'New URL' : 'Create webhook URL'}
                </Button>
                {b.webhook && (
                  <Button size="sm" onClick={() => confirm('Remove the webhook? Its URL stops working.') && act(() => botUpdateFn({ data: { id: b.id, input: { webhook: false } } }), 'Webhook removed')}>
                    Remove
                  </Button>
                )}
              </div>
            )}
          </div>
          <SlackCard b={b} />
          {b.flows.length > 0 && (
            <div className="rounded-lg border border-line p-4">
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Workflow className="size-4 text-ink-3" /> Flows that run it
              </h2>
              <ul className="mt-2 space-y-2">
                {b.flows.map((f) => (
                  <li key={f.id} className="text-[13px]">
                    <Link to="/app/flows/$flowId" params={{ flowId: f.id }} className="font-medium hover:underline">
                      {f.name}
                    </Link>
                    <span className="text-ink-3"> · {f.space === 'team' ? 'team' : 'private'}</span>
                    {f.description && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-2">{f.description}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-lg border border-line p-4 text-[13px]">
            <div className="flex justify-between gap-3 text-ink-3">
              <span>Model</span>
              <code className="truncate text-[12px] text-ink-2">{b.effectiveModel}</code>
            </div>
            <div className="mt-1 flex justify-between text-ink-3">
              <span>Runs as</span>
              <span className="text-ink-2">{b.owner}</span>
            </div>
          </div>
        </aside>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">Runs</h2>
        {b.runs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-2 px-4 py-3 text-[13px] text-ink-3">
            It hasn't run yet.{b.nextRunAt ? ` The first scheduled run is ${when(b.nextRunAt)}.` : ''} Run it now to see what it does.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>What it did</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Took</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.runs.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate({ to: '/app/bots/runs/$runId', params: { runId: r.id } })}>
                    <TableCell>
                      <RunStatus status={r.status} />
                    </TableCell>
                    <TableCell className="max-w-md">
                      <span className="line-clamp-2 text-[13px] text-ink-2">{r.error ?? r.summary ?? (r.status === 'running' ? 'Working…' : '')}</span>
                    </TableCell>
                    <TableCell className="text-[12.5px] whitespace-nowrap text-ink-3">
                      {timeAgo(r.createdAt)} · {botRunStart(r)}
                    </TableCell>
                    <TableCell className="text-[12.5px] whitespace-nowrap text-ink-3">{r.startedAt ? duration(r.startedAt, r.finishedAt) : ''}</TableCell>
                    <TableCell>
                      <ChevronRight className="size-3.5 text-ink-3" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <Modal open={!!hookUrl} onClose={() => setHookUrl(null)} title="Webhook ready" footer={<Button variant="primary" onClick={() => setHookUrl(null)}>Done</Button>}>
        <p className="mb-3 text-[13.5px] text-ink-2">
          POST to this URL to wake {b.name}. The body, JSON or text, reaches the run as data. This is the only time the URL is shown, and anyone who has it can start runs.
        </p>
        {hookUrl && <CopyField value={hookUrl} />}
        <pre className="mt-3 overflow-x-auto rounded-md bg-paper p-3 font-mono text-[12px] text-ink-2">{`curl -X POST ${hookUrl} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"changed": "https://example.com/pricing"}'`}</pre>
      </Modal>
      <BotDialog open={edit} onClose={() => setEdit(false)} bot={b} defaultModel={b.effectiveModel} />
      <Modal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        title={`Run ${b.name}`}
        footer={
          <>
            <Button onClick={() => setRunOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={start} loading={busy}>
              <Play className="size-4" /> Run now
            </Button>
          </>
        }
      >
        <p className="mb-3 text-[13.5px] text-ink-2">It follows its instructions. Add a request if this run should do something different.</p>
        <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Only look at last week." />
      </Modal>
    </div>
  )
}
