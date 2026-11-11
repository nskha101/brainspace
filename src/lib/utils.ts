import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

export function timeAgo(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** "/team/brand/voice.md" -> "/app/space/team/brand/voice.md" */
export const spaceHref = (path: string) => `/app/space${path.startsWith('/') ? path : `/${path}`}`

export const ROLE_LABEL: Record<string, string> = { admin: 'Admin', member: 'Member', viewer: 'Read-only' }

export function errMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

export const ACTION_LABEL: Record<string, string> = {
  create: 'created',
  edit: 'edited',
  upload: 'uploaded',
  upload_version: 'uploaded a new version of',
  upload_link_create: 'made an upload link for',
  move: 'moved',
  rename: 'renamed',
  promote: 'promoted',
  copy: 'copied',
  delete: 'deleted',
  restore: 'restored',
  purge: 'permanently deleted',
  restore_version: 'restored an old version of',
  describe: 'described',
  folder_notes: 'updated the notes on',
  mkdir: 'created folder',
  invite: 'invited',
  invite_revoke: 'revoked an invite',
  member_join: 'joined the workspace',
  member_leave: 'left the workspace',
  member_remove: 'removed a member',
  role_change: 'changed a role',
  connection_add: 'connected',
  connection_update: 'updated a connection',
  connection_remove: 'removed a connection',
  connection_call: 'called',
  api_key_create: 'created an API key',
  api_key_revoke: 'revoked an API key',
  workspace_create: 'created the workspace',
  workspace_rename: 'renamed the workspace',
  auto_join_on: 'turned on auto-join',
  auto_join_off: 'turned off auto-join',
  flow_run: 'ran the flow',
  flow_approval: 'asked for approval in',
  flow_approve: 'approved a step in',
  flow_reject: 'rejected a step in',
  flow_trigger_add: 'scheduled',
  flow_trigger_update: 'changed a trigger for',
  flow_trigger_remove: 'removed a trigger from',
  ai_settings: 'changed the AI settings',
  secret_add: 'added the secret',
  secret_update: 'updated the secret',
  secret_remove: 'removed the secret',
}
