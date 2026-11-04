import { Link } from '@tanstack/react-router'
import { Avatar, ViaMark } from './ui'
import { ACTION_LABEL, driveHref, timeAgo } from '../lib/utils'

export type ActivityItem = {
  id: string
  action: string
  via: 'web' | 'mcp' | 'flow'
  clientName: string | null
  fullPath: string | null
  details: Record<string, unknown> | null
  createdAt: number
  actorName: string | null
  actorEmail: string | null
  actorImage: string | null
}

function detailText(a: ActivityItem) {
  const d = a.details ?? {}
  switch (a.action) {
    case 'connection_call':
      return `${String(d.connection)}.${String(d.tool)}${d.ok === false ? ' (failed)' : ''}`
    case 'connection_add':
    case 'connection_remove':
      return String(d.name ?? d.slug ?? '')
    case 'invite':
      return `${d.email ?? 'a join link'} as ${d.role}`
    case 'role_change':
      return `${d.member}: ${d.from} → ${d.to}`
    case 'member_remove':
      return String(d.member ?? '')
    case 'secret_add':
    case 'secret_update':
    case 'secret_remove':
      return `${String(d.name ?? '')}${d.scope === 'me' ? ' (personal)' : ''}`
    case 'flow_run':
      return d.trigger ? `(${String(d.trigger)})` : ''
    case 'flow_approval':
    case 'flow_approve':
    case 'flow_reject':
      return `: ${String(d.title ?? '')}`
    case 'flow_trigger_add':
    case 'flow_trigger_update':
    case 'flow_trigger_remove':
      return `: ${String(d.trigger ?? '')}`
    case 'api_key_create':
    case 'api_key_revoke':
      return String(d.name ?? '')
    default:
      return ''
  }
}

export function ActivityRow({ a, compact }: { a: ActivityItem; compact?: boolean }) {
  const msg = a.details && typeof a.details.message === 'string' ? a.details.message : null
  const extra = detailText(a)
  return (
    <li className="flex gap-2.5">
      <Avatar name={a.actorName} image={a.actorImage} size={compact ? 20 : 24} />
      <div className="min-w-0 flex-1 text-[13.5px] leading-snug">
        <div>
          <span className="font-medium">{a.actorName ?? a.actorEmail ?? 'Someone'}</span>{' '}
          <span className="text-ink-2">{ACTION_LABEL[a.action] ?? a.action.replace(/_/g, ' ')}</span>{' '}
          {a.fullPath && a.action !== 'purge' ? (
            <Link to={driveHref(a.fullPath) as never} className="font-mono text-[12.5px] text-ink hover:underline">
              {a.fullPath}
            </Link>
          ) : a.fullPath ? (
            <span className="font-mono text-[12.5px]">{a.fullPath}</span>
          ) : null}
          {extra && <span className="text-ink-2"> {extra}</span>}
        </div>
        {msg && !compact && <div className="mt-0.5 text-ink-2">“{msg}”</div>}
        <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
          {timeAgo(a.createdAt)}
          <ViaMark via={a.via} client={a.clientName} />
        </div>
      </div>
    </li>
  )
}
