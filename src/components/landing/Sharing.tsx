import { Check, Lock, Users } from 'lucide-react'
import { cn } from '../../lib/utils'

const VERSIONS = [
  { n: 1, by: 'Claude Code for Maya', agent: true },
  { n: 2, by: 'Maya Chen' },
  { n: 3, by: 'Claude Code for Maya', agent: true },
]

/** The same three versions on both sides: promoting a draft moves it, history included. */
export function PromoteDiagram() {
  return (
    <figure className="mt-10 grid max-w-[820px] items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
      <DocCard
        dashed
        icon={<Lock className="size-3.5" aria-hidden />}
        who="Only Maya and her agents"
        docPath="/me/drafts/launch-email.md"
      />
      <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-brand-ink md:flex-col md:gap-1 md:px-1">
        <svg width="40" height="12" viewBox="0 0 40 12" aria-hidden className="rotate-90 md:rotate-0">
          <path d="M0 6h36M31 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        promote
      </div>
      <DocCard
        icon={<Users className="size-3.5" aria-hidden />}
        who="Everyone in Fieldnote"
        docPath="/team/launches/launch-email.md"
        next
      />
    </figure>
  )
}

function DocCard({
  dashed,
  icon,
  who,
  docPath,
  next,
}: {
  dashed?: boolean
  icon: React.ReactNode
  who: string
  docPath: string
  next?: boolean
}) {
  return (
    <div className={cn('rounded-lg border px-4 py-4', dashed ? 'border-dashed border-line-2' : 'border-line-2 bg-sheet')}>
      <div className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
        {icon}
        {who}
      </div>
      <div className="mt-1.5 font-mono text-[13px] break-all text-ink">{docPath}</div>
      <ol className="mt-4 space-y-1.5 border-t border-line pt-3 text-[13px]">
        {VERSIONS.map((v) => (
          <li key={v.n} className="flex items-baseline gap-2">
            <span className="w-5 font-semibold tabular-nums">v{v.n}</span>
            <span className={v.agent ? 'text-agent' : 'text-ink-2'}>{v.by}</span>
          </li>
        ))}
        <li className={cn('flex items-baseline gap-2 text-ink-3', !next && 'invisible')} aria-hidden={!next}>
          <span className="w-5 tabular-nums">v4</span>
          <span>The next edit, by anyone on the team</span>
        </li>
      </ol>
    </div>
  )
}

const ROLES = ['Admin', 'Member', 'Read-only']
// How many of the roles, counted from Admin, can do each thing.
const ABILITIES: [string, number][] = [
  ['Read the team space and query its databases', 3],
  ['Use read-only tools from connections', 3],
  ['Edit docs, databases, flows and artifacts', 2],
  ['Run flows, create bots and connect new services', 2],
  ['Delete team files and remove connections', 1],
  ['Invite people and change their roles', 1],
]

export function RolesTable() {
  return (
    <div className="mt-8 max-w-[760px]">
      <table className="w-full text-left text-[14px] sm:text-[14.5px]">
        <thead>
          <tr className="border-b border-line-2">
            <td />
            {ROLES.map((r) => (
              <th key={r} scope="col" className="w-[66px] pb-2.5 text-center text-[12.5px] font-semibold whitespace-nowrap sm:w-[96px] sm:px-2 sm:text-[14px]">
                {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ABILITIES.map(([what, count]) => (
            <tr key={what} className="border-b border-line">
              <th scope="row" className="py-2.5 pr-4 font-normal text-ink-2">
                {what}
              </th>
              {ROLES.map((r, i) => (
                <td key={r} className="px-2 py-2.5 text-center">
                  {i < count ? (
                    <Check className="mx-auto size-4 text-ink" aria-label="Yes" />
                  ) : (
                    <span className="text-ink-3" aria-label="No">
                      –
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
