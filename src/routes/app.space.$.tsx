import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowUpFromLine,
  Copy,
  Loader2,
  Download,
  FilePlus,
  FileText,
  FolderInput,
  FolderPlus,
  History,
  MoreHorizontal,
  PenLine,
  Share2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  copyFn,
  describeFn,
  diffFn,
  extractTextFn,
  historyFn,
  mkdirFn,
  moveFn,
  promoteFn,
  resolvePathFn,
  restoreVersionFn,
  trashFn,
  writeFn,
} from '../lib/api'
import { DOC_CHANGED_EVENT, hasDirtyDoc, setDirtyDoc, type LiveChange } from '../lib/live'
import { FileTable, type BulkAction, type FileEntry, type RowAction } from '../components/FileTable'
import { MAX_UPLOAD_FILES, collectFromDrop, collectFromInput, uploadItems, type UploadItem } from '../lib/upload'
import { MarkdownEditor, PlainEditor, joinFrontmatter, splitFrontmatter } from '../components/Editor'
import { ConfirmDialog, PathDialog, TextDialog } from '../components/FileDialogs'
import { Avatar, Badge, Button, Empty, Menu, MenuItem, Modal, Textarea, ViaMark } from '../components/ui'
import { bytes, cn, spaceHref, errMessage, timeAgo } from '../lib/utils'

type Search = { v?: number }

export const Route = createFileRoute('/app/space/$')({
  validateSearch: (s: Record<string, unknown>): Search => (s.v ? { v: Number(s.v) } : {}),
  loaderDeps: ({ search }) => ({ v: search.v }),
  // Never refetch the open doc out from under unsaved edits (live updates, focus, etc).
  shouldReload: () => !hasDirtyDoc(),
  loader: async ({ params, deps }) => {
    const path = '/' + (params._splat ?? '').replace(/^\/+/, '')
    return resolvePathFn({ data: { path: path === '/' ? '/team' : path, version: deps.v } })
  },
  component: SpacePage,
  errorComponent: ({ error }) => (
    <div className="p-10">
      <Empty title="Couldn't open this">{(error as Error).message}</Empty>
    </div>
  ),
})

type Loaded = Awaited<ReturnType<typeof resolvePathFn>>
type FolderData = Extract<Loaded, { type: 'folder' }>
type FileData = Extract<Loaded, { type: 'file' }>
type Entry = FolderData['entries'][number]

function useRefresh() {
  const router = useRouter()
  return () => router.invalidate()
}

async function attempt<T>(fn: () => Promise<T>, ok?: string) {
  try {
    const r = await fn()
    if (ok) toast.success(ok)
    return r
  } catch (e) {
    toast.error(errMessage(e))
    throw e
  }
}

