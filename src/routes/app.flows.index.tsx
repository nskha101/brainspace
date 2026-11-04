import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AlertTriangle, CalendarClock, ChevronRight, Clock, Plus, Workflow } from 'lucide-react'
import { flowsFn } from '../lib/api'
import { Badge, Button, CopyField, PageHeader } from '../components/ui'
import { NewFlowDialog, RunStatus, when } from '../components/FlowForms'
import { timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/flows/')({
  loader: () => flowsFn(),
  component: FlowsPage,
})

const IDEAS = [
  'Make a Brainspace flow that writes a competitor digest every Monday at 9am and saves it in /team/research/digests.',
  'Make a flow that turns meeting notes into action items, asks me to approve them, then adds them to /team/meetings/action-items.md.',
  'Make a flow that summarizes every new PDF in /team/contracts each morning.',
]

function FlowsPage() {
  const { flows, waiting, templates, role } = Route.useLoaderData()
  const [open, setOpen] = useState(false)
  const canWrite = role !== 'viewer'
  const team = flows.filter((f) => f.drive === 'team')
  const mine = flows.filter((f) => f.drive === 'me')

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
      <PageHeader
        title="Flows"
        description="Automations your agents write and Brainspace runs: on demand, on a schedule, or from a webhook. Each flow is a folder with FLOW.md and flow.ts, versioned like any doc."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New flow
            </Button>
          )
        }
      />

      {waiting.length > 0 && (
        <section className="mt-2 mb-6 rounded-lg border border-[#e8c87a] bg-[#fdf6e7] p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[#8a5a00]">
            <Clock className="size-4" /> Waiting for approval
          </h2>
          <ul className="mt-2 space-y-1">
            {waiting.map((r) => (
              <li key={r.id}>
                <Link to="/app/flows/runs/$runId" params={{ runId: r.id }} className="flex items-center gap-2 rounded px-2 py-1.5 text-[13.5px] hover:bg-white/60">
                  <span className="font-medium">{r.flow}</span>
                  <span className="truncate text-ink-2">{r.waitingFor}</span>
                  <span className="ml-auto shrink-0 text-[12px] text-ink-3">{timeAgo(r.createdAt)}</span>
                  <ChevronRight className="size-3.5 text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {flows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-line bg-paper/50 p-6">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <Workflow className="size-4.5 text-brand" /> No flows yet
          </div>
          <p className="mt-1.5 text-[13.5px] text-ink-2">
            Ask your agent to build one. It writes the code, tests it, and shows you before anything runs on a schedule. A few to try:
          </p>
          <div className="mt-4 space-y-2">
            {IDEAS.map((i) => (
              <CopyField key={i} value={i} mono={false} />
            ))}
          </div>
        </div>
      ) : (
        [
          { label: 'Team flows', list: team, hint: 'Anyone except read-only members can run these.' },
          { label: 'Your private flows', list: mine, hint: 'Only you see and run these. Promote a flow’s folder to share it.' },
        ].map((group) =>
          group.list.length === 0 && group.label.startsWith('Your') ? null : (
            <section key={group.label} className="mt-6">
              <h2 className="text-sm font-semibold">{group.label}</h2>
              <p className="mb-3 text-[13px] text-ink-3">{group.hint}</p>
              {group.list.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line-2 px-4 py-3 text-[13px] text-ink-3">None yet.</p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {group.list.map((f) => (
                    <li key={f.id}>
                      <Link to="/app/flows/$flowId" params={{ flowId: f.id }} className="block px-4 py-3.5 hover:bg-paper">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{f.name}</span>
                          {f.status === 'invalid' && (
                            <Badge tone="danger">
                              <AlertTriangle className="size-3" /> Needs fixing
                            </Badge>
                          )}
                          {f.waitingApprovals > 0 && <Badge className="bg-[#fbeccb] text-[#8a5a00]">{f.waitingApprovals} waiting</Badge>}
                          <span className="ml-auto flex items-center gap-3 text-[12px] text-ink-3">
                            {f.nextRunAt && (
                              <span className="inline-flex items-center gap-1">
                                <CalendarClock className="size-3.5" /> Next {when(f.nextRunAt)}
                              </span>
                            )}
                            {f.lastRun && (
                              <span className="inline-flex items-center gap-1.5">
                                <RunStatus status={f.lastRun.status} test={f.lastRun.test} /> {timeAgo(f.lastRun.at)}
                              </span>
                            )}
                          </span>
                        </div>
                        <p className="mt-1 text-[13.5px] text-ink-2">{f.description || <span className="text-ink-3">No description</span>}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ),
        )
      )}
      <NewFlowDialog open={open} onClose={() => setOpen(false)} templates={templates} />
    </div>
  )
}
