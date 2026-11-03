/** Shown while a page's data loads. Shaped like the app's pages: a title, a line of text, then rows. */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse px-6 py-10 lg:px-10" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-56 rounded-md bg-wash" />
      <div className="mt-3 h-4 w-96 max-w-full rounded bg-wash" />
      <div className="mt-10 overflow-hidden rounded-lg border border-line">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-0">
            <div className="size-4 shrink-0 rounded bg-wash" />
            <div className="h-3.5 rounded bg-wash" style={{ width: `${[38, 52, 30, 46, 58, 34][i]}%` }} />
            <div className="ml-auto h-3 w-16 rounded bg-wash" />
          </div>
        ))}
      </div>
    </div>
  )
}
