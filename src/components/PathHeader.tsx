import { Link } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import type { AccessInfo } from '../server/services/access'
import { cn, readsSummary, spaceHref, timeAgo } from '../lib/utils'
import { namesList } from './AccessDialog'

/** The path of what's open, each part a link to its folder. */
export function PathCrumbs({ path, size = 'lg' }: { path: string; size?: 'lg' | 'sm' }) {
  const parts = path.split('/').filter(Boolean)
  return (
    <nav className={cn('flex min-w-0 flex-wrap items-baseline font-mono', size === 'lg' ? 'text-[22px] tracking-[-0.02em] sm:text-[26px]' : 'text-[13px]')} aria-label="Path">
      {parts.map((p, i) => {
        const href = '/' + parts.slice(0, i + 1).join('/')
        const last = i === parts.length - 1
        const isSpace = i === 0
        return (
          <span key={href} className="flex items-baseline">
            <span className="text-ink-3">/</span>
            {last ? (
              <span className={cn('font-medium text-ink', isSpace && (p === 'team' ? 'text-brand' : ''))}>{p}</span>
            ) : (
              <Link to={spaceHref(href) as never} className={cn('hover:text-ink hover:underline', isSpace ? (p === 'team' ? 'text-brand' : 'text-ink-2') : 'text-ink-2')}>
                {p}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}

/** "Only Nith and Farris can see this", shown under the path of anything restricted. */
export function AccessLine({ access, path, userId, onManage }: { access: AccessInfo | null; path: string; userId: string; onManage?: () => void }) {
  if (!access?.restricted) return null
  const inherited = access.inherited && access.restrictedAt !== path
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-brand-ink">
      <Lock className="size-3.5 shrink-0" />
      <span>
        Only {namesList(access.people, userId)} can see this
        {inherited && (
          <>
            {' '}
            <span className="text-ink-3">
              (set on{' '}
              <Link to={spaceHref(access.restrictedAt!) as never} className="font-mono hover:underline">
                {access.restrictedAt}
              </Link>
              )
            </span>
          </>
        )}
        .
      </span>
      {onManage && !inherited && (
        <button onClick={onManage} className="text-ink-2 underline-offset-2 hover:text-ink hover:underline">
          Change
        </button>
      )}
    </p>
  )
}

type Stats = { updatedAt: number; readCount: number; readerCount: number; readAt: number | null; flowReadCount: number }

/** "Edited 2h ago by Maya · 14 reads by 3 people, last 5m ago by Dev". */
export function NodeStats({
  node,
  people,
  edited = true,
  onReads,
}: {
  node: Stats
  people: { updatedBy: string | null; readBy: string | null }
  edited?: boolean
  /** Makes the read count a button, e.g. to open the list of who read it. */
  onReads?: () => void
}) {
  const flows = node.flowReadCount ? ` (+${node.flowReadCount.toLocaleString()} by flows)` : ''
  const reads = node.readAt ? (
    <>
      {readsSummary(node)}, last {timeAgo(node.readAt)}
      {people.readBy && ` by ${people.readBy}`}
      {flows}
    </>
  ) : (
    `Not read yet${flows}`
  )
  const tip = 'Each person counts once every 10 minutes, whether they open it here or an agent reads it for them.'
  return (
    <>
      {edited && (
        <>
          <span>
            Edited {timeAgo(node.updatedAt)}
            {people.updatedBy && ` by ${people.updatedBy}`}
          </span>
          <span aria-hidden>·</span>
        </>
      )}
      {onReads && (node.readAt || node.flowReadCount) ? (
        <button type="button" onClick={onReads} title={`${tip} Click to see who.`} className="underline-offset-2 hover:text-ink hover:underline">
          {reads}
        </button>
      ) : (
        <span title={tip}>{reads}</span>
      )}
    </>
  )
}
