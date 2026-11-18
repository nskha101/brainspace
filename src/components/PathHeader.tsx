import { Link } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import type { AccessInfo } from '../server/services/access'
import { cn, spaceHref } from '../lib/utils'
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
