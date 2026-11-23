import { useState } from 'react'
import { ArrowDown, ArrowRight, Code2, Maximize2, RotateCw } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Pane } from './Pane'
import { money, openDeals, STAGES, START_DEALS, sum, wonDeals, type Deal, type Stage } from './deals'

/**
 * A database and the artifact that reads it, side by side. Changing a deal's stage in the grid
 * redraws the page, which is what happens in the app when anyone changes a row.
 */
export function PipelineDemo() {
  const [deals, setDeals] = useState(START_DEALS)
  // Bumped on every edit so the page's "redrew" note can replay its fade.
  const [edits, setEdits] = useState(0)

  const setStage = (company: string, stage: Stage) => {
    setDeals((rows) => rows.map((d) => (d.company === company ? { ...d, stage, by: 'You', agent: false } : d)))
    setEdits((n) => n + 1)
  }

  return (
    <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,11fr)_auto_minmax(0,9fr)]">
      <Pane path="/team/sales/pipeline.db" aside={`deals, ${deals.length} rows`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-[12.5px] text-ink-3">
                <th className="px-5 py-2 font-medium">company</th>
                <th className="px-2 py-2 font-medium">stage</th>
                <th className="px-2 py-2 text-right font-medium">amount</th>
                <th className="py-2 pr-5 pl-4 font-medium">changed by</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.company} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-2 font-medium whitespace-nowrap">{d.company}</td>
                  <td className="px-2 py-1">
                    <select
                      aria-label={`Stage for ${d.company}`}
                      value={d.stage}
                      onChange={(e) => setStage(d.company, e.target.value as Stage)}
                      className="h-7 cursor-pointer rounded-md border border-line-2 bg-sheet pr-1 pl-1.5 text-[13px] text-ink hover:border-ink-3"
                    >
                      {STAGES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(d.amount)}</td>
                  <td className={cn('py-2 pr-5 pl-4 whitespace-nowrap', d.agent ? 'text-agent' : d.by === 'You' ? 'font-medium text-ink' : 'text-ink-2')}>
                    {d.by}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Pane>

      <div className="flex items-center justify-center gap-2 text-[12.5px] text-ink-3 xl:flex-col" aria-hidden>
        <ArrowDown className="size-4 xl:hidden" />
        <ArrowRight className="hidden size-4 xl:block" />
      </div>

      <Pane path="/team/artifacts/pipeline/index.html" className="flex flex-col">
        <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-ink-3" aria-hidden>
          <span className="mr-auto px-2 text-sm font-medium text-ink">Pipeline</span>
          <span className="grid size-7 place-items-center">
            <RotateCw className="size-3.5" />
          </span>
          <span className="inline-flex h-7 items-center gap-1.5 px-2 text-[13px]">
            <Code2 className="size-3.5" /> Code
          </span>
          <span className="grid size-7 place-items-center">
            <Maximize2 className="size-3.5" />
          </span>
        </div>
        <Dashboard deals={deals} />
        <p className="mt-auto border-t border-line px-5 py-2.5 text-[12.5px] text-ink-3" aria-live="polite">
          {edits === 0 ? (
            'Reads pipeline.db when it opens, and again when a row changes.'
          ) : (
            <span key={edits} className="landing-block inline-block">
              Redrew after your change to pipeline.db.
            </span>
          )}
        </p>
      </Pane>
    </div>
  )
}

/** The page the artifact draws: one headline number and the amount in each stage. */
function Dashboard({ deals }: { deals: Deal[] }) {
  const open = openDeals(deals)
  const won = wonDeals(deals)
  const byStage = STAGES.map((stage) => ({ stage, total: sum(deals.filter((d) => d.stage === stage)) }))
  const max = Math.max(...byStage.map((s) => s.total), 1)

  return (
    <div className="px-5 pt-5 pb-6">
      <div className="text-[13px] text-ink-2">Open pipeline</div>
      <div className="mt-0.5 text-[40px] leading-none font-semibold tracking-[-0.035em] tabular-nums">{money(sum(open))}</div>
      <div className="mt-2 text-[13px] text-ink-3">
        {open.length} open {open.length === 1 ? 'deal' : 'deals'}, {money(sum(won))} won this month
      </div>

      <dl className="mt-6 space-y-2.5">
        {byStage.map(({ stage, total }) => (
          <div key={stage} className="grid grid-cols-[86px_minmax(0,1fr)] items-center gap-2 text-[13px]">
            <dt className="text-ink-2">{stage}</dt>
            <dd className="flex items-center gap-2">
              <span
                className="h-3.5 rounded-r-[4px] bg-ink transition-[width] duration-500 ease-out"
                // Leaves room at the end of the longest bar for its label.
                style={{ width: `${(total / max) * 68}%`, minWidth: total ? 2 : 0 }}
              />
              <span className="text-ink tabular-nums">{money(total)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
