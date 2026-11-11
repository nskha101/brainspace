import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { KeyRound, AlertTriangle, CalendarClock, ChevronDown, ChevronRight, Code2, FolderOpen, Pause, Play, Play as PlayIcon, ShieldCheck, Sparkles, Trash2, Webhook, Bookmark, Pencil } from 'lucide-react'
import { flowFn, flowTriggerApproveFn, flowTriggerRemoveFn, flowTriggerRunFn, flowTriggerSetFn } from '../lib/api'
import { Badge, Button, Menu, MenuItem } from '../components/ui'
import { FlowDiagram } from '../components/FlowDiagram'
import { CodeView, RunDialog, RunStatus, TriggerDialog, destinationLabel, duration, when, type Destination, type InputSpec, type TriggerData } from '../components/FlowForms'
import { MarkdownEditor } from '../components/Editor'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/table'
import { spaceHref, errMessage, timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/flows/$flowId')({
  loader: ({ params }) => flowFn({ data: { id: params.flowId } }),
  component: FlowPage,
})

function FlowPage() {
  const f = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [runOpen, setRunOpen] = useState(false)
  const [trig, setTrig] = useState<{ open: boolean; trigger?: TriggerData | null; kind?: 'schedule' | 'webhook' | 'manual' }>({ open: false })
  const [showCode, setShowCode] = useState(false)

  const inputs = (f.manifest?.inputs ?? {}) as Record<string, InputSpec>
  const outputs = Object.keys(f.manifest?.outputs ?? {})
  const flowForForms = { id: f.id, name: f.name, inputs, outputs, secrets: f.secrets }
  const starts = [
    { kind: 'manual' as const, label: 'Run now' },
    ...f.triggers
      .filter((t) => t.enabled && t.kind !== 'manual')
      .map((t) => ({ kind: t.kind, label: t.kind === 'schedule' ? (t.schedule ?? t.name) : t.name })),
  ]
  const destinations = [...new Set(f.triggers.flatMap((t) => (t.deliver as Destination[]).map(destinationLabel)))]

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast.success(ok)
      await router.invalidate()
    } catch (e) {
      toast.error(errMessage(e))
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 lg:px-10">
      <div className="mb-1 text-[13px] text-ink-3">
        <Link to="/app/flows" className="hover:text-ink">
          Flows
        </Link>{' '}
        / {f.space === 'team' ? 'Team' : 'Private'}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{f.name}</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-ink-2">{f.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={spaceHref(f.path) as never}>
            <Button>
              <FolderOpen className="size-4" /> Files
            </Button>
          </Link>
          {f.canEdit && f.status === 'ok' && (
            <Menu
              trigger={
                <Button>
                  <CalendarClock className="size-4" /> Automate <ChevronDown className="size-3.5" />
                </Button>
              }
            >
              <MenuItem icon={<CalendarClock />} onClick={() => setTrig({ open: true, kind: 'schedule' })}>
                On a schedule
              </MenuItem>
              <MenuItem icon={<Webhook />} onClick={() => setTrig({ open: true, kind: 'webhook' })}>
                From a webhook
              </MenuItem>
              <MenuItem icon={<Bookmark />} onClick={() => setTrig({ open: true, kind: 'manual' })}>
                Save inputs as a preset
              </MenuItem>
            </Menu>
          )}
          {f.canRun && (
            <Button variant="primary" onClick={() => setRunOpen(true)}>
              <Play className="size-4" /> Run
            </Button>
          )}
        </div>
      </div>

      {f.status !== 'ok' && (
        <div className="mt-5 flex gap-2.5 rounded-lg border border-danger/30 bg-danger-wash/60 p-4 text-[13.5px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <div>
            <div className="font-medium text-danger">This flow can't run until it's fixed</div>
            <pre className="mt-1 font-mono text-[12.5px] whitespace-pre-wrap text-ink-2">{f.error}</pre>
            <p className="mt-2 text-ink-3">Ask your agent to fix it, or edit FLOW.md and flow.ts in the flow's folder.</p>
          </div>
        </div>
      )}
      {f.aiReady === false && (
        <div className="mt-5 flex gap-2.5 rounded-lg border border-[#e8c87a] bg-[#fdf6e7] p-3.5 text-[13.5px]">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-[#8a5a00]" />
          <div>
            This flow uses AI, but the workspace has no AI Gateway key yet.{' '}
            <Link to="/app/settings" className="font-medium underline">
              An admin can add one in Settings
            </Link>
            .
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-xl border border-line bg-[radial-gradient(circle,var(--color-line)_1px,transparent_1px)] [background-size:16px_16px]">
          <FlowDiagram diagram={f.diagram} starts={starts} inputs={inputs} outputs={f.manifest?.outputs} destinations={destinations} />
        </section>

        <aside className="space-y-5">
          <div className="rounded-lg border border-line p-4">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <ShieldCheck className="size-4 text-agent" /> What it can touch
            </h2>
            <ul className="mt-2 space-y-1 text-[13px] text-ink-2">
              {f.scope.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            {f.secrets.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
                  <KeyRound className="size-3.5" /> Secrets
                </div>
                <ul className="space-y-1">
                  {f.secrets.map((s) => (
                    <li key={s.name} className="flex items-center justify-between gap-2 text-[12.5px]">
                      <code>{s.name}</code>
                      {s.mine ? (
                        <span className="text-ok">Your own</span>
                      ) : s.team ? (
                        <span className="text-ok">Team</span>
                      ) : s.restrictedTo ? (
                        <span className="text-[#8a5a00]">Only {s.restrictedTo}</span>
                      ) : (
                        <Link to="/app/settings" hash="secrets" className="font-medium text-[#8a5a00] underline">
                          Missing, add it
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {f.model && (
              <p className="mt-3 text-[12.5px] text-ink-3">
                Model: <code className="text-ink-2">{f.model}</code>
              </p>
            )}
            <p className="mt-3 text-[12px] text-ink-3">Runs act as the person who starts them, and can't do more than that person can.</p>
          </div>
          <div className="rounded-lg border border-line p-4 text-[13px]">
            <div className="flex justify-between text-ink-3">
              <span>Code version</span>
              <span className="text-ink-2">v{f.codeVersion ?? '–'}</span>
            </div>
            <div className="mt-1 flex justify-between text-ink-3">
              <span>Lives in</span>
              <Link to={spaceHref(f.path) as never} className="truncate pl-3 font-mono text-[12px] text-ink-2 hover:underline">
                {f.path}
              </Link>
            </div>
          </div>
        </aside>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Triggers</h2>
        <p className="mb-3 text-[13px] text-ink-3">Schedules, webhooks and saved presets. Each one runs as the person who set it up.</p>
        {f.triggers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-2 px-4 py-3 text-[13px] text-ink-3">
            Nothing automated yet. Use Automate, or ask your agent to schedule it.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {f.triggers.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="text-ink-3 [&_svg]:size-4">{t.kind === 'schedule' ? <CalendarClock /> : t.kind === 'webhook' ? <Webhook /> : <Bookmark />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
                    <span className="font-medium">{t.name}</span>
                    {!t.enabled && <Badge>Paused</Badge>}
                    {t.needsConsent && <Badge className="bg-[#fbeccb] text-[#8a5a00]">Needs approval</Badge>}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-ink-3">
                    Runs as {t.runAs.name}
                    {t.nextRunAt ? ` · next ${when(t.nextRunAt)}` : ''}
                    {(t.deliver as Destination[]).length ? ` · sends to ${(t.deliver as Destination[]).map(destinationLabel).join(', ')}` : ''}
                    {t.lastStatus ? ` · last: ${t.lastStatus}${t.lastRunAt ? ` ${timeAgo(t.lastRunAt)}` : ''}` : ''}
                  </div>
                  {t.pausedReason && <div className="mt-1 text-[12.5px] text-[#8a5a00]">{t.pausedReason}</div>}
                </div>
                <div className="flex items-center gap-1.5">
                  {t.needsConsent && t.mine && (
                    <Button size="sm" variant="primary" onClick={() => act(() => flowTriggerApproveFn({ data: { id: t.id } }), 'Approved')}>
                      Review and approve
                    </Button>
                  )}
                  {f.canRun && (
                    <Button
                      size="sm"
                      onClick={() =>
                        act(async () => {
                          const r = await flowTriggerRunFn({ data: { id: t.id } })
                          navigate({ to: '/app/flows/runs/$runId', params: { runId: r.runId } })
                        })
                      }
                    >
                      <PlayIcon className="size-3.5" /> Run now
                    </Button>
                  )}
                  {(t.mine || f.canEdit) && (
                    <Menu trigger={<Button size="sm" variant="ghost">•••</Button>}>
                      <MenuItem icon={<Pencil />} onClick={() => setTrig({ open: true, trigger: { ...t, deliver: t.deliver as Destination[], inputs: t.inputs as Record<string, unknown> } })}>
                        Edit
                      </MenuItem>
                      <MenuItem
                        icon={<Pause />}
                        onClick={() => act(() => flowTriggerSetFn({ data: { flow: f.id, id: t.id, enabled: !t.enabled } }), t.enabled ? 'Paused' : 'Resumed')}
                      >
                        {t.enabled ? 'Pause' : 'Resume'}
                      </MenuItem>
                      <MenuItem icon={<Trash2 />} danger onClick={() => act(() => flowTriggerRemoveFn({ data: { id: t.id } }), 'Removed')}>
                        Remove
                      </MenuItem>
                    </Menu>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">Recent runs</h2>
        {f.runs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-2 px-4 py-3 text-[13px] text-ink-3">No runs yet.</p>
        ) : (
          <div className="rounded-lg border border-line">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[170px]">Status</TableHead>
                  <TableHead>Started by</TableHead>
                  <TableHead className="w-[140px]">When</TableHead>
                  <TableHead className="w-[100px]">Took</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {f.runs.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate({ to: '/app/flows/runs/$runId', params: { runId: r.id } })}>
                    <TableCell>
                      <RunStatus status={r.status} test={r.test} />
                    </TableCell>
                    <TableCell className="truncate text-ink-2">
                      {r.startedBy.name}
                      {r.error && <span className="ml-2 text-[12px] text-danger">{r.error.slice(0, 80)}</span>}
                    </TableCell>
                    <TableCell className="text-ink-3">{timeAgo(r.createdAt)}</TableCell>
                    <TableCell className="text-ink-3">{r.finishedAt ? duration(r.createdAt, r.finishedAt) : '…'}</TableCell>
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

      {f.body && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">About this flow</h2>
          <div className="rounded-lg border border-line px-2">
            <MarkdownEditor markdown={f.body} editable={false} onChange={() => {}} />
          </div>
        </section>
      )}

      {f.code && (
        <section className="mt-8 mb-10">
          <button className="mb-2 flex items-center gap-1.5 text-sm font-semibold" onClick={() => setShowCode((s) => !s)}>
            {showCode ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            <Code2 className="size-4 text-ink-3" /> Code <span className="font-normal text-ink-3">({f.codeFile})</span>
          </button>
          {showCode && <CodeView code={f.code} />}
        </section>
      )}

      <RunDialog open={runOpen} onClose={() => setRunOpen(false)} flow={flowForForms} />
      <TriggerDialog open={trig.open} onClose={() => setTrig({ open: false })} flow={flowForForms} trigger={trig.trigger} initialKind={trig.kind} />
    </div>
  )
}
