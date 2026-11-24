import { useEffect, useRef, useState } from 'react'
import { Bot, BotMessageSquare, Check, GitFork, Loader2, Lock, RotateCw, Users } from 'lucide-react'
import { Button } from '../ui'
import { cn } from '../../lib/utils'
import { Pane } from './Pane'

const SUBAGENTS = [
  { name: 'Quillpad', found: 'Shipped shared folders.', file: 'quillpad.md', version: 7 },
  { name: 'Notewell', found: 'Raised its team price to $12.', file: 'notewell.md', version: 4 },
  { name: 'Marginly', found: 'Nothing new this week.', file: null, version: 0 },
]

// The run, in the order it plays. Stage 2 is the three subagents working at once.
const BEFORE = [{ tool: 'list', arg: '/team/research/competitors', result: 'Three competitors. Notes last updated 9 days ago.' }]
const AFTER = [
  { tool: 'write', arg: '/team/research/digests/2026-11-23.md', result: 'Saved as version 1.' },
  { tool: 'remember', arg: '', result: 'Covered through November 23.' },
]
const STAGES = BEFORE.length + 1 + AFTER.length
const STEP_MS = 900

const SETTINGS: [string, string][] = [
  ['Runs', 'Mondays at 9:00, New York time'],
  ['Model', 'anthropic/claude-sonnet-5.5'],
  ['Reads', '/team/research, /team/brand'],
  ['Changes', '/team/research'],
  ['Uses', 'exa'],
]

function Call({ tool, arg, result, running }: { tool: string; arg: string; result: string; running?: boolean }) {
  return (
    <li className="py-1.5">
      <div className="font-mono text-[12.5px] leading-snug break-all">
        <span className="text-agent">{tool}</span>
        {arg && <span className="text-ink"> {arg}</span>}
      </div>
      <div className="mt-0.5 text-[13px] leading-snug text-ink-3">{running ? 'Working…' : result}</div>
    </li>
  )
}

/**
 * A bot from request to run: what Priya asked for and what her agent set up on the left, one run on
 * the right. The run opens finished and can be played again from the top.
 */
export function BotRunDemo() {
  // How many stages have started. With `playing`, the last of them is still running.
  const [started, setStarted] = useState(STAGES)
  const [playing, setPlaying] = useState(false)
  const [team, setTeam] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!playing) return
    timer.current = setTimeout(
      () => {
        if (started >= STAGES) return setPlaying(false)
        setStarted((n) => n + 1)
      },
      // The subagents take a little longer than a single call.
      started === BEFORE.length + 1 ? STEP_MS * 2 : STEP_MS,
    )
    return () => clearTimeout(timer.current)
  }, [playing, started])

  const replay = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setStarted(1)
    setPlaying(true)
  }

  const done = !playing
  const running = (stage: number) => playing && started === stage
  const fanStage = BEFORE.length + 1

  return (
    <Pane
      path="Bots / Competitor watch"
      aside={<span aria-live="polite">{done ? 'Last run finished in 48 seconds' : `Running, step ${started} of ${STAGES}`}</span>}
    >
      <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="border-b border-line px-5 py-5 md:border-r md:border-b-0">
          <p className="ml-auto w-fit max-w-[34ch] rounded-lg rounded-br-sm bg-ink px-3.5 py-2 text-[14px] leading-snug text-white">
            Make a bot that checks what our competitors shipped every Monday.
          </p>
          <div className="mt-4 flex items-center gap-2 text-[13px]">
            <Bot className="size-4 text-agent" aria-hidden />
            <span className="font-medium text-agent">Claude Code</span>
            <span className="text-ink-3">for Priya Nair</span>
          </div>
          <div className="mt-2 font-mono text-[12.5px] text-agent">bot_create</div>

          <dl className="mt-3 divide-y divide-line border-y border-line text-[13.5px]">
            {SETTINGS.map(([k, v]) => (
              <div key={k} className="flex gap-3 py-2">
                <dt className="w-[68px] shrink-0 text-ink-3">{k}</dt>
                <dd className={cn('min-w-0 text-ink', k !== 'Runs' && 'font-mono text-[12.5px] leading-[1.6] break-words')}>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-wash p-1 text-[13px]" role="group" aria-label="Who can see the bot">
            {(
              [
                [false, 'Just Priya', <Lock key="l" className="size-3.5" aria-hidden />],
                [true, 'The team', <Users key="u" className="size-3.5" aria-hidden />],
              ] as const
            ).map(([v, label, icon]) => (
              <button
                key={label}
                type="button"
                aria-pressed={team === v}
                onClick={() => setTeam(v)}
                className={cn('flex items-center justify-center gap-1.5 rounded-md py-1.5 font-medium', team === v ? 'bg-sheet text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-ink-3">
            {team
              ? 'Everyone in Fieldnote sees the bot and its runs. It works in /team only, and still acts as Priya.'
              : 'Only Priya sees the bot and its runs. It could use her /me space too, if she let it.'}
          </p>
        </div>

        <div className="flex min-h-[470px] min-w-0 flex-col bg-paper/50 px-5 py-5">
          <div className="flex items-center gap-2 text-[13px]">
            <BotMessageSquare className="size-4 text-brand" aria-hidden />
            <span className="font-medium text-brand-ink">Competitor watch</span>
            <span className="text-ink-3">Monday 9:00, on schedule</span>
          </div>

          <ol className="mt-3" aria-label="What the bot did">
            {BEFORE.map((c, i) => started > i && <Call key={c.tool} {...c} running={running(i + 1)} />)}

            {started >= fanStage && (
              <li className="landing-block py-2">
                <div className="flex items-center gap-1.5 font-mono text-[12.5px] text-agent">
                  <GitFork className="size-3.5" aria-hidden /> run_subagents
                  <span className="font-sans text-[13px] text-ink-3">one per competitor, at the same time</span>
                </div>
                <ul className="mt-2 grid gap-2 sm:grid-cols-3">
                  {SUBAGENTS.map((s) => (
                    <li key={s.name} className="rounded-lg border border-agent/25 bg-agent-wash/40 px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                        {running(fanStage) ? <Loader2 className="size-3.5 animate-spin text-agent" aria-hidden /> : <Check className="size-3.5 text-agent" aria-hidden />}
                        {s.name}
                      </div>
                      <p className="mt-1 text-[12.5px] leading-snug text-ink-2">{running(fanStage) ? 'Searching and reading…' : s.found}</p>
                      {!running(fanStage) && (
                        <p className="mt-1 font-mono text-[11.5px] break-all text-ink-3">{s.file ? `edit ${s.file} → v${s.version}` : 'no changes'}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            )}

            {AFTER.map((c, i) => started > fanStage + i && <Call key={c.tool} {...c} running={running(fanStage + i + 1)} />)}
          </ol>

          {done && (
            <p className="landing-block mt-3 max-w-[52ch] text-[14px] leading-relaxed text-ink-2">
              Quillpad shipped shared folders and Notewell raised its team price. I updated both pages and wrote this week's
              digest. Marginly had nothing new, so I left its page alone.
            </p>
          )}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-6">
            <p className="max-w-[42ch] text-[13px] leading-relaxed text-ink-3">
              {done
                ? 'In Activity, each of these edits is signed "Competitor watch, for Priya Nair", and each can be restored.'
                : 'Each subagent starts with a fresh context and the same access as the bot.'}
            </p>
            <Button size="sm" onClick={replay} disabled={playing}>
              <RotateCw className="size-3.5" /> Run it again
            </Button>
          </div>
        </div>
      </div>
    </Pane>
  )
}
