import { useEffect, useRef, useState } from 'react'
import { Bot, KeyRound, Loader2, RotateCw } from 'lucide-react'
import { logoUrl } from '../../lib/presets'
import { cn } from '../../lib/utils'
import { Mention, SlackMessage, ToolStep } from './Slack'

const STEPS = [
  {
    tool: 'postgres__query',
    arg: "select sum(credits) from usage where org = 'brightline' and day >= '2026-11-01'",
    result: '61,400 credits since November 1.',
  },
  {
    tool: 'stripe__list_subscriptions',
    arg: 'customer: Brightline',
    result: 'Team plan, 50,000 credits a month, renews December 1.',
  },
]
// Stage 1 is the question, then one stage per tool call, then the answer.
const LAST = STEPS.length + 2
const STEP_MS = 1100

const REFUSED = [
  { tool: 'connection_call', arg: 'stripe list_subscriptions', result: "You don't have access to Stripe. Ask an admin to grant you access." },
  { tool: 'connection_call', arg: 'postgres query', result: "You don't have access to Postgres. Ask an admin to grant you access." },
]

/**
 * The homepage's lead example. Dev in support asks a bot in Slack whether a customer is over their plan,
 * and the bot answers from Stripe and the production database with Priya's access. The second tab is
 * Dev asking their own agent the same thing, and being refused, because Dev's account has neither.
 */
export function OverageDemo() {
  const [tab, setTab] = useState<'bot' | 'direct'>('bot')
  const [stage, setStage] = useState(1)
  const [playing, setPlaying] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Plays once on load. People who'd rather not see motion get the finished thread.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStage(LAST)
      setPlaying(false)
    }
  }, [])

  useEffect(() => {
    if (!playing) return
    timer.current = setTimeout(() => {
      if (stage >= LAST) return setPlaying(false)
      setStage((s) => s + 1)
    }, stage === 1 ? 700 : STEP_MS)
    return () => clearTimeout(timer.current)
  }, [playing, stage])

  const replay = () => {
    setTab('bot')
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setStage(1)
    setPlaying(true)
  }

  const answered = stage >= LAST && !playing

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-line-2 bg-sheet shadow-[0_24px_60px_-28px_rgba(26,24,32,0.28)]">
      <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5">
        {tab === 'bot' ? (
          <div className="flex items-center gap-2 text-[13.5px]">
            <img src={logoUrl('slack.com')} alt="" width={16} height={16} className="rounded-[3px]" />
            <span className="font-semibold text-ink"># support</span>
            <span className="hidden text-ink-3 sm:inline">Fieldnote</span>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2 text-[13.5px]">
            <Bot className="size-4 shrink-0 text-agent" aria-hidden />
            <span className="font-semibold text-agent">Claude Code</span>
            <span className="hidden truncate text-ink-3 sm:inline">signed in as Dev Patel</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-wash p-0.5 text-[12.5px]" role="tablist" aria-label="How Dev asks">
          {(
            [
              ['bot', 'Ask the bot'],
              ['direct', 'Ask without it'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={tab === v}
              onClick={() => setTab(v)}
              className={cn('rounded-md px-2.5 py-1 font-medium whitespace-nowrap', tab === v ? 'bg-sheet text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'bot' ? (
        <div className="min-h-[330px] space-y-4 px-4 py-4 sm:px-5">
          <SlackMessage from="dev" time="10:42">
            <Mention>@overage-check</Mention> is Brightline over their plan this month? They're asking before they renew.
          </SlackMessage>

          {stage >= 2 && (
            <SlackMessage bot="overage-check" time="10:42" className="landing-block">
              {answered ? (
                <p className="landing-block">
                  Yes. Brightline has used <strong className="font-semibold">61,400 credits</strong> since November 1 on the
                  50,000-credit Team plan, so they're 11,400 over (23%). At $0.004 a credit that's{' '}
                  <strong className="font-semibold">$45.60</strong>, which goes on the December 1 invoice.
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-ink-3">
                  <Loader2 className="size-3.5 animate-spin text-agent" aria-hidden /> Checking usage and billing…
                </p>
              )}
              <ol className="mt-2 border-l-2 border-line pl-3" aria-label="What the bot did">
                {STEPS.map((s, i) => stage >= i + 2 && <ToolStep key={s.tool} {...s} state={playing && stage === i + 2 ? 'running' : 'done'} />)}
              </ol>
            </SlackMessage>
          )}
        </div>
      ) : (
        <div className="min-h-[330px] px-4 py-4 sm:px-5">
          <p className="ml-auto w-fit max-w-[38ch] rounded-lg rounded-br-sm bg-ink px-3.5 py-2 text-[14px] leading-snug text-white">
            How many credits has Brightline used this month, and what plan are they on?
          </p>
          <ol className="mt-3" aria-label="What Dev's agent tried">
            {REFUSED.map((r) => (
              <ToolStep key={r.arg} {...r} state="refused" />
            ))}
          </ol>
          <p className="mt-3 max-w-[50ch] text-[14px] leading-relaxed text-ink-2">
            Your account can't reach Stripe or the production database, so I can't look this up.
          </p>
          <p className="mt-6 max-w-[52ch] border-t border-line pt-4 text-[13px] leading-relaxed text-ink-3">
            Same person, same question. Dev has no access to Stripe or the database, and the bot doesn't change that.
            It answers because Priya gave it read access to both, and only that.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-paper/60 px-4 py-3 sm:px-5">
        <p className="flex min-w-0 items-start gap-2 text-[12.5px] leading-relaxed text-ink-2">
          <KeyRound className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
          <span>
            <span className="font-medium text-ink">overage-check</span> acts as Priya Nair, with Stripe's read tools and a
            read-only database query. It can't change either.
          </span>
        </p>
        <button
          type="button"
          onClick={replay}
          disabled={playing && tab === 'bot'}
          className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-2 hover:text-ink disabled:opacity-50"
        >
          <RotateCw className="size-3.5" aria-hidden /> Ask again
        </button>
      </div>
    </div>
  )
}
