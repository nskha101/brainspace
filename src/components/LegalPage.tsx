import { Link } from '@tanstack/react-router'
import { Wordmark } from './Logo'

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link to="/">
        <Wordmark />
      </Link>
      <h1 className="mt-12 text-[32px] font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="mt-2 text-sm text-ink-3">Last updated {updated}</p>
      <div className="mt-8 space-y-5 text-[16px] leading-relaxed text-ink-2 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_a]:text-brand-ink [&_a]:underline">
        {children}
      </div>
    </div>
  )
}
