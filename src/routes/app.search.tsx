import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import { searchFn } from '../lib/api'
import { Badge } from '../components/ui'
import { cn, spaceHref, timeAgo } from '../lib/utils'

type S = { q?: string; space?: 'all' | 'team' | 'me' }

export const Route = createFileRoute('/app/search')({
  validateSearch: (s: Record<string, unknown>): S => ({
    q: typeof s.q === 'string' ? s.q : undefined,
    space: s.space === 'team' || s.space === 'me' ? s.space : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => (deps.q ? searchFn({ data: { query: deps.q, space: deps.space ?? 'all' } }) : Promise.resolve(null)),
  component: SearchPage,
})

function highlight(snippet: string) {
  const parts = snippet.split(/\*\*(.+?)\*\*/g)
  return parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-brand-wash px-0.5 text-ink">{p}</mark> : p))
}

function SearchPage() {
  const results = Route.useLoaderData()
  const search = Route.useSearch()
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

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10">
      <div className="flex h-12 items-center gap-3 rounded-xl border border-line-2 bg-sheet px-4 focus-within:border-ink-3">
        <SearchIcon className="size-4 text-ink-3" />
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
            className={cn('rounded-md px-2.5 py-1', (search.space ?? 'all') === d ? 'bg-ink text-white' : 'text-ink-2 hover:bg-wash')}
          >
            {d === 'all' ? 'Both spaces' : d === 'team' ? 'Team space' : 'Personal space'}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {!search.q ? (
          <p className="text-sm text-ink-3">Search covers docs, file names and descriptions in the spaces you can see.</p>
        ) : !results?.length ? (
          <p className="text-sm text-ink-2">Nothing matched “{search.q}”. Try different words, or describe what the doc is about.</p>
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
