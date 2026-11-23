import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Code2, ExternalLink, Maximize2, Minimize2, RotateCw, TriangleAlert, X } from 'lucide-react'
import { artifactCallFn } from '../lib/api'
import { ARTIFACT_SANDBOX, buildArtifactDocument } from '../lib/artifact-frame'
import { LIVE_CHANGE_EVENT, type LiveChangeDetail } from '../lib/live'
import { Button } from './ui'
import { cn, errMessage, spaceHref } from '../lib/utils'

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024

/** A path a page gave, as a full Brainspace path: "/team/x" stays, "data.db" and "../x" are relative to the artifact's folder. */
function spacePath(artifactPath: string, target: string) {
  const clean = target.split(/[?#]/)[0] ?? ''
  if (/^\/(team|me)(\/|$)/.test(clean)) return clean
  if (clean.startsWith('/')) throw new Error(`"${target}" isn't a Brainspace path. Start with /team/ or /me/, or use a path relative to the artifact.`)
  const parts = artifactPath.split('/').filter(Boolean).slice(0, -1)
  for (const seg of clean.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (parts.length > 1) parts.pop()
    } else parts.push(seg)
  }
  return '/' + parts.join('/')
}

type Msg = { __brain?: number; id?: number; method?: string; args?: Record<string, unknown>; type?: string; message?: string }

/**
 * Runs an artifact (an .html doc) as a live page. The page sits in a sandboxed
 * frame with no origin and no network (see lib/artifact-frame), and asks for
 * data by posting messages here. Each one becomes a server call as the person
 * looking at the page.
 */
export function ArtifactView({
  path,
  name,
  version,
  html,
  userName,
  showingCode,
  onToggleCode,
  toolbar,
}: {
  path: string
  name: string
  version: number
  html: string
  userName: string
  showingCode: boolean
  onToggleCode: () => void
  /** An element in the page's own bar where the reload, code and full screen buttons go. */
  toolbar: HTMLElement | null
}) {
  const navigate = useNavigate()
  const frame = useRef<HTMLIFrameElement>(null)
  // Bumping this remounts the frame, which reloads the page from scratch.
  const [epoch, setEpoch] = useState(0)
  const [full, setFull] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [outLink, setOutLink] = useState<string | null>(null)
  // The frame only exists in the browser, and only once the listener below is
  // up. A server-rendered frame would run its script before anything is listening.
  const [listening, setListening] = useState(false)
  const loads = useRef(0)
  const resets = useRef<number[]>([])
  // Paths the page has used, so it only hears about changes that concern it.
  const used = useRef(new Set<string>())

  const doc = useMemo(
    () => buildArtifactDocument(html, { user: { name: userName }, artifact: { path, name, version } }),
    [html, userName, path, name, version],
  )

  useEffect(() => {
    loads.current = 0
    used.current = new Set()
    setPageError(null)
    setOutLink(null)
  }, [epoch, doc])

  useEffect(() => {
    async function handle(method: string, args: Record<string, unknown>): Promise<unknown> {
      if (method === 'open') {
        const target = String(args.target ?? '').trim()
        if (/^(https?:|mailto:)/i.test(target)) {
          // A page can't open another site itself: the address could carry whatever
          // it read. It asks, and the person sees where the link goes and clicks it.
          setOutLink(target.slice(0, 2000))
          return { asked: target }
        }
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) throw new Error('brain.open() takes a Brainspace path or an http(s) link.')
        // Anything else is a place in Brainspace, absolute or relative to the artifact's folder.
        const to = spacePath(path, target)
        await navigate({ to: spaceHref(to) as never })
        return { opened: to }
      }
      if (method === 'download') {
        const content = args.content
        const blob = content instanceof Blob ? content : new Blob([typeof content === 'string' ? content : JSON.stringify(content, null, 2)], { type: String(args.type ?? 'text/plain') })
        if (blob.size > MAX_DOWNLOAD_BYTES) throw new Error('That download is too large.')
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = String(args.name ?? 'download').replace(/[\\/]/g, '-').slice(0, 200) || 'download'
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        return { downloaded: a.download }
      }
      const result = (await artifactCallFn({ data: { artifact: path, call: { ...args, method } } })) as { path?: string; id?: string; size?: number; version?: number }
      if (result.path) used.current.add(result.path)
      if (method === 'file') {
        if ((result.size ?? 0) > MAX_FILE_BYTES) throw new Error(`${result.path} is too large to load into a page.`)
        const res = await fetch(`/api/files/${result.id}?v=${result.version}`)
        if (!res.ok) throw new Error(`Couldn't load ${result.path}.`)
        return { ...result, blob: await res.blob() }
      }
      return result
    }

    const onMessage = (e: MessageEvent) => {
      const win = frame.current?.contentWindow
      if (!win || e.source !== win) return
      const m = e.data as Msg | null
      if (!m || m.__brain !== 1) return
      if (m.type === 'error') {
        setPageError(String(m.message ?? 'Error').slice(0, 400))
        return
      }
      if (typeof m.id !== 'number' || typeof m.method !== 'string') return
      const reply = (body: Record<string, unknown>) => {
        // The frame may have been reloaded while the call ran: only answer the window that asked.
        if (frame.current?.contentWindow === win) win.postMessage({ __brain: 1, id: m.id, ...body }, '*')
      }
      handle(m.method, m.args && typeof m.args === 'object' ? m.args : {}).then(
        (result) => reply({ ok: true, result }),
        (err) => reply({ ok: false, error: errMessage(err) }),
      )
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = new Set<string>()
    const onLive = (e: Event) => {
      const c = (e as CustomEvent<LiveChangeDetail>).detail
      if (!c.fullPath || c.scope !== 'files') return
      const hit = [...used.current].filter((p) => p === c.fullPath || p.startsWith(c.fullPath + '/'))
      if (!hit.length) return
      hit.forEach((p) => changed.add(p))
      clearTimeout(timer)
      // Flows and agents often write several times in a row; tell the page once.
      timer = setTimeout(() => {
        const paths = [...changed]
        changed.clear()
        for (const p of paths) frame.current?.contentWindow?.postMessage({ __brain: 1, event: 'change', detail: { path: p } }, '*')
      }, 250)
    }

    window.addEventListener('message', onMessage)
    window.addEventListener(LIVE_CHANGE_EVENT, onLive)
    setListening(true)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      window.removeEventListener(LIVE_CHANGE_EVENT, onLive)
    }
  }, [path, navigate])

  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  // The frame's document loads once. A second load means the page sent the frame
  // somewhere else, or reloaded itself. Either way, put the artifact back, and
  // give up if it keeps happening.
  function onLoad() {
    loads.current += 1
    if (loads.current < 2) return
    const now = Date.now()
    resets.current = [...resets.current.filter((t) => now - t < 10_000), now]
    if (resets.current.length > 3) setBlocked(true)
    else setEpoch((n) => n + 1)
  }

  function reload() {
    resets.current = []
    setBlocked(false)
    setEpoch((n) => n + 1)
  }

  const controls = (
    <>
      <Button size="sm" variant="ghost" onClick={reload} aria-label="Reload" title="Reload">
        <RotateCw className="size-3.5" />
      </Button>
      {!full && (
        <Button size="sm" variant="ghost" onClick={onToggleCode}>
          <Code2 className="size-3.5" /> Code
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setFull((f) => !f)}>
        {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        {full ? 'Exit full screen' : 'Full screen'}
      </Button>
    </>
  )

  // The page fills whatever it's given: the pane beside the sidebar, or the whole window in full screen.
  return (
    <div className={cn(full ? 'fixed inset-0 z-50 flex flex-col bg-sheet' : 'flex min-h-0 flex-1 flex-col', showingCode && !full && 'hidden')}>
      {full ? (
        <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
          <span className="mr-auto truncate px-1 text-sm font-medium">{name}</span>
          {controls}
        </div>
      ) : (
        toolbar && !showingCode && createPortal(controls, toolbar)
      )}
      {pageError && (
        <div className="flex items-start gap-2 border-b border-danger/25 bg-danger-wash px-4 py-2 text-[13px] text-ink">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-danger" />
          <span className="min-w-0 flex-1 break-words font-mono text-[12.5px]">{pageError}</span>
          <button type="button" onClick={() => setPageError(null)} aria-label="Dismiss" className="text-ink-3 hover:text-ink">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {outLink && (
        <div className="flex items-center gap-2 border-b border-line bg-paper px-4 py-2 text-[13px]">
          <ExternalLink className="size-3.5 shrink-0 text-ink-3" />
          <span className="shrink-0 text-ink-2">This page links to</span>
          <a
            href={outLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOutLink(null)}
            className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-brand-ink underline underline-offset-2"
          >
            {outLink.replace(/^https?:\/\//, '')}
          </a>
          <button type="button" onClick={() => setOutLink(null)} aria-label="Dismiss" className="text-ink-3 hover:text-ink">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {blocked ? (
        <div className="grid min-h-72 flex-1 place-items-center p-8 text-center">
          <div>
            <p className="font-medium">This page keeps trying to leave</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">
              Artifacts can't load other sites or reload themselves, so it was stopped. Check its code, or reload to try again.
            </p>
            <Button size="sm" className="mt-4" onClick={reload}>
              Reload
            </Button>
          </div>
        </div>
      ) : !listening ? (
        <div className="min-h-0 flex-1" />
      ) : (
        <iframe
          key={`${epoch}:${version}`}
          ref={frame}
          title={name}
          srcDoc={doc}
          sandbox={ARTIFACT_SANDBOX}
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          className="min-h-0 w-full flex-1 bg-white"
        />
      )}
    </div>
  )
}
