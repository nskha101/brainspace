import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Clock, ExternalLink, Loader2, Square, Timer, UserCheck, X, FileClock } from 'lucide-react'
import { flowRunApproveFn, flowRunCancelFn, flowRunGetFn } from '../lib/api'
import { Badge, Button, Textarea } from '../components/ui'
import { FlowDiagram } from '../components/FlowDiagram'
import { RunStatus, duration } from '../components/FlowForms'
import { MarkdownEditor } from '../components/Editor'
import { cn, errMessage, timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/flows/runs/$runId')({
  loader: ({ params }) => flowRunGetFn({ data: { id: params.runId } }),
  component: RunPage,
})

const ACTIVE = ['queued', 'running', 'waiting']

function RunPage() {
  const r = Route.useLoaderData()
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const active = ACTIVE.includes(r.status)

  // Live events refresh this page; a slow poll covers sleeps and anything missed.
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => router.invalidate(), 15_000)
    return () => clearInterval(t)
  }, [active, router])
  // Tick the running duration.
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [active])

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try {
      await fn()
      toast.success(ok)
      await router.invalidate()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const outputs = (r.outputs ?? {}) as Record<string, unknown>

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 lg:px-10">
      <div className="mb-1 text-[13px] text-ink-3">
        <Link to="/app/flows" className="hover:text-ink">
          Flows
        </Link>{' '}
        /{' '}
        <Link to="/app/flows/$flowId" params={{ flowId: r.flowId }} className="hover:text-ink">
          {r.flow}
        </Link>{' '}
        / run
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{r.flow}</h1>
        <RunStatus status={r.status} test={r.test} />
        <div className="ml-auto flex items-center gap-2">
          {active && r.canAct && (
            <Button loading={busy === 'cancel'} onClick={() => act('cancel', () => flowRunCancelFn({ data: { id: r.id } }), 'Cancelled')}>
              <Square className="size-3.5" /> Cancel
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Started by {r.startedBy.name}
        {r.runAs.id !== r.startedBy.id ? `, running as ${r.runAs.name}` : ''} · {timeAgo(r.createdAt)} · {duration(r.createdAt, r.finishedAt)}
        {r.codeVersion ? ` · code v${r.codeVersion}` : ''}
        {r.ai.calls ? ` · ${r.ai.calls} AI call${r.ai.calls > 1 ? 's' : ''} (${r.ai.tokens.toLocaleString()} tokens, ${r.model})` : ''}
      </p>
      {r.test && (
        <p className="mt-3 rounded-lg border border-line bg-paper px-3.5 py-2.5 text-[13px] text-ink-2">
          Test run: reads and AI calls were real. Writes, deliveries and connection calls that change data were recorded below instead of made.
        </p>
      )}
      {r.error && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger-wash/60 px-4 py-3">
          <div className="text-[13px] font-medium text-danger">What went wrong</div>
          <pre className="mt-1 font-mono text-[12.5px] whitespace-pre-wrap text-ink-2">{r.error}</pre>
        </div>
      )}

      {r.pendingApproval && (
        <section className="mt-5 rounded-xl border border-brand/30 bg-brand-wash/40 p-5">
          <div className="flex items-center gap-2 text-[13px] font-medium text-brand-ink">
            <UserCheck className="size-4" /> Waiting for approval
          </div>
          <h2 className="mt-1 text-lg font-semibold">{r.pendingApproval.title}</h2>
          {r.pendingApproval.summary && <p className="mt-1 text-[14px] text-ink-2">{r.pendingApproval.summary}</p>}
          {r.pendingApproval.preview && (
            <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-line bg-sheet p-3 font-mono text-[12.5px] whitespace-pre-wrap text-ink-2">
              {r.pendingApproval.preview}
            </pre>
          )}
          {r.canAct && (
            <div className="mt-4 space-y-2">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the flow (optional)" />
              <div className="flex gap-2">
                <Button variant="primary" loading={busy === 'approve'} onClick={() => act('approve', () => flowRunApproveFn({ data: { id: r.id, approved: true, note: note || undefined } }), 'Approved')}>
                  <Check className="size-4" /> Approve
                </Button>
                <Button loading={busy === 'reject'} onClick={() => act('reject', () => flowRunApproveFn({ data: { id: r.id, approved: false, note: note || undefined } }), 'Rejected')}>
                  <X className="size-4" /> Reject
                </Button>
                {r.pendingApproval.timeoutAt && <span className="ml-auto self-center text-[12px] text-ink-3">Expires {new Date(r.pendingApproval.timeoutAt).toLocaleString()}</span>}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="overflow-hidden rounded-xl border border-line bg-[radial-gradient(circle,var(--color-line)_1px,transparent_1px)] [background-size:16px_16px]">
          <FlowDiagram
            diagram={r.diagram}
            starts={[{ kind: r.triggerId ? (r.startedBy.name === 'Schedule' ? 'schedule' : r.startedBy.name === 'Webhook' ? 'webhook' : 'manual') : 'manual', label: r.startedBy.name }]}
            inputs={undefined}
            steps={r.steps}
            runStatus={r.status}
          />
        </section>
        <aside>
          <h2 className="mb-2 text-sm font-semibold">Steps</h2>
          {r.steps.length === 0 ? (
            <p className="text-[13px] text-ink-3">{active ? 'Starting…' : 'No steps ran.'}</p>
          ) : (
            <ol className="space-y-1.5">
              {r.steps.map((s) => (
                <StepRow key={s.name} s={s} />
              ))}
            </ol>
          )}
          <h2 className="mt-6 mb-2 text-sm font-semibold">Inputs</h2>
          <pre className="max-h-60 overflow-auto rounded-lg border border-line bg-paper p-3 font-mono text-[12px] whitespace-pre-wrap text-ink-2">{JSON.stringify(r.inputs, null, 2)}</pre>
        </aside>
      </div>

      {Object.keys(outputs).length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Outputs</h2>
          <div className="space-y-4">
            {Object.entries(outputs).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line">
                <div className="border-b border-line bg-paper px-4 py-2 font-mono text-[12.5px] text-ink-2">{k}</div>
                {typeof v === 'string' ? (
                  <div className="px-2">
                    <MarkdownEditor markdown={v} editable={false} onChange={() => {}} />
                  </div>
                ) : (
                  <pre className="max-h-96 overflow-auto p-4 font-mono text-[12.5px] text-ink-2">{JSON.stringify(v, null, 2)}</pre>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {(r.deliveries.length > 0 || r.deliver.length > 0) && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Deliveries</h2>
          {r.deliveries.length === 0 ? (
            <p className="text-[13px] text-ink-3">{active ? 'Sent when the run finishes.' : 'Nothing was delivered.'}</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {r.deliveries.map((d, i) => (
                <li key={i} className="flex items-start gap-2.5 px-4 py-2.5 text-[13.5px]">
                  {d.ok ? <Check className="mt-0.5 size-4 text-ok" /> : <X className="mt-0.5 size-4 text-danger" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[12.5px]">{d.target}</div>
                    {d.error && <div className="text-[12.5px] text-danger">{d.error}</div>}
                    {d.preview && <div className="mt-0.5 line-clamp-3 text-[12.5px] text-ink-3">{d.preview}</div>}
                  </div>
                  {d.link && (
                    <a href={d.link} className="inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink">
                      Open <ExternalLink className="size-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {r.captured.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <FileClock className="size-4 text-ink-3" /> Changes a real run would make
          </h2>
          <ul className="space-y-2">
            {r.captured.map((c, i) => (
              <li key={i} className="rounded-lg border border-line">
                <div className="flex items-center gap-2 border-b border-line bg-paper px-4 py-2 text-[12.5px]">
                  <Badge>{c.kind}</Badge>
                  <span className="font-mono">{c.target}</span>
                </div>
                <pre className="max-h-64 overflow-auto p-3 font-mono text-[12px] whitespace-pre-wrap text-ink-2">{c.preview}</pre>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.logs.length > 0 && (
        <section className="mt-8 mb-10">
          <h2 className="mb-2 text-sm font-semibold">Log</h2>
          <div className="max-h-96 overflow-auto rounded-lg border border-line bg-[#fbfafc] p-3 font-mono text-[12px] leading-relaxed">
            {r.logs.map((l, i) => (
              <div key={i} className={cn(l.level === 'warn' && 'text-[#8a5a00]', l.level === 'error' && 'text-danger', l.level === 'info' && 'text-ink-2')}>
                <span className="text-ink-3">{new Date(l.at).toLocaleTimeString()}</span> {l.message}
                {l.data !== null && l.data !== undefined && <span className="text-ink-3"> {JSON.stringify(l.data)}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function StepRow({ s }: { s: { name: string; kind: string; status: string; attempt: number; startedAt: number; finishedAt: number | null; until: number | null; error: string | null; preview: string | null } }) {
  const [open, setOpen] = useState(false)
  const sleepingDone = s.status === 'sleeping' && s.until && s.until < Date.now()
  const status = sleepingDone ? 'done' : s.status
  return (
    <li className="rounded-lg border border-line bg-sheet">
      <button className="flex w-full items-start gap-2 px-3 py-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="mt-0.5 [&_svg]:size-3.5">
          {status === 'done' ? (
            <Check className="text-ok" />
          ) : status === 'running' ? (
            <Loader2 className="animate-spin text-brand" />
          ) : status === 'failed' ? (
            <X className="text-danger" />
          ) : s.kind === 'sleep' ? (
            <Timer className="text-[#8a5a00]" />
          ) : (
            <Clock className="text-[#8a5a00]" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{s.name.replace(/^ask: /, 'Approval: ').replace(/^expired: /, 'Approval expired: ')}</span>
          <span className="block text-[11.5px] text-ink-3">
            {s.kind === 'sleep' && s.until && status !== 'done'
              ? `until ${new Date(s.until).toLocaleString()}`
              : s.finishedAt
                ? duration(s.startedAt, s.finishedAt)
                : status === 'running'
                  ? `running ${duration(s.startedAt)}`
                  : ''}
            {s.attempt > 1 ? ` · attempt ${s.attempt}` : ''}
          </span>
        </span>
      </button>
      {open && (s.error || s.preview) && (
        <pre className={cn('border-t border-line px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap break-all', s.error ? 'text-danger' : 'text-ink-2')}>
          {s.error ?? s.preview}
        </pre>
      )}
    </li>
  )
}
