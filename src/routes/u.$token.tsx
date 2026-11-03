import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Check, FolderUp, Upload } from 'lucide-react'
import { uploadLinkInfoFn } from '../lib/api'
import { Wordmark } from '../components/Logo'
import { Button } from '../components/ui'
import { collectFromDrop, collectFromInput, uploadItems, type UploadItem } from '../lib/upload'
import { bytes, cn } from '../lib/utils'

export const Route = createFileRoute('/u/$token')({
  head: () => ({ meta: [{ title: 'Upload files · Brainspace' }, { name: 'robots', content: 'noindex' }] }),
  loader: ({ params }) => uploadLinkInfoFn({ data: { token: params.token } }),
  component: UploadPage,
})

type Done = { name: string; size: number; ok: boolean; message?: string }

function UploadPage() {
  const info = Route.useLoaderData()
  const { token } = Route.useParams()
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [done, setDone] = useState<Done[]>([])
  const [remaining, setRemaining] = useState(info.valid ? info.remaining : 0)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  async function send(items: UploadItem[]) {
    if (!items.length) return
    const batch = items.slice(0, remaining)
    const skipped = items.length - batch.length
    setProgress({ done: 0, total: batch.length })
    const { failed } = await uploadItems('', batch, (n) => setProgress({ done: n, total: batch.length }), {
      endpoint: `/api/u/${token}`,
    })
    const failedSet = new Map(failed.map((f) => [f.path, f.message]))
    setDone((d) => [
      ...batch.map((i) => ({ name: i.relPath, size: i.file.size, ok: !failedSet.has(i.relPath), message: failedSet.get(i.relPath) })),
      ...(skipped ? [{ name: `${skipped} more file${skipped === 1 ? '' : 's'} not sent`, size: 0, ok: false, message: 'this link has no uploads left' }] : []),
      ...d,
    ])
    setRemaining((r) => Math.max(0, r - (batch.length - failed.length)))
    setProgress(null)
  }

  if (!info.valid) {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="w-full max-w-md">
          <Wordmark />
          <h1 className="mt-10 text-2xl font-semibold tracking-[-0.02em]">This link can't take uploads</h1>
          <p className="mt-2 text-ink-2">{info.reason} Ask whoever sent it for a new one.</p>
        </div>
      </div>
    )
  }

  const single = info.mode === 'file'
  const busy = !!progress
  return (
    <div className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-xl">
        <Wordmark />
        <h1 className="mt-10 text-[26px] font-semibold tracking-[-0.02em]">
          {info.requestedBy} asked you for {single ? 'a file' : 'files'}
        </h1>
        <p className="mt-2 text-[15px] text-ink-2">
          {single ? 'It' : 'They'} will go into <span className="font-mono text-[13.5px] text-ink">{info.target}</span> in the{' '}
          {info.workspaceName} workspace on Brainspace.
        </p>
        {info.note && (
          <p className="mt-4 rounded-lg border border-line bg-sheet px-4 py-3 text-[15px] text-ink">
            <span className="mr-1.5 text-ink-3">Note:</span>
            {info.note}
          </p>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={async (e) => {
            e.preventDefault()
            setDragging(false)
            if (busy || !remaining) return
            const { items } = await collectFromDrop(e.dataTransfer)
            send(single ? items.slice(0, 1) : items)
          }}
          className={cn(
            'mt-8 grid place-items-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors',
            dragging ? 'border-brand bg-brand-wash/50' : 'border-line-2 bg-sheet',
          )}
        >
          {remaining === 0 ? (
            <p className="text-ink-2">This link has no uploads left. Thanks!</p>
          ) : busy ? (
            <p className="font-medium">
              Uploading {progress.done} of {progress.total}…
            </p>
          ) : (
            <div>
              <p className="font-medium">Drop {single ? 'the file' : 'files or a folder'} here</p>
              <p className="mt-1 text-sm text-ink-3">Up to 95 MB each.</p>
              <div className="mt-5 flex justify-center gap-2">
                <Button variant="primary" onClick={() => fileInput.current?.click()}>
                  <Upload className="size-4" /> Choose {single ? 'a file' : 'files'}
                </Button>
                {!single && (
                  <Button onClick={() => folderInput.current?.click()}>
                    <FolderUp className="size-4" /> Choose a folder
                  </Button>
                )}
              </div>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple={!single}
            onChange={(e) => {
              if (e.target.files) send(collectFromInput(e.target.files))
              e.target.value = ''
            }}
          />
          <input
            ref={folderInput}
            type="file"
            hidden
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => {
              if (e.target.files) send(collectFromInput(e.target.files))
              e.target.value = ''
            }}
          />
        </div>

        {done.length > 0 && (
          <ul className="mt-6 divide-y divide-line rounded-lg border border-line">
            {done.map((d, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                {d.ok ? <Check className="size-4 text-agent" /> : <span className="size-4 text-center text-danger">!</span>}
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{d.name}</span>
                <span className={cn('shrink-0 text-[12.5px]', d.ok ? 'text-ink-3' : 'text-danger')}>
                  {d.ok ? bytes(d.size) : d.message}
                </span>
              </li>
            ))}
          </ul>
        )}
        {done.some((d) => d.ok) && (
          <p className="mt-4 text-sm text-ink-2">
            Done. {info.requestedBy} and their agent can see {done.filter((d) => d.ok).length === 1 ? 'it' : 'them'} now. You can close this page.
          </p>
        )}
        <p className="mt-10 text-xs text-ink-3">
          This link expires {new Date(info.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.
        </p>
      </div>
    </div>
  )
}
