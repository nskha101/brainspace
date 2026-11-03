import type { ComponentProps } from 'react'
import { cn } from '../lib/utils'

/** Table primitives in the shadcn/ui shape, styled with Brainspace tokens. */

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-line', className)} {...props} />
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn('group border-b border-line transition-colors hover:bg-paper data-[state=selected]:bg-brand-wash/40', className)}
      {...props}
    />
  )
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return <th className={cn('h-9 px-4 text-left align-middle text-[12.5px] font-medium text-ink-3', className)} {...props} />
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-4 py-2.5 align-middle', className)} {...props} />
}
