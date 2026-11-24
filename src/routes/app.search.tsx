import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Loader2, Search as SearchIcon } from 'lucide-react'
import { searchFn } from '../lib/api'
import { Badge } from '../components/ui'
import { cn, spaceHref, timeAgo } from '../lib/utils'

type Space = 'all' | 'team' | 'me'
type S = { q?: string; space?: Space }
type Results = Awaited<ReturnType<typeof searchFn>>

// No route loader: a loader re-runs on every query change, and the router
// swaps the whole page for the skeleton while it waits. The page fetches its
// own results instead, so the input stays put and old results stay visible
// until new ones arrive.
export const Route = createFileRoute('/app/search')({
  validateSearch: (s: Record<string, unknown>): S => ({
    q: typeof s.q === 'string' ? s.q : undefined,
    space: s.space === 'team' || s.space === 'me' ? s.space : undefined,
  }),
  component: SearchPage,
})

// Recent results, so going back to a query or a space shows them at once.
// They refresh in the background either way.
const cache = new Map<string, Results>()
const CACHE_SIZE = 40

function remember(key: string, results: Results) {
  cache.delete(key)
  cache.set(key, results)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
}

type Shown = { key: string; query: string; results: Results | null; error: boolean }

function useSearchResults(query: string | undefined, space: Space) {
  const key = query ? `${space}\n${query}` : ''
  const [shown, setShown] = useState<Shown>(() => ({ key, query: query ?? '', results: cache.get(key) ?? null, error: false }))

  useEffect(() => {
    if (!query) {
      setShown({ key: '', query: '', results: null, error: false })
      return
    }
    const hit = cache.get(key)
    if (hit) setShown({ key, query, results: hit, error: false })
    let stale = false
    searchFn({ data: { query, space } })
      .then((results) => {
        remember(key, results)
        if (!stale) setShown({ key, query, results, error: false })
      })
      .catch(() => {
        if (!stale) setShown((s) => ({ key, query, results: s.results, error: true }))
      })
    return () => {
      stale = true
    }
  }, [key])

  return { ...shown, loading: !!query && shown.key !== key }
}

function highlight(snippet: string) {
  const parts = snippet.split(/\*\*(.+?)\*\*/g)
  return parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-brand-wash px-0.5 text-ink">{p}</mark> : p))
}

function SearchPage() {
  const search = Route.useSearch()
  const space = search.space ?? 'all'
  const navigate = useNavigate({ from: Route.fullPath })
  const [q, setQ] = useState(search.q ?? '')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== (search.q ?? '')) navigate({ search: (s: S) => ({ ...s, q: q || undefined }), replace: true })
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const { results, query: shownQuery, error, loading } = useSearchResults(search.q, space)
  const typing = q.trim() !== '' && q !== (search.q ?? '')
  const busy = loading || typing

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10">
      <div className="flex h-12 items-center gap-3 rounded-xl border border-line-2 bg-sheet px-4 focus-within:border-ink-3">
        {busy ? <Loader2 className="size-4 animate-spin text-ink-3" /> : <SearchIcon className="size-4 text-ink-3" />}
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by meaning or keyword, e.g. “how we price annual plans”"
          className="h-full flex-1 bg-transparent text-[15px] focus:outline-none"
        />
      </div>
      <div className="mt-3 flex gap-1.5 text-[13px]">
        {(['all', 'team', 'me'] as const).map((d) => (
          <button
            key={d}
            onClick={() => navigate({ search: (s: S) => ({ ...s, space: d === 'all' ? undefined : d }) })}
            className={cn('rounded-md px-2.5 py-1', space === d ? 'bg-ink text-white' : 'text-ink-2 hover:bg-wash')}
          >
            {d === 'all' ? 'Both spaces' : d === 'team' ? 'Team space' : 'Personal space'}
          </button>
        ))}
      </div>

      <div className={cn('mt-8 transition-opacity duration-150', loading && results && 'opacity-60')} aria-busy={loading}>
        {!search.q && !q ? (
          <p className="text-sm text-ink-3">Search covers docs, file names and descriptions in the spaces you can see.</p>
        ) : error && !loading ? (
          <p className="text-sm text-ink-2">Search didn't go through. Try again in a moment.</p>
        ) : !results ? (
          loading ? <ResultsSkeleton /> : null
        ) : !results.length ? (
          busy ? null : (
            <p className="text-sm text-ink-2">Nothing matched “{shownQuery}”. Try different words, or describe what the doc is about.</p>
          )
        ) : (
          <ul className="space-y-5">
            {results.map((r) => (
              <li key={r.id}>
                <Link to={spaceHref(r.path) as never} className="group block">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13.5px] font-medium text-ink group-hover:underline">{r.path}</span>
                    {r.matchedBy.includes('semantic') && !r.matchedBy.includes('keyword') && <Badge>related</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-3 text-[14px] leading-relaxed text-ink-2">{highlight(r.snippet)}</p>
                  <p className="mt-1 text-[12px] text-ink-3">
                    v{r.version}, updated {timeAgo(r.updatedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Shown only on the first search of a visit, before there are any results to keep on screen. */
function ResultsSkeleton() {
  return (
    <ul className="animate-pulse space-y-5" aria-label="Loading results">
      {[46, 62, 38].map((w, i) => (
        <li key={i}>
          <div className="h-3.5 rounded bg-wash" style={{ width: `${w}%` }} />
          <div className="mt-2.5 h-3 w-full rounded bg-wash" />
          <div className="mt-1.5 h-3 w-4/5 rounded bg-wash" />
          <div className="mt-2.5 h-2.5 w-28 rounded bg-wash" />
        </li>
      ))}
    </ul>
  )
}
