import { useEffect, useRef, useState } from 'react'
import { Bot } from 'lucide-react'
import { cn } from '../lib/utils'

type Version = { n: number; person: string; agent?: string; message: string; when: string }
type Block = { id: string; kind: 'h1' | 'h2' | 'p' | 'li'; text: string; added: number; removed?: number }

const VERSIONS: Version[] = [
  { n: 1, person: 'Maya Chen', message: 'Start the voice doc', when: '9 days ago' },
  { n: 2, person: 'Maya Chen', agent: 'Claude Code', message: 'Add words to avoid from the support ticket audit', when: '6 days ago' },
  { n: 3, person: 'Dev Patel', message: 'Add the product name rule', when: '4 days ago' },
  { n: 4, person: 'Dev Patel', agent: 'Cursor', message: 'Make the opening line concrete', when: 'Yesterday' },
  { n: 5, person: 'Priya Nair', agent: 'Claude Cowork', message: 'Promote my before-and-after examples', when: '12 min ago' },
]

// The doc in its final order. Blocks deleted along the way stay in place so a version can show them struck out.
const BLOCKS: Block[] = [
  { id: 'title', kind: 'h1', text: 'Brand voice', added: 1 },
  { id: 'open-1', kind: 'p', text: 'We write like a knowledgeable friend. Plain words, short sentences, no hype.', added: 1, removed: 4 },
  {
    id: 'open-4',
    kind: 'p',
    text: "Write the way you'd explain Fieldnote to a sharp customer on a call. Plain words, short sentences, no hype.",
    added: 4,
  },
  { id: 'name', kind: 'p', text: 'It\'s Fieldnote, one word, capital F only. Never "FieldNote" or "the app".', added: 3 },
  { id: 'avoid', kind: 'h2', text: 'Words we avoid', added: 2 },
  { id: 'avoid-1', kind: 'li', text: 'Seamless and robust. Say what it actually does.', added: 2 },
  { id: 'avoid-2', kind: 'li', text: 'Leverage. Use "use".', added: 2 },
  { id: 'avoid-3', kind: 'li', text: 'Unlock, unleash, supercharge.', added: 2 },
  { id: 'ba', kind: 'h2', text: 'Before and after', added: 5 },
  { id: 'ba-1', kind: 'li', text: 'Before: Unlock seamless collaboration across your workspace.', added: 5 },
  { id: 'ba-2', kind: 'li', text: 'After: Share a doc with your team in one click.', added: 5 },
]

const LATEST = VERSIONS.length
const STEP_MS = 1500

