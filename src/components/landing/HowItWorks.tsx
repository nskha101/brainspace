import type { ReactNode } from 'react'
import { Bot, MessageSquare, Plug } from 'lucide-react'

const STEPS: { icon: ReactNode; title: string; body: string; detail: ReactNode }[] = [
  {
    icon: <Plug />,
    title: 'Connect your tools once',
    body: 'Stripe, your database, PostHog, HubSpot, or any MCP server or API. The keys stay in Brainspace, encrypted. You pick who can use each one and which of its tools.',
    detail: (
      <>
        <span className="text-agent">stripe</span> Priya only, read tools
      </>
    ),
  },
  {
    icon: <Bot />,
    title: 'Ask your agent to build it',
    body: 'Describe the check in Claude Code, Cursor or Codex. It writes a bot, a flow or a page, and gives it only the folders and connections the job needs.',
    detail: (
      <>
        <span className="text-agent">bot_create</span> overage-check
      </>
    ),
  },
  {
    icon: <MessageSquare />,
    title: 'Your team uses it',
    body: "Teammates ask in Slack or from their own agent. It runs with the access you gave it, and every run and change is logged under its name and yours.",
    detail: (
      <>
        <span className="text-agent">@overage-check</span> in #support
      </>
    ),
  },
]

/** The same three steps behind every use case above, in a row joined by a line. */
export function HowItWorks() {
  return (
    <ol className="relative grid gap-8 md:grid-cols-3 md:gap-6">
      {/* The line the step markers sit on, from the centre of the first marker to the centre of the last. */}
      <div className="absolute top-5 right-[calc(33.333%-36px)] left-5 hidden h-px bg-line-2 md:block" aria-hidden />
      {STEPS.map((s, i) => (
        <li key={s.title} className="relative">
          <div className="flex items-center gap-3 md:flex-col md:items-start">
            <div className="relative z-10 grid size-10 place-items-center rounded-full border border-line-2 bg-sheet text-brand [&>svg]:size-[18px]">
              {s.icon}
            </div>
            <span className="text-[12px] font-medium tracking-wide text-ink-3 uppercase md:mt-4">Step {i + 1}</span>
          </div>
          <h3 className="mt-3 text-[19px] leading-tight font-semibold tracking-[-0.015em]">{s.title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
          <p className="mt-3 w-fit rounded-md bg-sheet px-2.5 py-1 font-mono text-[12px] text-ink-2 shadow-[0_0_0_1px_var(--color-line-2)]">{s.detail}</p>
        </li>
      ))}
    </ol>
  )
}
