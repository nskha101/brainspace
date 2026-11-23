import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** The frame every homepage demo sits in: a sheet with the item's path across the top, like the app shows it. */
export function Pane({
  path,
  aside,
  children,
  className,
}: {
  path: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0 overflow-hidden rounded-lg border border-line-2 bg-sheet', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-5 py-3">
        <span className="font-mono text-[13px] break-all text-ink">{path}</span>
        {aside && <span className="text-[13px] text-ink-3 tabular-nums">{aside}</span>}
      </div>
      {children}
    </div>
  )
}
