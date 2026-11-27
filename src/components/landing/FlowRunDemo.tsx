import { useEffect, useRef, useState } from 'react'
import { Check, RotateCw, UserCheck, X } from 'lucide-react'
import { FlowDiagram, type DiagramNode, type RunStep } from '../FlowDiagram'
import { LogoMark } from '../Logo'
import { Button } from '../ui'
import { Pane } from './Pane'
import { money, openDeals, START_DEALS, sum, wonDeals } from './deals'

const ASK = 'Post the summary to #sales?'

const DIAGRAM: DiagramNode[] = [
  { kind: 'step', label: 'pull open deals', description: 'Pulls every open deal from HubSpot', uses: ['hubspot · search_crm_objects'] },
  { kind: 'step', label: 'update the deals table', description: 'Saves them to the pipeline database', uses: ['updates /team/sales/pipeline.db'] },
  { kind: 'step', label: 'write the summary', description: 'Writes up what moved this week', uses: ['AI write'] },
  { kind: 'approval', label: ASK },
]

const NAMES = ['pull open deals', 'update the deals table', 'write the summary', `ask: ${ASK}`]
const STEP_MS = 850

const open = openDeals(START_DEALS)
const SUMMARY = `Open pipeline is ${money(sum(open))} across ${open.length} deals. Northwind closed for ${money(sum(wonDeals(START_DEALS)))}. Halcyon Labs moved to proposal, and Tidewater is in negotiation.`

type Outcome = 'waiting' | 'approved' | 'rejected'

/**
 * A flow's run page in miniature. It opens on a run that is waiting for approval, drawn with the
 * app's own diagram. Approving or rejecting finishes the run, and it can be played again from the top.
 */
export function FlowRunDemo() {
  // How many steps have started. With `playing`, the last of them is still running.
  const [started, setStarted] = useState(NAMES.length)
  const [playing, setPlaying] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>('waiting')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!playing) return
    timer.current = setTimeout(() => {
      if (started >= NAMES.length - 1) setPlaying(false)
      setStarted((n) => Math.min(n + 1, NAMES.length))
    }, STEP_MS)
    return () => clearTimeout(timer.current)
  }, [playing, started])

  const replay = () => {
    setOutcome('waiting')
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setStarted(NAMES.length)
    setStarted(1)
    setPlaying(true)
  }

  const steps: RunStep[] = NAMES.slice(0, started).map((name, i) => ({
    name,
    kind: i === NAMES.length - 1 ? 'approval' : 'step',
    status: playing && i === started - 1 ? 'running' : 'done',
  }))
  const runStatus = playing ? 'running' : outcome === 'waiting' ? 'waiting' : outcome === 'approved' ? 'succeeded' : 'cancelled'
  const status = playing
    ? `Running step ${started} of ${NAMES.length}`
    : outcome === 'waiting'
      ? 'Waiting for approval'
      : outcome === 'approved'
        ? 'Finished'
        : 'Rejected'

  return (
    <Pane path="/team/flows/weekly-pipeline" aside={<span aria-live="polite">Run 14. {status}</span>}>
      <div className="grid md:grid-cols-[364px_minmax(0,1fr)]">
        <div className="border-b border-line bg-paper/50 md:border-r md:border-b-0">
          <FlowDiagram
            diagram={DIAGRAM}
            starts={[{ kind: 'schedule', label: 'Mondays at 9:00' }]}
            outputs={{ summary: { type: 'markdown' } }}
            destinations={['slack · post_message']}
            steps={steps}
            runStatus={runStatus}
          />
        </div>

        <div className="flex min-h-[420px] min-w-0 flex-col px-5 py-5">
          <p className="text-[13px] leading-relaxed text-ink-3">
            Started by the Monday schedule. Runs as Dev Patel, with his access and nothing more.
          </p>

          {playing && (
            <p className="mt-6 text-[14px] leading-relaxed text-ink-2">
              Each step's result is saved when it finishes. If a step fails, the run retries that step and keeps the ones
              before it.
            </p>
          )}

          {!playing && outcome === 'waiting' && (
            <section className="mt-4 rounded-xl border border-brand/30 bg-brand-wash/40 p-4 sm:p-5">
              <div className="flex items-center gap-2 text-[13px] font-medium text-brand-ink">
                <UserCheck className="size-4" aria-hidden /> Waiting for approval
              </div>
              <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">{ASK}</h3>
              <p className="mt-3 rounded-lg border border-line bg-sheet p-3 text-[13.5px] leading-relaxed text-ink-2">{SUMMARY}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => setOutcome('approved')}>
                  <Check className="size-4" /> Approve
                </Button>
                <Button onClick={() => setOutcome('rejected')}>
                  <X className="size-4" /> Reject
                </Button>
              </div>
            </section>
          )}

          {!playing && outcome === 'approved' && (
            <div className="landing-block mt-4">
              <p className="text-[14px] font-medium text-ink">Approved by you. Posted to #sales.</p>
              <div className="mt-3 flex gap-3 rounded-lg border border-line p-3.5">
                <span className="mt-0.5 shrink-0">
                  <LogoMark size={34} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
                    <span className="font-bold">Brainspace</span>
                    <span className="rounded bg-wash px-1 text-[10.5px] font-medium text-ink-3">APP</span>
                    <span className="text-[12px] text-ink-3">9:04 AM in #sales</span>
                  </div>
                  <p className="mt-0.5 text-[14px] leading-relaxed text-ink">
                    <span className="font-semibold">Pipeline this week.</span> {SUMMARY}
                  </p>
                </div>
              </div>
            </div>
          )}

          {!playing && outcome === 'rejected' && (
            <p className="landing-block mt-4 max-w-[46ch] text-[14px] leading-relaxed text-ink-2">
              <span className="font-medium text-ink">Rejected by you.</span> Nothing was posted. The deals table keeps this
              week's update, because that step had already finished.
            </p>
          )}

          <div className="mt-auto pt-8">
            <div className="text-[13px] text-ink-3">All this flow may touch, from its FLOW.md</div>
            <pre className="mt-2 rounded-lg bg-paper px-3.5 py-3 font-mono text-[12.5px] leading-[1.7] whitespace-pre-wrap text-ink">
              <span className="text-ink-3">uses:</span>
              {'\n  '}
              <span className="text-ink-3">connections:</span> [hubspot]
              {'\n  '}
              <span className="text-ink-3">write:</span> [/team/sales/pipeline.db]
              {'\n  '}
              <span className="text-ink-3">ai:</span> true
            </pre>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-5">
            <p className="max-w-[40ch] text-[13px] leading-relaxed text-ink-3">
              {outcome === 'waiting' && !playing
                ? 'This run would wait here for days. Nothing reaches Slack until someone says yes.'
                : 'Every run keeps its inputs, steps and outputs, and the version of the code it ran.'}
            </p>
            {(playing || outcome !== 'waiting') && (
              <Button size="sm" onClick={replay} disabled={playing}>
                <RotateCw className="size-3.5" /> Run it again
              </Button>
            )}
          </div>
        </div>
      </div>
    </Pane>
  )
}
