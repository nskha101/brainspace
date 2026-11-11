import type { ReactNode } from 'react'
import {
  Check,
  Clock,
  FilePen,
  FileSearch,
  Globe,
  Loader2,
  Play,
  Plug,
  Repeat,
  Search,
  Split,
  Sparkles,
  Timer,
  UserCheck,
  Webhook,
  X,
  Zap,
  CalendarClock,
  Inbox,
  Send,
  Rows3,
} from 'lucide-react'
import { cn } from '../lib/utils'

export type DiagramNode =
  | { kind: 'step'; label: string; uses?: string[] }
  | { kind: 'sleep'; label: string; duration?: string }
  | { kind: 'approval'; label: string }
  | { kind: 'loop'; label: string; body: DiagramNode[] }
  | { kind: 'branch'; label: string; then: DiagramNode[]; else: DiagramNode[] }
  | { kind: 'parallel'; label: string; body: DiagramNode[] }

export type RunStep = { name: string; kind: string; status: string; error?: string | null }
type Status = 'done' | 'running' | 'failed' | 'waiting' | 'sleeping' | 'idle'

type Props = {
  diagram: DiagramNode[]
  starts?: { kind: 'manual' | 'schedule' | 'webhook'; label: string }[]
  inputs?: Record<string, { type: string; description?: string }>
  outputs?: Record<string, { type: string; description?: string }>
  destinations?: string[]
  /** Run view: color nodes by what happened. */
  steps?: RunStep[]
  runStatus?: string
}

/**
 * Draws a flow top to bottom from what the code does: how it starts, its
 * inputs, each step (loops, branches and parallel groups as boxes), then its
 * outputs and where they go. On a run page, nodes show what happened.
 */
export function FlowDiagram({ diagram, starts, inputs, outputs, destinations, steps, runStatus }: Props) {
  const match = steps ? matcher(steps, runStatus) : undefined
  const inputKeys = Object.keys(inputs ?? {})
  const outputKeys = Object.keys(outputs ?? {})
  return (
    <div className="flow-canvas overflow-x-auto">
      <div className="flex min-w-fit flex-col items-center px-4 py-6">
        <Row>
          {(starts?.length ? starts : [{ kind: 'manual' as const, label: 'Run' }]).map((s, i) => (
            <Pill key={i} icon={s.kind === 'schedule' ? <CalendarClock /> : s.kind === 'webhook' ? <Webhook /> : <Play />} tone="start">
              {s.label}
            </Pill>
          ))}
        </Row>
        {inputKeys.length > 0 && (
          <>
            <Connector />
            <Card icon={<Inbox />} title="Inputs" tone="io">
              <div className="flex flex-wrap gap-1">
                {inputKeys.map((k) => (
                  <code key={k} className="rounded bg-wash px-1.5 py-px text-[11.5px] text-ink-2" title={inputs![k]!.description}>
                    {k}
                    <span className="text-ink-3">: {inputs![k]!.type}</span>
                  </code>
                ))}
              </div>
            </Card>
          </>
        )}
        <Seq nodes={diagram} match={match} />
        {diagram.length === 0 && (
          <>
            <Connector />
            <div className="rounded-lg border border-dashed border-line-2 px-4 py-3 text-[13px] text-ink-3">No steps found in the code</div>
          </>
        )}
        {outputKeys.length > 0 && (
          <>
            <Connector />
            <Card icon={<Rows3 />} title="Outputs" tone="io">
              <div className="flex flex-wrap gap-1">
                {outputKeys.map((k) => (
                  <code key={k} className="rounded bg-wash px-1.5 py-px text-[11.5px] text-ink-2" title={outputs![k]!.description}>
                    {k}
                    <span className="text-ink-3">: {outputs![k]!.type}</span>
                  </code>
                ))}
              </div>
            </Card>
          </>
        )}
        {destinations && destinations.length > 0 && (
          <>
            <Connector />
            <Row>
              {destinations.map((d, i) => (
                <Pill key={i} icon={<Send />} tone="end">
                  {d}
                </Pill>
              ))}
            </Row>
          </>
        )}
      </div>
    </div>
  )
}

type Matcher = (node: DiagramNode) => { status: Status; count?: { done: number; total: number }; error?: string | null }