export function VersionDemo() {
  // Server render shows v1 so the history can play forward from the start once the doc is on screen.
  const [at, setAt] = useState(1)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const root = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      started.current = true
      setAt(LATEST)
      return
    }
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started.current) return
        started.current = true
        setPlaying(true)
        io.disconnect()
      },
      { threshold: 0.6 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!playing) return
    if (at >= LATEST) {
      setPlaying(false)
      return
    }
    timer.current = setTimeout(() => setAt((v) => v + 1), at === 1 ? 900 : STEP_MS)
    return () => clearTimeout(timer.current)
  }, [at, playing])

  const pick = (n: number) => {
    clearTimeout(timer.current)
    started.current = true
    setPlaying(false)
    setAt(n)
  }

  const current = VERSIONS[at - 1]
  const visible = BLOCKS.filter((b) => b.added <= at && !(b.removed && b.removed < at))

  return (
    <div ref={root} className="overflow-hidden rounded-lg border border-line-2 bg-sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-5 py-3">
        <span className="font-mono text-[13px] text-ink">/team/brand/voice.md</span>
        <span className="text-[13px] text-ink-3 tabular-nums" aria-live="polite">
          Showing version {at} of {LATEST}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* History rail. On small screens it sits above the doc as a row of versions. */}
        <nav aria-label="Version history" className="order-first border-b border-line lg:order-last lg:border-b-0 lg:border-l">
          <h3 className="hidden px-5 pt-4 pb-2 text-[13px] font-semibold text-ink-2 lg:block">History</h3>
          <ol className="flex overflow-x-auto lg:block lg:pb-3">
            {[...VERSIONS].reverse().map((v) => (
              <li key={v.n} className="shrink-0">
                <button
                  type="button"
                  onClick={() => pick(v.n)}
                  aria-current={v.n === at ? 'true' : undefined}
                  className={cn(
                    'relative block w-full px-5 py-2.5 text-left outline-offset-[-2px] transition-colors',
                    v.n === at ? 'bg-paper' : 'hover:bg-paper/60',
                    v.n > at && 'opacity-45',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0 bottom-0 left-0 w-[3px] transition-colors',
                      v.n === at ? 'bg-brand' : 'bg-transparent',
                    )}
                  />
                  <span className="flex items-baseline gap-2 text-[13px]">
                    <span className="font-semibold tabular-nums">v{v.n}</span>
                    <Byline v={v} />
                  </span>
                  <span className="mt-0.5 hidden text-[13px] leading-snug text-ink-2 lg:block">{v.message}</span>
                  <span className="mt-0.5 hidden text-[12px] text-ink-3 lg:block">{v.when}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 py-6 lg:py-8">
          <p className="mb-5 px-5 text-[13px] text-ink-2 sm:pl-[200px] lg:hidden">{current.message}</p>
          {visible.map((b, i) => {
            const prev = visible[i - 1]
            const showAuthor = !b.removed && (!prev || prev.added !== b.added || prev.removed)
            const author = VERSIONS[b.added - 1]
            const changed = b.added === at
            const deleted = b.removed === at
            return (
              <div key={b.id} className={cn('landing-block grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[200px_minmax(0,1fr)]', showAuthor && i > 0 && 'mt-3')}>
                <div className="px-5 pt-1.5 text-[12.5px] leading-tight sm:pr-4 sm:text-right">
                  {showAuthor && <Author v={author} />}
                </div>
                <div
                  className={cn(
                    'relative mr-5 border-l-2 py-1 pr-3 pl-4 ml-5 sm:ml-0 transition-colors duration-500',
                    changed
                      ? author.agent
                        ? 'border-agent bg-agent-wash/70'
                        : 'border-ink-3 bg-wash/80'
                      : deleted
                        ? 'border-danger/50 bg-danger-wash/50'
                        : 'border-transparent',
                  )}
                >
                  <DocBlock b={b} deleted={deleted} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Byline({ v }: { v: Version }) {
  if (!v.agent) return <span className="truncate text-ink">{v.person}</span>
  return (
    <span className="truncate">
      <span className="text-agent">{v.agent}</span>
      <span className="text-ink-3"> for </span>
      <span className="text-ink">{v.person.split(' ')[0]}</span>
    </span>
  )
}

function Author({ v }: { v: Version }) {
  return (
    <span className="inline-flex flex-col gap-0.5 sm:items-end">
      {v.agent ? (
        <>
          <span className="inline-flex items-center gap-1 font-medium text-agent">
            <Bot className="size-3.5" aria-hidden />
            {v.agent}
          </span>
          <span className="text-ink-3">for {v.person}, v{v.n}</span>
        </>
      ) : (
        <>
          <span className="font-medium text-ink">{v.person}</span>
          <span className="text-ink-3">v{v.n}</span>
        </>
      )}
    </span>
  )
}

function DocBlock({ b, deleted }: { b: Block; deleted: boolean }) {
  const strike = deleted && 'line-through decoration-danger/60 text-ink-3'
  switch (b.kind) {
    case 'h1':
      return <div className={cn('font-sans text-[26px] leading-tight font-[650] tracking-[-0.02em]', strike)}>{b.text}</div>
    case 'h2':
      return <div className={cn('pt-3 font-sans text-[17px] font-[650] tracking-[-0.01em]', strike)}>{b.text}</div>
    case 'li':
      return (
        <div className={cn('flex gap-3 font-serif text-[18px] leading-[1.6]', strike)}>
          <span aria-hidden className="text-ink-3">
            –
          </span>
          <span>{b.text}</span>
        </div>
      )
    default:
      return <p className={cn('font-serif text-[18px] leading-[1.65]', strike)}>{b.text}</p>
  }
}