function PathCrumbs({ path, size = 'lg' }: { path: string; size?: 'lg' | 'sm' }) {
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

function SpacePage() {
  const data = Route.useLoaderData()
  if (data.type === 'folder') return <FolderView data={data} />
  if (data.type === 'missing') return <MissingView path={data.path} canWrite={data.role !== 'viewer'} />
  return <FileView key={`${data.file.id}:${data.file.version}`} data={data} />
}

function MissingView({ path, canWrite }: { path: string; canWrite: boolean }) {
  const refresh = useRefresh()
  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
      <PathCrumbs path={path} />
      <div className="mt-8">
        <Empty
          title="Nothing here yet"
          action={
            canWrite && (
              <Button
                variant="primary"
                onClick={() => attempt(() => writeFn({ data: { path, content: `# ${path.split('/').pop()?.replace(/\.md$/, '')}\n\n`, message: 'Created' } })).then(refresh)}
              >
                Create this doc
              </Button>
            )
          }
        >
          It may have been moved or deleted. Check Trash or search for it.
        </Empty>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Folder

function FolderView({ data }: { data: FolderData }) {
  const refresh = useRefresh()
  const navigate = useNavigate()
  const folderPath = data.folder.path
  const canWrite = data.role !== 'viewer'
  const isTeam = folderPath.startsWith('/team')
  const canDeleteHere = isTeam ? data.role === 'admin' : canWrite
  const [dialog, setDialog] = useState<null | { kind: 'doc' | 'folder' | 'rename' | 'move' | 'copy' | 'promote' | 'delete' | 'describe'; entry?: Entry }>(null)
  const [dragging, setDragging] = useState(false)
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(null)
  const [bulk, setBulk] = useState<{ kind: BulkAction; entries: FileEntry[] } | null>(null)
  const entriesById = useMemo(() => new Map(data.entries.map((x) => [x.id, x])), [data.entries])
  const onRowAction = useCallback(
    (kind: RowAction, entry: FileEntry) => setDialog({ kind, entry: entriesById.get(entry.id) }),
    [entriesById],
  )

  async function runBulk(label: string, fn: (e: FileEntry) => Promise<unknown>) {
    const list = bulk?.entries ?? []
    const failed: string[] = []
    for (const e of list) {
      try {
        await fn(e)
      } catch (err) {
        failed.push(`${e.name}: ${errMessage(err)}`)
      }
    }
    const ok = list.length - failed.length
    if (ok) toast.success(`${label} ${ok} item${ok === 1 ? '' : 's'}`)
    if (failed.length) toast.error(failed.slice(0, 3).join(' · ') + (failed.length > 3 ? '…' : ''))
    setBulk(null)
    refresh()
  }
  const asFolder = (p: string) => (p.endsWith('/') ? p : `${p}/`)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  async function runUpload(items: UploadItem[], emptyDirs: string[] = []) {
    if (!items.length && !emptyDirs.length) return
    if (items.length > MAX_UPLOAD_FILES) {
      toast.error(`That's ${items.length} files. Upload at most ${MAX_UPLOAD_FILES} at a time.`)
      return
    }
    setUpload({ done: 0, total: items.length })
    for (const dir of emptyDirs) await mkdirFn({ data: { path: `${folderPath}/${dir}` } }).catch(() => {})
    const { failed } = await uploadItems(folderPath, items, (done) => setUpload({ done, total: items.length }))
    setUpload(null)
    const ok = items.length - failed.length
    const folders = new Set(items.filter((i) => i.relPath.includes('/')).map((i) => i.relPath.split('/')[0]))
    if (ok) {
      toast.success(
        folders.size === 1 && items.every((i) => i.relPath.includes('/'))
          ? `Uploaded ${[...folders][0]} (${ok} file${ok === 1 ? '' : 's'})`
          : `Uploaded ${ok} file${ok === 1 ? '' : 's'}`,
      )
    }
    if (failed.length) {
      toast.error(`${failed.length} failed: ${failed.slice(0, 3).map((f) => `${f.path} (${f.message})`).join(', ')}${failed.length > 3 ? '…' : ''}`)
    }
    refresh()
  }

  const e = dialog?.entry
  return (
    <div
      className="mx-auto max-w-5xl px-6 py-8 lg:px-10"
      onDragOver={(ev) => {
        if (!canWrite) return
        ev.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (ev) => {
        ev.preventDefault()
        setDragging(false)
        if (!canWrite) return
        const { items, emptyDirs } = await collectFromDrop(ev.dataTransfer)
        runUpload(items, emptyDirs)
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <PathCrumbs path={folderPath} />
          <p className="mt-1.5 text-sm text-ink-2">
            {folderPath === '/team'
              ? 'Shared with everyone in the workspace.'
              : folderPath === '/me'
                ? 'Your personal space. Only you and your agents can see it.'
                : `${data.entries.length} item${data.entries.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setDialog({ kind: 'folder' })}>
              <FolderPlus className="size-3.5" /> Folder
            </Button>
            <Menu
              trigger={
                <Button size="sm" loading={!!upload}>
                  <Upload className="size-3.5" /> {upload ? `Uploading ${upload.done} of ${upload.total}` : 'Upload'}
                </Button>
              }
            >
              <MenuItem icon={<FilePlus />} onClick={() => fileInput.current?.click()}>
                Files
              </MenuItem>
              <MenuItem icon={<FolderInput />} onClick={() => folderInput.current?.click()}>
                Folder
              </MenuItem>
            </Menu>
            <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'doc' })}>
              <FilePlus className="size-3.5" /> New doc
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(ev) => {
                if (ev.target.files) runUpload(collectFromInput(ev.target.files))
                ev.target.value = ''
              }}
            />
            <input
              ref={folderInput}
              type="file"
              hidden
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(ev) => {
                if (ev.target.files) runUpload(collectFromInput(ev.target.files))
                ev.target.value = ''
              }}
            />
          </div>
        )}
      </div>

      <div className={cn('mt-6 rounded-lg transition-shadow', dragging && 'ring-2 ring-brand ring-offset-4 ring-offset-sheet')}>
        <FileTable
          entries={data.entries}
          canWrite={canWrite}
          canDelete={canDeleteHere}
          onAction={onRowAction}
          onBulk={(kind, entries) => setBulk({ kind, entries })}
          empty={
            <div className="rounded-lg border border-line px-6 py-14 text-center">
              <p className="font-medium">This folder is empty</p>
              <p className="mt-1 text-sm text-ink-2">
                {canWrite ? 'Create a doc, or drop files or whole folders here. Or ask your agent to fill it in.' : 'Nothing has been added yet.'}
              </p>
            </div>
          }
        />
      </div>
      {dragging && <p className="mt-2 text-center text-sm text-brand-ink">Drop files or folders to upload into {folderPath}</p>}

      <PathDialog
        open={dialog?.kind === 'doc'}
        onClose={() => setDialog(null)}
        title="New doc"
        label="Name"
        initial="untitled.md"
        confirm="Create doc"
        hint={`Created in ${folderPath}. Paths without an extension become markdown.`}
        onSubmit={async (name) => {
          const path = `${folderPath}/${name}`
          const title = name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]/g, ' ')
          await attempt(() => writeFn({ data: { path, content: /\.(md|markdown)$/i.test(name) || !name.includes('.') ? `# ${title[0]?.toUpperCase()}${title.slice(1)}\n\n` : '', message: 'Created', createOnly: true } }))
          await refresh()
          navigate({ to: spaceHref(path) as never })
        }}
      />
      <PathDialog
        open={dialog?.kind === 'folder'}
        onClose={() => setDialog(null)}
        title="New folder"
        label="Name"
        initial=""
        confirm="Create folder"
        onSubmit={async (name) => {
          await attempt(() => mkdirFn({ data: { path: `${folderPath}/${name}` } }))
          refresh()
        }}
      />
      {bulk && (
        <>
          <PathDialog
            open={bulk.kind === 'move'}
            onClose={() => setBulk(null)}
            title={`Move ${bulk.entries.length} items`}
            label="Destination folder"
            initial={`${folderPath}/`}
            confirm="Move"
            hint="Start with /team/ or /me/. Missing folders are created."
            onSubmit={(to) => runBulk('Moved', (x) => moveFn({ data: { from: x.path, to: asFolder(to) } }))}
          />
          <PathDialog
            open={bulk.kind === 'copy'}
            onClose={() => setBulk(null)}
            title={`Copy ${bulk.entries.length} items`}
            label="Copy into folder"
            initial={isTeam ? '/me/' : `${folderPath}/`}
            confirm="Copy"
            onSubmit={(to) => runBulk('Copied', (x) => copyFn({ data: { from: x.path, to: asFolder(to) } }))}
          />
          <PathDialog
            open={bulk.kind === 'promote'}
            onClose={() => setBulk(null)}
            title={`Promote ${bulk.entries.length} items to the team space`}
            label="Team folder"
            initial={asFolder(folderPath.replace(/^\/me/, '/team'))}
            confirm="Promote"
            hint="Everyone in the workspace will see them. Docs that already exist there get a new version."
            onSubmit={(to) => runBulk('Promoted', (x) => promoteFn({ data: { path: x.path, to: asFolder(to) + x.name } }))}
          />
          <ConfirmDialog
            open={bulk.kind === 'delete'}
            onClose={() => setBulk(null)}
            title={`Delete ${bulk.entries.length} items?`}
            confirm="Move to trash"
            danger
            onConfirm={() => runBulk('Deleted', (x) => trashFn({ data: { path: x.path } }))}
          >
            They go to the trash with their version history. You can restore them from Trash.
          </ConfirmDialog>
        </>
      )}
      {e && (
        <>
          <PathDialog
            open={dialog?.kind === 'rename'}
            onClose={() => setDialog(null)}
            title={`Rename ${e.name}`}
            label="New name"
            initial={e.name}
            confirm="Rename"
            onSubmit={async (name) => {
              await attempt(() => moveFn({ data: { from: e.path, to: `${folderPath}/${name}` } }), 'Renamed')
              refresh()
            }}
          />
          <PathDialog
            open={dialog?.kind === 'move'}
            onClose={() => setDialog(null)}
            title={`Move ${e.name}`}
            label="Destination path"
            initial={e.path}
            confirm="Move"
            hint="Start with /team/ or /me/. End with / to move into a folder."
            onSubmit={async (to) => {
              await attempt(() => moveFn({ data: { from: e.path, to } }), 'Moved')
              refresh()
            }}
          />
          <PathDialog
            open={dialog?.kind === 'copy'}
            onClose={() => setDialog(null)}
            title={`Copy ${e.name}`}
            label="Copy to"
            initial={e.path.startsWith('/team') ? e.path.replace(/^\/team/, '/me') : e.path.replace(/(\.[a-z0-9]+)?$/i, ' copy$1')}
            confirm="Copy"
            onSubmit={async (to) => {
              await attempt(() => copyFn({ data: { from: e.path, to } }), 'Copied')
              refresh()
            }}
          />
          <PathDialog
            open={dialog?.kind === 'promote'}
            onClose={() => setDialog(null)}
            title="Promote to the team space"
            label="Team path"
            initial={e.path.replace(/^\/me/, '/team')}
            confirm="Promote"
            hint="Everyone in the workspace will see it. If a doc already exists at this path, yours becomes its next version and the current one stays in its history."
            onSubmit={async (to) => {
              const r = await attempt(() => promoteFn({ data: { path: e.path, to } }))
              toast.success(r.updated.length ? `Promoted. ${r.updated.map((u) => `${u.path} is now v${u.version}`).join(', ')}` : 'Promoted to the team space')
              await refresh()
              if (r.node) navigate({ to: spaceHref(r.node.path) as never })
            }}
          />
          <TextDialog
            open={dialog?.kind === 'describe'}
            onClose={() => setDialog(null)}
            title={`Describe ${e.name}`}
            initial={e.description ?? ''}
            placeholder="What it is and when to use it. Agents read this."
            confirm="Save"
            onSubmit={async (d) => {
              await attempt(() => describeFn({ data: { path: e.path, description: d } }))
              refresh()
            }}
          />
          <ConfirmDialog
            open={dialog?.kind === 'delete'}
            onClose={() => setDialog(null)}
            title={`Delete ${e.name}?`}
            confirm="Move to trash"
            danger
            onConfirm={async () => {
              await attempt(() => trashFn({ data: { path: e.path } }), 'Moved to trash')
              refresh()
            }}
          >
            {e.kind === 'folder' ? 'The folder and everything in it go to the trash.' : 'It goes to the trash.'} You can restore it from Trash.
          </ConfirmDialog>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// File

function FileView({ data }: { data: FileData }) {
  const f = data.file
  const refresh = useRefresh()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const historical = 'currentVersion' in f && f.currentVersion !== f.version
  const canWrite = data.role !== 'viewer' && !historical
  const isTeam = f.path.startsWith('/team')
  const canDelete = isTeam ? data.role === 'admin' : data.role !== 'viewer'
  const [showHistory, setShowHistory] = useState(false)
  const [dialog, setDialog] = useState<null | 'rename' | 'move' | 'copy' | 'promote' | 'delete' | 'describe'>(null)
  const parent = f.path.slice(0, f.path.lastIndexOf('/'))

  return (
    <div className="flex min-h-full">
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-4xl px-6 pt-8 lg:px-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <PathCrumbs path={f.path} />
              {f.description && <p className="mt-1.5 text-sm text-ink-2">{f.description}</p>}
            </div>
            <div className="flex items-center gap-1.5">
              {f.space === 'me' && canWrite && (
                <Button size="sm" onClick={() => setDialog('promote')}>
                  <Share2 className="size-3.5" /> Promote
                </Button>
              )}
              <Button size="sm" variant={showHistory ? 'primary' : 'secondary'} onClick={() => setShowHistory((s) => !s)}>
                <History className="size-3.5" /> v{f.version}
              </Button>
              <Menu
                trigger={
                  <Button size="sm" variant="ghost" aria-label="More actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                }
              >
                <MenuItem icon={<Download />} onClick={() => window.open(`/api/files/${f.id}?download${historical ? `&v=${f.version}` : ''}`)}>
                  Download
                </MenuItem>
                {data.role !== 'viewer' && (
                  <>
                    <MenuItem icon={<PenLine />} onClick={() => setDialog('rename')}>
                      Rename
                    </MenuItem>
                    <MenuItem icon={<FolderInput />} onClick={() => setDialog('move')}>
                      Move
                    </MenuItem>
                    <MenuItem icon={<Copy />} onClick={() => setDialog('copy')}>
                      Copy
                    </MenuItem>
                    <MenuItem icon={<FileText />} onClick={() => setDialog('describe')}>
                      Describe
                    </MenuItem>
                    <div className="my-1 h-px bg-line" />
                    <MenuItem icon={<Trash2 />} danger disabled={!canDelete} onClick={() => setDialog('delete')}>
                      {canDelete ? 'Delete' : 'Delete (admins only)'}
                    </MenuItem>
                  </>
                )}
              </Menu>
            </div>
          </div>
          {historical && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-paper px-4 py-2.5 text-sm">
              <span>
                You're viewing version {f.version}. The current version is {(f as { currentVersion: number }).currentVersion}.
              </span>
              <span className="flex gap-2">
                <Button size="sm" onClick={() => navigate({ to: '.', search: {} as never })}>
                  Back to current
                </Button>
                {data.role !== 'viewer' && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      await attempt(() => restoreVersionFn({ data: { path: f.path, version: f.version } }), `Restored version ${f.version}`)
                      await navigate({ to: '.', search: {} as never })
                      refresh()
                    }}
                  >
                    Restore this version
                  </Button>
                )}
              </span>
            </div>
          )}
        </div>
        <div className="mx-auto max-w-4xl px-6 lg:px-10">
          {f.kind === 'doc' && 'content' in f ? (
            <DocBody key={search.v ?? 'current'} file={f as DocFile} canWrite={canWrite} onSaved={refresh} />
          ) : (
            <BinaryBody file={f} canWrite={canWrite} onSaved={refresh} />
          )}
        </div>
      </div>
      {showHistory && <HistoryPanel path={f.path} viewing={f.version} onClose={() => setShowHistory(false)} />}

      <PathDialog
        open={dialog === 'rename'}
        onClose={() => setDialog(null)}
        title={`Rename ${f.name}`}
        label="New name"
        initial={f.name}
        confirm="Rename"
        onSubmit={async (name) => {
          const r = await attempt(() => moveFn({ data: { from: f.path, to: `${parent}/${name}` } }), 'Renamed')
          await refresh()
          navigate({ to: spaceHref(r.node.path) as never })
        }}
      />
      <PathDialog
        open={dialog === 'move'}
        onClose={() => setDialog(null)}
        title={`Move ${f.name}`}
        label="Destination path"
        initial={f.path}
        confirm="Move"
        hint="Start with /team/ or /me/. End with / to move into a folder."
        onSubmit={async (to) => {
          const r = await attempt(() => moveFn({ data: { from: f.path, to } }), 'Moved')
          await refresh()
          navigate({ to: spaceHref(r.node.path) as never })
        }}
      />
      <PathDialog
        open={dialog === 'copy'}
        onClose={() => setDialog(null)}
        title={`Copy ${f.name}`}
        label="Copy to"
        initial={isTeam ? f.path.replace(/^\/team/, '/me') : f.path.replace(/(\.[a-z0-9]+)?$/i, ' copy$1')}
        confirm="Copy"
        hint={isTeam ? 'Copying a team doc into /me gives you a private draft.' : undefined}
        onSubmit={async (to) => {
          const r = await attempt(() => copyFn({ data: { from: f.path, to } }), 'Copied')
          await refresh()
          if (r.node) navigate({ to: spaceHref(r.node.path) as never })
        }}
      />
      <PathDialog
        open={dialog === 'promote'}
        onClose={() => setDialog(null)}
        title="Promote to the team space"
        label="Team path"
        initial={f.path.replace(/^\/me/, '/team')}
        confirm="Promote"
        hint="Everyone in the workspace will see it. If a doc already exists at this path, yours becomes its next version and the current one stays in its history."
        onSubmit={async (to) => {
          const r = await attempt(() => promoteFn({ data: { path: f.path, to } }))
          toast.success(r.updated.length ? `Promoted. ${r.updated.map((u) => `${u.path} is now v${u.version}`).join(', ')}` : 'Promoted to the team space')
          await refresh()
          if (r.node) navigate({ to: spaceHref(r.node.path) as never })
        }}
      />
      <TextDialog
        open={dialog === 'describe'}
        onClose={() => setDialog(null)}
        title={`Describe ${f.name}`}
        initial={f.description ?? ''}
        placeholder="What it is and when to use it. Agents read this."
        confirm="Save"
        onSubmit={async (d) => {
          await attempt(() => describeFn({ data: { path: f.path, description: d } }))
          refresh()
        }}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={`Delete ${f.name}?`}
        confirm="Move to trash"
        danger
        onConfirm={async () => {
          await attempt(() => trashFn({ data: { path: f.path } }), 'Moved to trash')
          await navigate({ to: spaceHref(parent) as never })
          refresh()
        }}
      >
        It goes to the trash with its version history. You can restore it from Trash.
      </ConfirmDialog>
    </div>
  )
}

type DocFile = FileData['file'] & { content: string; version: number }

function DocBody({ file, canWrite, onSaved }: { file: DocFile; canWrite: boolean; onSaved: () => void }) {
  const isMarkdown = (file.mimeType ?? 'text/markdown') === 'text/markdown'
  const initial = useMemo(() => splitFrontmatter(file.content ?? ''), [file.content])
  const [frontmatter, setFrontmatter] = useState(initial.frontmatter)
  const [body, setBody] = useState(isMarkdown ? initial.body : file.content)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [conflict, setConflict] = useState(false)
  const [newer, setNewer] = useState<LiveChange | null>(null)

  // Live updates refresh pages on every change. While this doc has unsaved
  // edits it's left alone, and we say that a newer version exists instead.
  useEffect(() => {
    setDirtyDoc(dirty ? file.path : null)
    return () => setDirtyDoc(null)
  }, [dirty, file.path])
  useEffect(() => {
    const onChanged = (e: Event) => setNewer((e as CustomEvent<LiveChange>).detail)
    window.addEventListener(DOC_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(DOC_CHANGED_EVENT, onChanged)
  }, [])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const fullContent = () => (isMarkdown ? joinFrontmatter(frontmatter, body) : body)

  async function save() {
    if (!dirty || saving) return
    setSaving(true)
    try {
      await writeFn({ data: { path: file.path, content: fullContent(), baseVersion: file.version, message: message || undefined } })
      setDirty(false)
      setMessage('')
      toast.success('Saved')
      onSaved()
    } catch (e) {
      const msg = errMessage(e)
      if (/version/i.test(msg) && /not \d/.test(msg)) setConflict(true)
      else toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {newer && dirty && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-agent/30 bg-agent-wash px-4 py-2.5 text-sm text-ink">
          <span>
            {newer.actorName}
            {newer.via === 'mcp' ? ` (via ${newer.client ?? 'an agent'})` : ''} just {newer.action === 'delete' ? 'deleted' : 'saved a newer version of'} this doc.
            Your unsaved changes are still here.
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(fullContent())
                toast.success('Your version is on the clipboard')
              }}
            >
              Copy my version
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setNewer(null)
                setDirty(false)
                onSaved()
              }}
            >
              Load latest
            </Button>
          </span>
        </div>
      )}
      {frontmatter !== null && (
        <div className="mt-6 rounded-lg border border-line bg-paper/60">
          <div className="border-b border-line px-3 py-1.5 text-[12px] text-ink-3">Frontmatter</div>
          <Textarea
            value={frontmatter}
            readOnly={!canWrite}
            spellCheck={false}
            rows={Math.min(8, frontmatter.split('\n').length)}
            onChange={(e) => {
              setFrontmatter(e.target.value)
              setDirty(true)
            }}
            className="rounded-none border-0 bg-transparent font-mono text-[12.5px] focus:ring-0"
          />
        </div>
      )}
      {isMarkdown ? (
        <MarkdownEditor
          markdown={initial.body}
          editable={canWrite}
          onChange={(md) => {
            setBody(md)
            setDirty(true)
          }}
          onSave={save}
        />
      ) : (
        <PlainEditor
          value={body}
          editable={canWrite}
          onChange={(v) => {
            setBody(v)
            setDirty(true)
          }}
          onSave={save}
        />
      )}
      {dirty && canWrite && (
        <div className="sticky bottom-4 z-20 mx-auto mb-4 flex max-w-xl items-center gap-2 rounded-xl border border-line bg-sheet p-2 shadow-[0_16px_40px_-12px_rgba(26,24,32,0.35)]">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="Describe your change (optional)"
            className="h-8 min-w-0 flex-1 bg-transparent px-2 text-sm focus:outline-none"
          />
          <Button size="sm" variant="primary" onClick={save} loading={saving}>
            Save v{file.version + 1}
          </Button>
        </div>
      )}
      <Modal
        open={conflict}
        onClose={() => setConflict(false)}
        title="Someone else changed this doc"
        footer={
          <>
            <Button
              onClick={async () => {
                await navigator.clipboard.writeText(fullContent())
                toast.success('Your version is on the clipboard')
              }}
            >
              Copy my version
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConflict(false)
                setDirty(false)
                onSaved()
              }}
            >
              Load latest
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          A newer version was saved while you were editing, possibly by an agent. Copy your version, load the latest, then
          paste in what you need.
        </p>
      </Modal>
    </div>
  )
}

type ExtractedText = {
  status: 'pending' | 'done' | 'failed'
  error?: string | null
  content?: string
  pages?: number | null
  chars?: number
  range?: { offset: number; limit: number; totalLines: number }
}

function ExtractedTextSection({ path, text, canWrite, onChanged }: { path: string; text: ExtractedText; canWrite: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  async function retry() {
    setBusy(true)
    try {
      await extractTextFn({ data: { path } })
      onChanged()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Text</h2>
        {text.status === 'done' && text.content && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await navigator.clipboard.writeText(text.content!)
              toast.success('Text copied')
            }}
          >
            <Copy className="size-3.5" /> Copy text
          </Button>
        )}
      </div>
      {text.status === 'pending' && (
        <p className="mt-2 flex items-center gap-2 text-sm text-ink-2">
          <Loader2 className="size-3.5 animate-spin" /> Extracting the text with Context.dev. Agents can read and search it once
          it's done.
        </p>
      )}
      {text.status === 'failed' && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-danger-wash px-4 py-3 text-sm text-danger">
          <span className="min-w-0 flex-1">{text.error ?? 'Text extraction failed.'}</span>
          {canWrite && (
            <Button size="sm" onClick={retry} loading={busy}>
              Try again
            </Button>
          )}
        </div>
      )}
      {text.status === 'done' && (
        <>
          <p className="mt-1 text-[13px] text-ink-3">
            Extracted by Context.dev{text.pages ? `, ${text.pages} page${text.pages === 1 ? '' : 's'}` : ''}
            {text.chars ? `, ${text.chars.toLocaleString()} characters` : ''}. Agents read and search this text.
          </p>
          <pre className="mt-3 max-h-[60vh] overflow-auto rounded-lg border border-line bg-paper/60 p-4 font-serif text-[15px] leading-relaxed whitespace-pre-wrap text-ink">
            {/* Page markers are for agents; show people a plain page label. */}
            {text.content?.replace(/<!-- page (\d+) -->/g, 'Page $1')}
          </pre>
          {text.range && text.range.totalLines > text.range.limit && (
            <p className="mt-2 text-[13px] text-ink-3">
              Showing the first {text.range.limit.toLocaleString()} of {text.range.totalLines.toLocaleString()} lines. Agents get
              all of it.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function BinaryBody({ file, canWrite, onSaved }: { file: FileData['file']; canWrite: boolean; onSaved: () => void }) {
  const historical = 'currentVersion' in file && file.currentVersion !== file.version
  const src = `/api/files/${file.id}${historical ? `?v=${file.version}` : ''}`
  const mime = file.mimeType ?? ''
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function replace(f: File) {
    setBusy(true)
    const fd = new FormData()
    fd.set('file', f)
    fd.set('path', file.path)
    fd.set('message', `Replaced with ${f.name}`)
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    setBusy(false)
    if (!res.ok) toast.error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'Upload failed')
    else {
      toast.success('New version uploaded')
      onSaved()
    }
  }

  return (
    <div className="mt-8 pb-16">
      <div className="grid min-h-72 place-items-center rounded-lg border border-line bg-[repeating-conic-gradient(#f2f0f5_0_25%,#fff_0_50%)] bg-[length:20px_20px] p-6">
        {mime.startsWith('image/') ? (
          <img src={src} alt={file.description ?? file.name} className="max-h-[60vh] max-w-full object-contain" />
        ) : mime === 'application/pdf' ? (
          <iframe src={src} title={file.name} className="h-[70vh] w-full rounded bg-white" />
        ) : mime.startsWith('video/') ? (
          <video src={src} controls className="max-h-[60vh] max-w-full" />
        ) : (
          <div className="text-center">
            <p className="font-medium">{file.name}</p>
            <p className="mt-1 text-sm text-ink-2">No preview for {mime || 'this file type'}.</p>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-2">
        <span>
          {mime} · {bytes(file.size)} · updated {timeAgo(file.updatedAt)}
        </span>
        <span className="flex gap-2">
          <Button size="sm" onClick={() => window.open(`${src}${src.includes('?') ? '&' : '?'}download`)}>
            <Download className="size-3.5" /> Download
          </Button>
          {canWrite && (
            <>
              <Button size="sm" onClick={() => input.current?.click()} loading={busy}>
                <ArrowUpFromLine className="size-3.5" /> Upload new version
              </Button>
              <input ref={input} type="file" hidden onChange={(e) => e.target.files?.[0] && replace(e.target.files[0])} />
            </>
          )}
        </span>
      </div>
      {'text' in file && file.text && <ExtractedTextSection path={file.path} text={file.text as ExtractedText} canWrite={canWrite} onChanged={onSaved} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// History

type HistoryData = Awaited<ReturnType<typeof historyFn>>

function HistoryPanel({ path, viewing, onClose }: { path: string; viewing: number; onClose: () => void }) {
  const [data, setData] = useState<HistoryData | null>(null)
  const [diff, setDiff] = useState<{ from: number; to: number; patch: string } | null>(null)
  const navigate = useNavigate()
  useEffect(() => {
    historyFn({ data: { path } }).then(setData).catch((e) => toast.error(errMessage(e)))
  }, [path, viewing])

  async function showDiff(from: number, to: number) {
    const r = await attempt(() => diffFn({ data: { path, from, to } }))
    setDiff({ from, to, patch: r.patch })
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-80 shrink-0 overflow-y-auto border-l border-line bg-paper md:block">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Version history</h2>
        <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-wash hover:text-ink" aria-label="Close history">
          <X className="size-4" />
        </button>
      </div>
      {!data ? (
        <p className="p-4 text-sm text-ink-3">Loading…</p>
      ) : (
        <ol className="p-2">
          {data.versions.map((v) => (
            <li key={v.version} className={cn('rounded-lg px-3 py-2.5', v.version === viewing ? 'bg-sheet shadow-[0_0_0_1px_var(--color-line)]' : 'hover:bg-wash')}>
              <button
                className="w-full text-left"
                onClick={() => navigate({ to: '.', search: (v.current ? {} : { v: v.version }) as never })}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] text-ink-3">v{v.version}</span>
                  {v.current && <Badge tone="brand">current</Badge>}
                  <ViaMark via={v.via} client={v.clientName} />
                  <span className="ml-auto text-[12px] text-ink-3">{timeAgo(v.createdAt)}</span>
                </div>
                <div className="mt-1 text-[13.5px] leading-snug text-ink">{v.message || <span className="text-ink-3">No message</span>}</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-2">
                  <Avatar name={v.authorName} image={v.authorImage} size={16} />
                  {v.authorName ?? v.authorEmail}
                </div>
              </button>
              {v.version > 1 && (
                <button className="mt-1.5 text-[12px] text-brand-ink hover:underline" onClick={() => showDiff(v.version - 1, v.version)}>
                  What changed
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      <Modal open={!!diff} onClose={() => setDiff(null)} title={diff ? `Changes in v${diff.to}` : ''} width={820}>
        {diff && <DiffView patch={diff.patch} />}
      </Modal>
    </aside>
  )
}

function DiffView({ patch }: { patch: string }) {
  const lines = patch.split('\n').slice(4)
  if (!lines.some((l) => l.startsWith('+') || l.startsWith('-'))) return <p className="text-sm text-ink-2">No text changes.</p>
  return (
    <pre className="max-h-[65vh] overflow-auto rounded-md border border-line font-mono text-[12.5px] leading-relaxed">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn('px-3 whitespace-pre-wrap', l.startsWith('+') && 'diff-line-add', l.startsWith('-') && 'diff-line-del', l.startsWith('@@') && 'bg-wash text-ink-3')}
        >
          {l || ' '}
        </div>
      ))}
    </pre>
  )
}
