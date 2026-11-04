import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'

export type LiveChange = {
  type: 'change'
  scope: 'files' | 'members' | 'connections' | 'workspace' | 'flows'
  driveId: string | null
  path: string | null
  action: string
  actorId: string
  actorName: string
  via: 'web' | 'mcp' | 'flow'
  client: string | null
  at: number
}

/** Fired on window when the doc open in the editor changed while it has unsaved edits. */
export const DOC_CHANGED_EVENT = 'brainspace:doc-changed'

let dirtyDocPath: string | null = null

/** The doc editor calls this so live refreshes never wipe unsaved edits. */
export function setDirtyDoc(path: string | null) {
  dirtyDocPath = path
}

/** True while the doc editor holds unsaved edits. */
export function hasDirtyDoc() {
  return dirtyDocPath !== null
}

function fullPath(c: LiveChange) {
  if (!c.path) return null
  // Private-drive events only ever reach their owner, so anything not "team" is /me.
  return `${c.driveId === 'team' ? '/team' : '/me'}${c.path === '/' ? '' : c.path}`
}

/**
 * Keeps a WebSocket open to the workspace's live channel and refreshes what's
 * on screen whenever anyone (a person or an agent) changes something.
 */
export function useLiveUpdates(workspaceId: string) {
  const router = useRouter()
  useEffect(() => {
    let ws: WebSocket | null = null
    let stopped = false
    let attempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pingTimer: ReturnType<typeof setInterval> | undefined
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    let protectDoc = false

    const flush = () => {
      const skipDoc = protectDoc
      protectDoc = false
      void router.invalidate({ filter: (m) => !(skipDoc && m.routeId === '/app/drive/$') })
    }
    const schedule = () => {
      clearTimeout(flushTimer)
      // Agents often make several changes in a row; refresh once for the burst.
      flushTimer = setTimeout(flush, 150)
    }

    const onChange = (c: LiveChange) => {
      const p = fullPath(c)
      if (dirtyDocPath && p && (p === dirtyDocPath || dirtyDocPath.startsWith(p + '/'))) {
        protectDoc = true
        window.dispatchEvent(new CustomEvent<LiveChange>(DOC_CHANGED_EVENT, { detail: c }))
      }
      schedule()
    }

    const connect = () => {
      if (stopped) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/api/live`)
      ws.onopen = () => {
        // After a gap we may have missed events, so refresh once.
        if (attempt > 0) schedule()
        attempt = 0
        clearInterval(pingTimer)
        pingTimer = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 30_000)
      }
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string' || e.data === 'pong') return
        try {
          const msg = JSON.parse(e.data) as LiveChange | { type: string }
          if (msg.type === 'change') onChange(msg as LiveChange)
        } catch {
          // ignore malformed frames
        }
      }
      ws.onclose = (e) => {
        clearInterval(pingTimer)
        if (stopped) return
        if (e.code === 4001) {
          // Removed from this workspace.
          window.location.href = '/app'
          return
        }
        retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++))
      }
    }

    connect()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!ws || ws.readyState === WebSocket.CLOSED)) {
        clearTimeout(retryTimer)
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      clearTimeout(flushTimer)
      clearInterval(pingTimer)
      document.removeEventListener('visibilitychange', onVisible)
      ws?.close()
    }
  }, [workspaceId, router])
}
