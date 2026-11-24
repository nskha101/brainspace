import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ChevronDown, ChevronRight, GitFork, MessageSquare, Square, Timer, Wrench } from 'lucide-react'
import { botRunCancelFn, botRunGetFn } from '../lib/api'
import { Button } from '../components/ui'
import { RunStatus, duration } from '../components/FlowForms'
import { botRunStart, cn, errMessage, timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/bots/runs/$runId')({
  loader: ({ params }) => botRunGetFn({ data: { id: params.runId } }),
  component: RunPage,
})

type Event = ReturnType<typeof Route.useLoaderData>['events'][number]

/** A tool call's arguments on one line: the path or query when there is one, else the raw JSON. */
function argsLine(input: string | null) {
  if (!input) return ''
  try {
    const a = JSON.parse(input) as Record<string, unknown>
    const main = a.path ?? a.query ?? a.flow ?? a.from ?? a.memory ?? (a.connection && a.tool ? `${String(a.connection)}.${String(a.tool)}` : undefined) ?? a.name
    if (typeof main === 'string') return main
  } catch {
    // Not JSON: show it as it is.
  }
  return input.length > 80 ? `${input.slice(0, 80)}…` : input
}

function pretty(s: string | null) {
  if (!s) return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

function EventRow({ e }: { e: Event }) {
  const [open, setOpen] = useState(false)
  if (e.kind === 'say') {
    return (
      <li className="flex gap-3 py-3">
        <MessageSquare className="mt-0.5 size-4 shrink-0 text-ink-3" />
        <p className="min-w-0 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">{e.output}</p>
      </li>
    )
  }
  if (e.kind === 'note') {
    return (
      <li className="flex gap-3 py-3">
        <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', e.ok ? 'text-ink-3' : 'text-danger')} />
        <p className={cn('min-w-0 text-[13.5px] whitespace-pre-wrap', e.ok ? 'text-ink-2' : 'text-danger')}>{e.output}</p>
      </li>
    )
  }
  const sub = e.kind === 'subagent'
  return (
    <li className="py-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 text-left">
        {sub ? <GitFork className="size-4 shrink-0 text-agent" /> : <Wrench className={cn('size-4 shrink-0', e.ok ? 'text-ink-3' : 'text-danger')} />}
        <span className="min-w-0 flex-1 truncate text-[13px]">
          <span className={cn('font-mono font-medium', !e.ok && 'text-danger')}>{sub ? 'task' : e.name}</span>{' '}
          <span className="text-ink-3">{sub ? (e.input ?? '') : argsLine(e.input)}</span>
          {!e.ok && <span className="text-danger"> failed</span>}
        </span>
        {open ? <ChevronDown className="size-3.5 text-ink-3" /> : <ChevronRight className="size-3.5 text-ink-3" />}
      </button>
      {open && (
        <div className="mt-2 ml-7 space-y-2">
          {e.input && <pre className="max-h-64 overflow-auto rounded-md bg-paper p-3 font-mono text-[12px] whitespace-pre-wrap text-ink-2">{pretty(e.input)}</pre>}
          {e.output && <pre className={cn('max-h-80 overflow-auto rounded-md bg-paper p-3 font-mono text-[12px] whitespace-pre-wrap', e.ok ? 'text-ink-2' : 'text-danger')}>{e.output}</pre>}
        </div>
      )}
    </li>
  )
}

function RunPage() {
  const r = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const active = r.status === 'queued' || r.status === 'running'

  // Live events refresh this page; a slow poll covers anything missed.
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => router.invalidate(), 8000)
    return () => clearInterval(t)
  }, [active, router])
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [active])

  const cancel = async () => {
    setBusy(true)
    try {
      await botRunCancelFn({ data: { id: r.id } })
      toast.success('Cancelled')
      await router.invalidate()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  // A webhook run holds every event it took, as a JSON list of bodies. A flow run holds one input.
  let inputs: string[] = r.input ? [r.input] : []
  if (r.input && (r.trigger === 'webhook' || r.trigger === 'slack')) {
    try {
      inputs = JSON.parse(r.input) as string[]
    } catch {
      // Keep it as one block.
    }
  }

  // The bot's own steps in order, with each subagent's steps gathered under its name where it started.
  // Subagents run at the same time, so their events arrive interleaved.
  const groups: { agent: string | null; events: Event[] }[] = []
  const subagents = new Map<string, Event[]>()
  for (const e of r.events) {
    if (e.agent) {
      let list = subagents.get(e.agent)
      if (!list) {
        list = []
        subagents.set(e.agent, list)
        groups.push({ agent: e.agent, events: list })
      }
      list.push(e)
      continue
    }
    const last = groups[groups.length - 1]
    if (last && last.agent === null) last.events.push(e)
    else groups.push({ agent: null, events: [e] })
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 lg:px-10">
      <div className="mb-1 text-[13px] text-ink-3">
        <Link to="/app/bots" className="hover:text-ink">
          Bots
        </Link>{' '}
        /{' '}
        <Link to="/app/bots/$botId" params={{ botId: r.botId }} className="hover:text-ink">
          {r.bot}
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Run</h1>
        <RunStatus status={r.status} />
        <div className="ml-auto">
          {active && r.canCancel && (
            <Button onClick={cancel} loading={busy}>
              <Square className="size-3.5" /> Cancel
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
        <span>
          Started {botRunStart(r)} {timeAgo(r.createdAt)}
        </span>
        {r.flowRunId && (
          <Link to="/app/flows/runs/$runId" params={{ runId: r.flowRunId }} className="underline hover:text-ink">
            See the flow run
          </Link>
        )}
        <span>Ran as {r.runsAs}</span>
        {r.startedAt && (
          <span className="inline-flex items-center gap-1">
            <Timer className="size-3.5" /> {duration(r.startedAt, r.finishedAt)}
          </span>
        )}
        {r.model && <code className="text-[12px]">{r.model}</code>}
        {r.tokens > 0 && <span>{r.tokens.toLocaleString()} tokens</span>}
      </p>

      {r.prompt && (
        <div className="mt-5 rounded-lg border border-line bg-paper/60 p-4 text-[13.5px]">
          <div className="text-[12px] font-medium text-ink-3">Request for this run</div>
          <p className="mt-1 whitespace-pre-wrap text-ink-2">{r.prompt}</p>
        </div>
      )}
      {inputs.length > 0 && (
        <div className="mt-5 rounded-lg border border-line bg-paper/60 p-4 text-[13.5px]">
          <div className="text-[12px] font-medium text-ink-3">
            {r.trigger === 'slack'
              ? inputs.length === 1
                ? 'The Slack message that woke it'
                : `The ${inputs.length} Slack messages that woke it`
              : r.trigger === 'webhook'
                ? inputs.length === 1
                  ? 'The event that woke it'
                  : `The ${inputs.length} events that woke it`
                : 'What the flow passed'}
          </div>
          {inputs.map((text, i) => (
            <pre key={i} className="mt-2 max-h-64 overflow-auto rounded-md bg-sheet p-3 font-mono text-[12px] whitespace-pre-wrap text-ink-2">
              {pretty(text)}
            </pre>
          ))}
        </div>
      )}
      {r.error && (
        <div className="mt-5 flex gap-2.5 rounded-lg border border-danger/30 bg-danger-wash/60 p-4 text-[13.5px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <p className="whitespace-pre-wrap text-ink-2">{r.error}</p>
        </div>
      )}
      {r.summary && (
        <section className="mt-5 rounded-xl border border-line p-5">
          <h2 className="text-[13px] font-semibold">What it did</h2>
          <p className="mt-2 text-[14px] leading-relaxed whitespace-pre-wrap text-ink-2">{r.summary}</p>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold">Steps</h2>
        {r.events.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-2 px-4 py-3 text-[13px] text-ink-3">{active ? 'Starting…' : 'Nothing was recorded.'}</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g, i) => (
              <div key={i} className={cn('rounded-lg border border-line px-4', g.agent && 'ml-6 border-agent/30 bg-agent-wash/30')}>
                {g.agent && <div className="border-b border-line/70 py-2 text-[12px] font-medium text-agent">Subagent: {g.agent}</div>}
                <ul className="divide-y divide-line/70">
                  {g.events.map((e) => (
                    <EventRow key={e.id} e={e} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
