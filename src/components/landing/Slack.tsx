import type { ReactNode } from 'react'
import { BotMessageSquare } from 'lucide-react'
import { cn } from '../../lib/utils'

/** The people in the homepage's made-up workspace, Fieldnote, with a colour each for their avatar. */
export const PEOPLE = {
  priya: { name: 'Priya Nair', initials: 'PN', color: 'bg-brand' },
  dev: { name: 'Dev Patel', initials: 'DP', color: 'bg-[#5b4fc4]' },
  maya: { name: 'Maya Chen', initials: 'MC', color: 'bg-[#c27a12]' },
} as const

type Person = keyof typeof PEOPLE

/**
 * One message in a Slack channel, drawn in the homepage's own colours: an avatar, a name and time,
 * then the body. Pass `bot` for a Brainspace bot answering under its own name.
 */
export function SlackMessage({
  from,
  bot,
  time,
  children,
  className,
}: {
  from?: Person
  bot?: string
  time: string
  children: ReactNode
  className?: string
}) {
  const person = from ? PEOPLE[from] : null
  return (
    <div className={cn('flex gap-3', className)}>
      {person ? (
        <div className={cn('grid size-8 shrink-0 place-items-center rounded-md text-[11.5px] font-semibold text-white', person.color)} aria-hidden>
          {person.initials}
        </div>
      ) : (
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-ink text-white" aria-hidden>
          <BotMessageSquare className="size-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[13.5px] leading-tight">
          <span className="font-semibold text-ink">{person?.name ?? bot}</span>
          {bot && <span className="rounded-[3px] bg-wash px-1 text-[10px] font-semibold tracking-wide text-ink-3">APP</span>}
          <span className="text-[12px] text-ink-3 tabular-nums">{time}</span>
        </div>
        <div className="mt-1 text-[14px] leading-relaxed text-ink">{children}</div>
      </div>
    </div>
  )
}

/** A bot's handle inside a message, the way Slack highlights a mention. */
export function Mention({ children }: { children: ReactNode }) {
  return <span className="rounded-[3px] bg-agent-wash px-0.5 font-medium text-agent">{children}</span>
}

/** A tool call as a step: the tool in mono, what it was given, and what came back. */
export function ToolStep({
  tool,
  arg,
  result,
  state = 'done',
}: {
  tool: string
  arg?: string
  result: ReactNode
  state?: 'running' | 'done' | 'refused'
}) {
  return (
    <li className="landing-block py-1.5">
      <div className="font-mono text-[12px] leading-snug [font-variant-ligatures:none] [overflow-wrap:anywhere]">
        <span className="text-agent">{tool}</span>
        {arg && <span className="text-ink-2"> {arg}</span>}
      </div>
      <div className={cn('mt-0.5 text-[13px] leading-snug', state === 'refused' ? 'text-danger' : 'text-ink-3')}>
        {state === 'running' ? 'Working…' : result}
      </div>
    </li>
  )
}