function Seq({ nodes, match }: { nodes: DiagramNode[]; match?: Matcher }) {
  return (
    <>
      {nodes.map((n, i) => (
        <div key={i} className="flex flex-col items-center">
          <Connector />
          <NodeView node={n} match={match} />
        </div>
      ))}
    </>
  )
}

function NodeView({ node, match }: { node: DiagramNode; match?: Matcher }) {
  const m = match?.(node)
  switch (node.kind) {
    case 'step':
      return (
        <Card icon={stepIcon(node.uses)} title={<Label text={node.label} />} status={m} tone="step">
          {node.uses && node.uses.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {node.uses.map((u) => (
                <span key={u} className="inline-flex items-center gap-1 rounded bg-wash px-1.5 py-px text-[11.5px] text-ink-2">
                  {useIcon(u)}
                  {u}
                </span>
              ))}
            </div>
          )}
        </Card>
      )
    case 'sleep':
      return (
        <Card icon={<Timer />} title={<Label text={node.label} />} status={m} tone="sleep">
          {node.duration && <span className="text-[12px] text-ink-3">Waits {node.duration}</span>}
        </Card>
      )
    case 'approval':
      return <Card icon={<UserCheck />} title={<Label text={node.label} />} status={m} tone="approval" sub="Waits for a person to approve" />
    case 'loop':
      return (
        <Group icon={<Repeat />} label={node.label}>
          <Seq nodes={node.body} match={match} />
        </Group>
      )
    case 'parallel':
      return (
        <Group icon={<Zap />} label={node.label}>
          <div className="flex flex-wrap items-start justify-center gap-x-4">
            {node.body.map((n, i) => (
              <div key={i} className="flex flex-col items-center">
                <Connector />
                <NodeView node={n} match={match} />
              </div>
            ))}
          </div>
        </Group>
      )
    case 'branch':
      return (
        <Group icon={<Split />} label={<Label text={node.label} />}>
          <div className="flex items-start justify-center gap-6">
            {[
              { label: 'Yes', nodes: node.then },
              { label: 'Otherwise', nodes: node.else },
            ].map((side) => (
              <div key={side.label} className="flex min-w-[120px] flex-col items-center">
                <span className="mt-2 rounded-full bg-wash px-2 py-px text-[11px] font-medium text-ink-3">{side.label}</span>
                {side.nodes.length ? <Seq nodes={side.nodes} match={match} /> : (
                  <>
                    <Connector />
                    <span className="text-[12px] text-ink-3">Continue</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </Group>
      )
  }
}

/** Step names with {placeholders} from template strings. */
function Label({ text }: { text: string }) {
  const parts = text.split(/(\{[^}]*\})/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('{') && p.endsWith('}') ? (
          <span key={i} className="rounded bg-brand-wash/70 px-1 font-mono text-[11.5px] text-brand-ink">
            {p.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

function stepIcon(uses?: string[]) {
  const u = uses ?? []
  if (u.some((x) => x.startsWith('AI'))) return <Sparkles />
  if (u.some((x) => x.includes(' · '))) return <Plug />
  if (u.some((x) => x.startsWith('writes'))) return <FilePen />
  if (u.some((x) => x.startsWith('fetch'))) return <Globe />
  if (u.some((x) => x.startsWith('reads') || x.startsWith('searches'))) return <FileSearch />
  return <Zap />
}

function useIcon(u: string) {
  const cls = 'size-3'
  if (u.startsWith('AI')) return <Sparkles className={cls} />
  if (u.includes(' · ')) return <Plug className={cls} />
  if (u.startsWith('writes')) return <FilePen className={cls} />
  if (u.startsWith('fetch')) return <Globe className={cls} />
  if (u.startsWith('searches')) return <Search className={cls} />
  return <FileSearch className={cls} />
}

function Connector() {
  return (
    <div className="flex flex-col items-center" aria-hidden>
      <div className="h-4 w-px bg-line-2" />
      <svg width="9" height="5" viewBox="0 0 9 5" className="text-line-2">
        <path d="M0 0 L4.5 5 L9 0" fill="currentColor" />
      </svg>
    </div>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>
}

function Pill({ icon, children, tone }: { icon: ReactNode; children: ReactNode; tone: 'start' | 'end' }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-[320px] items-center gap-1.5 truncate rounded-full border px-3 py-1 text-[12.5px] font-medium [&_svg]:size-3.5 [&_svg]:shrink-0',
        tone === 'start' ? 'border-ink/15 bg-ink text-white' : 'border-agent/25 bg-agent-wash text-agent',
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  )
}

function Card({
  icon,
  title,
  sub,
  children,
  status,
  tone,
}: {
  icon: ReactNode
  title: ReactNode
  sub?: string
  children?: ReactNode
  status?: ReturnType<Matcher>
  tone: 'step' | 'sleep' | 'approval' | 'io'
}) {
  const s = status?.status
  return (
    <div
      className={cn(
        'relative w-[300px] max-w-full rounded-lg border bg-sheet px-3 py-2.5 shadow-[0_1px_0_rgba(26,24,32,0.04)] transition-colors',
        tone === 'sleep' && 'border-dashed',
        tone === 'approval' && 'border-brand/30 bg-brand-wash/40',
        tone === 'io' && 'bg-paper',
        !s && 'border-line-2',
        s === 'done' && 'border-ok/40',
        s === 'running' && 'border-brand ring-2 ring-brand/15',
        s === 'failed' && 'border-danger/50 bg-danger-wash/40',
        (s === 'waiting' || s === 'sleeping') && 'border-[#c98a12]/50 bg-[#fdf6e7]',
        s === 'idle' && 'opacity-55',
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn('mt-px shrink-0 text-ink-3 [&_svg]:size-4', tone === 'approval' && 'text-brand')}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] leading-snug font-medium text-ink">{title}</div>
          {sub && <div className="mt-0.5 text-[12px] text-ink-3">{sub}</div>}
          {children && <div className="mt-1.5">{children}</div>}
          {status?.error && <div className="mt-1.5 line-clamp-3 text-[12px] text-danger">{status.error}</div>}
        </div>
        {s && s !== 'idle' && <StatusDot status={s} count={status?.count} />}
      </div>
    </div>
  )
}

function StatusDot({ status, count }: { status: Status; count?: { done: number; total: number } }) {
  const label = count && count.total > 1 ? `${count.done}/${count.total}` : null
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium [&_svg]:size-3',
        status === 'done' && 'bg-[#e6f4ea] text-ok',
        status === 'running' && 'bg-brand-wash text-brand-ink',
        status === 'failed' && 'bg-danger-wash text-danger',
        (status === 'waiting' || status === 'sleeping') && 'bg-[#fbeccb] text-[#8a5a00]',
      )}
    >
      {status === 'done' ? <Check /> : status === 'running' ? <Loader2 className="animate-spin" /> : status === 'failed' ? <X /> : <Clock />}
      {label}
    </span>
  )
}

function Group({ icon, label, children }: { icon: ReactNode; label: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-2 bg-paper/60 px-4 pt-2.5 pb-4">
      <div className="flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-ink-2 [&_svg]:size-3.5 [&_svg]:text-ink-3">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex flex-col items-center">{children}</div>
    </div>
  )
}

// ------------------------------------------------------------ run overlay

function labelRegex(label: string, prefix = '') {
  const esc = label.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
  const pattern = esc.replace(/\\?\{[^}]*\\?\}|\{[^}]*\}/g, '.+?')
  return new RegExp(`^${prefix}${pattern}( \\(\\d+\\))?$`)
}

function matcher(steps: RunStep[], runStatus?: string): Matcher {
  const finished = runStatus === 'succeeded' || runStatus === 'failed' || runStatus === 'cancelled'
  return (node) => {
    if (node.kind === 'loop' || node.kind === 'branch' || node.kind === 'parallel') return { status: 'idle' }
    const re =
      node.kind === 'approval'
        ? labelRegex(node.label, 'ask: ')
        : labelRegex(node.label)
    const hits = steps.filter((s) => re.test(s.name))
    if (!hits.length) return { status: finished ? 'idle' : 'idle' }
    const done = hits.filter((h) => h.status === 'done').length
    const failed = hits.find((h) => h.status === 'failed')
    const running = hits.some((h) => h.status === 'running')
    const sleeping = hits.some((h) => h.status === 'sleeping')
    let status: Status = 'done'
    if (failed) status = 'failed'
    else if (running) status = 'running'
    else if (sleeping) status = 'sleeping'
    else if (node.kind === 'approval' && runStatus === 'waiting') status = 'waiting'
    return { status, count: { done, total: hits.length }, error: failed?.error }
  }
}
