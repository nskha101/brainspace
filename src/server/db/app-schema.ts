import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema'

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const ts = (name: string) =>
  integer(name, { mode: 'timestamp_ms' }).notNull().default(now)

export type Role = 'admin' | 'member' | 'viewer'

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  /** People who sign in with a verified email on this domain join automatically. */
  autoJoinDomain: text('auto_join_domain'),
  autoJoinRole: text('auto_join_role').$type<Role>().notNull().default('member'),
  /** Vercel AI Gateway key for flows' ai.* calls, encrypted. */
  aiGatewayKey: text('ai_gateway_key'),
  /** Default model for flows, an AI Gateway id like "google/gemini-4-argon". */
  aiModel: text('ai_model'),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at'),
}, (t) => [index('workspace_auto_join').on(t.autoJoinDomain)])

export const member = sqliteTable(
  'member',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').$type<Role>().notNull(),
    /** Set when the member finishes or skips the welcome flow for this workspace. */
    onboardedAt: integer('onboarded_at', { mode: 'timestamp_ms' }),
    /** Last time one of this member's agents called the MCP server, and which client it was. */
    agentSeenAt: integer('agent_seen_at', { mode: 'timestamp_ms' }),
    agentClient: text('agent_client'),
    createdAt: ts('created_at'),
  },
  (t) => [
    uniqueIndex('member_ws_user').on(t.workspaceId, t.userId),
    index('member_user').on(t.userId),
  ],
)

export const invitation = sqliteTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    email: text('email'),
    role: text('role').$type<Role>().notNull(),
    token: text('token').notNull().unique(),
    invitedBy: text('invited_by').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    acceptedBy: text('accepted_by'),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: ts('created_at'),
  },
  (t) => [index('invitation_ws').on(t.workspaceId)],
)

/**
 * A file or folder. `spaceId` is "team" for the shared space or the owner's
 * user id for their personal space. `path` is the absolute path inside the
 * space, e.g. "/brand/voice.md".
 */
export const node = sqliteTable(
  'node',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    spaceId: text('drive_id').notNull(),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    path: text('path').notNull(),
    kind: text('kind').$type<'folder' | 'doc' | 'file'>().notNull(),
    mimeType: text('mime_type'),
    size: integer('size').notNull().default(0),
    content: text('content'),
    r2Key: text('r2_key'),
    version: integer('version').notNull().default(0),
    description: text('description'),
    chunkCount: integer('chunk_count').notNull().default(0),
    /** Text extraction for binary files (PDF, Word...): null when not applicable. */
    textStatus: text('text_status').$type<'pending' | 'done' | 'failed'>(),
    textError: text('text_error'),
    textChars: integer('text_chars'),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    deletedBy: text('deleted_by'),
  },
  (t) => [
    uniqueIndex('node_live_path')
      .on(t.workspaceId, t.spaceId, t.path)
      .where(sql`deleted_at is null`),
    index('node_parent').on(t.workspaceId, t.spaceId, t.parentId),
    index('node_updated').on(t.workspaceId, t.updatedAt),
  ],
)

export const nodeVersion = sqliteTable(
  'node_version',
  {
    id: text('id').primaryKey(),
    nodeId: text('node_id')
      .notNull()
      .references(() => node.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull(),
    version: integer('version').notNull(),
    content: text('content'),
    r2Key: text('r2_key'),
    size: integer('size').notNull().default(0),
    hash: text('hash'),
    message: text('message'),
    authorId: text('author_id').notNull(),
    via: text('via').$type<'web' | 'mcp' | 'flow'>().notNull(),
    clientName: text('client_name'),
    createdAt: ts('created_at'),
  },
  (t) => [uniqueIndex('node_version_unique').on(t.nodeId, t.version)],
)

export const activity = sqliteTable(
  'activity',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    actorId: text('actor_id').notNull(),
    via: text('via').$type<'web' | 'mcp' | 'flow'>().notNull(),
    clientName: text('client_name'),
    action: text('action').notNull(),
    nodeId: text('node_id'),
    spaceId: text('drive_id'),
    path: text('path'),
    details: text('details', { mode: 'json' }).$type<Record<string, Json>>(),
    createdAt: ts('created_at'),
  },
  (t) => [index('activity_ws_time').on(t.workspaceId, t.createdAt)],
)

export const apiKey = sqliteTable(
  'api_key',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    hash: text('hash').notNull().unique(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: ts('created_at'),
  },
  (t) => [index('api_key_user').on(t.userId)],
)

export type ConnectionAuth = 'none' | 'bearer' | 'headers' | 'oauth'

export const connection = sqliteTable(
  'connection',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    presetId: text('preset_id'),
    type: text('type').$type<'mcp' | 'http'>().notNull(),
    url: text('url').notNull(),
    authType: text('auth_type').$type<ConnectionAuth>().notNull(),
    /** shared: one credential for the whole team. per_user: everyone signs in. */
    credentialMode: text('credential_mode')
      .$type<'shared' | 'per_user'>()
      .notNull()
      .default('shared'),
    /** Encrypted JSON: static OAuth client id/secret for servers without DCR. */
    oauthClient: text('oauth_client'),
    oauthScope: text('oauth_scope'),
    minRole: text('min_role').$type<Role>().notNull().default('viewer'),
    accessMode: text('access_mode')
      .$type<'all' | 'restricted'>()
      .notNull()
      .default('all'),
    exposeTools: integer('expose_tools', { mode: 'boolean' })
      .notNull()
      .default(true),
    /** direct: every tool listed. search: tools found via connection_tools. auto: search above 30 tools. */
    toolMode: text('tool_mode').$type<'auto' | 'direct' | 'search'>().notNull().default('auto'),
    upstreamInstructions: text('upstream_instructions'),
    toolAllowlist: text('tool_allowlist', { mode: 'json' }).$type<
      string[] | null
    >(),
    readOnlyTools: text('read_only_tools', { mode: 'json' }).$type<
      string[] | null
    >(),
    instructions: text('instructions'),
    toolsCache: text('tools_cache', { mode: 'json' }).$type<CachedTool[]>(),
    toolsCachedAt: integer('tools_cached_at', { mode: 'timestamp_ms' }),
    status: text('status')
      .$type<'active' | 'needs_auth' | 'error'>()
      .notNull()
      .default('needs_auth'),
    statusMessage: text('status_message'),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [uniqueIndex('connection_slug').on(t.workspaceId, t.slug)],
)

export type CachedTool = {
  name: string
  /** Name agents see: <slug>__<tool>, hashed when too long or colliding. */
  exposedName?: string
  outputSchema?: Record<string, Json>
  title?: string
  description?: string
  inputSchema: Record<string, Json>
  annotations?: Record<string, Json>
}

/** Credentials for a connection. userId is "" for the shared credential. */
export const connectionCredential = sqliteTable(
  'connection_credential',
  {
    connectionId: text('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().default(''),
    /** Encrypted JSON blob (headers, tokens, client info, PKCE verifier). */
    data: text('data').notNull(),
    oauthState: text('oauth_state'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.connectionId, t.userId] }),
    index('connection_credential_state').on(t.oauthState),
  ],
)

export const connectionAccess = sqliteTable(
  'connection_access',
  {
    connectionId: text('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.userId] })],
)

/**
 * A short-lived link that lets anyone holding it upload into one folder (or
 * one exact file path) as the member who created it. Agents hand these to
 * people, or use them with curl to send local files without base64.
 */
export const uploadLink = sqliteTable(
  'upload_link',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    spaceId: text('drive_id').notNull(),
    /** Folder path (mode "folder") or exact file path (mode "file") inside the space. */
    path: text('path').notNull(),
    mode: text('mode').$type<'folder' | 'file'>().notNull(),
    maxFiles: integer('max_files').notNull(),
    uses: integer('uses').notNull().default(0),
    message: text('message'),
    description: text('description'),
    note: text('note'),
    clientName: text('client_name'),
    uploaded: text('uploaded', { mode: 'json' }).$type<string[]>(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: ts('created_at'),
  },
  (t) => [index('upload_link_ws').on(t.workspaceId)],
)

/**
 * Text extracted from a binary file (PDF, Word, slides, sheets) by Context.dev,
 * kept apart from `node` so listings don't load it. Covers the current version.
 */
export const nodeText = sqliteTable('node_text', {
  nodeId: text('node_id')
    .primaryKey()
    .references(() => node.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  /** Markdown, capped for D1. The full text is in R2 at `r2Key` when longer. */
  markdown: text('markdown').notNull(),
  r2Key: text('r2_key'),
  chars: integer('chars').notNull(),
  pages: integer('pages'),
  createdAt: ts('created_at'),
})

export type FlowInputSpec = {
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'markdown' | 'json'
  description?: string
  required?: boolean
  default?: Json
  enum?: string[]
}
export type FlowOutputSpec = { type: 'markdown' | 'string' | 'json' | 'number' | 'boolean'; description?: string }
export type FlowScope = {
  connections: string[]
  read: string[]
  write: string[]
  network: string[]
  /** Names of secrets the flow may use, e.g. WEATHER_API_KEY. */
  secrets: string[]
  ai: boolean
}
export type FlowManifest = {
  name: string
  description: string
  model?: string
  inputs: Record<string, FlowInputSpec>
  outputs: Record<string, FlowOutputSpec>
  uses: FlowScope
}
export type FlowDiagramNode =
  | { kind: 'step'; label: string; uses?: string[] }
  | { kind: 'sleep'; label: string; duration?: string }
  | { kind: 'approval'; label: string }
  | { kind: 'loop'; label: string; body: FlowDiagramNode[] }
  | { kind: 'branch'; label: string; then: FlowDiagramNode[]; else: FlowDiagramNode[] }
  | { kind: 'parallel'; label: string; body: FlowDiagramNode[] }
export type FlowDestination =
  | { to: 'space'; output?: string; path: string; mode?: 'new' | 'version' | 'append' }
  | { to: 'connection'; connection: string; tool: string; args: Record<string, Json> }
  | { to: 'email'; members: string[]; output?: string; subject?: string }
  | { to: 'webhook'; url: string; headers?: Record<string, string> }

/**
 * A flow is a folder in a space with FLOW.md and flow.ts (or flow.js). This
 * table is an index over those files, refreshed whenever they change.
 */
export const flow = sqliteTable(
  'flow',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    spaceId: text('drive_id').notNull(),
    folderNodeId: text('folder_node_id').notNull().unique(),
    folderPath: text('folder_path').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    manifest: text('manifest', { mode: 'json' }).$type<FlowManifest>(),
    manifestNodeId: text('manifest_node_id'),
    manifestVersion: integer('manifest_version'),
    codeNodeId: text('code_node_id'),
    codeVersion: integer('code_version'),
    /** sha256 of the compiled code. The compiled module is in R2 at flows/compiled/<hash>.js. */
    codeHash: text('code_hash'),
    diagram: text('diagram', { mode: 'json' }).$type<FlowDiagramNode[]>(),
    scopeHash: text('scope_hash'),
    status: text('status').$type<'ok' | 'invalid' | 'missing'>().notNull(),
    error: text('error'),
    updatedAt: ts('updated_at'),
  },
  (t) => [index('flow_ws').on(t.workspaceId, t.spaceId)],
)

export const flowTrigger = sqliteTable(
  'flow_trigger',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    flowId: text('flow_id')
      .notNull()
      .references(() => flow.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'manual' | 'schedule' | 'webhook'>().notNull(),
    name: text('name').notNull(),
    cron: text('cron'),
    timezone: text('timezone'),
    nextRunAt: integer('next_run_at', { mode: 'timestamp_ms' }),
    inputs: text('inputs', { mode: 'json' }).$type<Record<string, Json>>().notNull(),
    deliver: text('deliver', { mode: 'json' }).$type<FlowDestination[]>().notNull(),
    runAsUserId: text('run_as_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The flow scope the run-as person approved. Wider scope pauses the trigger until they approve again. */
    approvedScopeHash: text('approved_scope_hash').notNull(),
    approvedScope: text('approved_scope', { mode: 'json' }).$type<FlowScope>().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    pausedReason: text('paused_reason'),
    webhookTokenHash: text('webhook_token_hash').unique(),
    lastRunId: text('last_run_id'),
    lastStatus: text('last_status'),
    lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [index('flow_trigger_flow').on(t.flowId), index('flow_trigger_due').on(t.enabled, t.nextRunAt)],
)

export type FlowRunStatus = 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
export type FlowDelivery = { to: string; target: string; ok: boolean; link?: string; error?: string; preview?: string }
export type FlowApproval = { key: string; title: string; summary?: string; preview?: string; requestedAt: number; timeoutAt?: number }

export const flowRun = sqliteTable(
  'flow_run',
  {
    /** Also the Workflow instance id. */
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    flowId: text('flow_id')
      .notNull()
      .references(() => flow.id, { onDelete: 'cascade' }),
    triggerId: text('trigger_id'),
    mode: text('mode').$type<'live' | 'test'>().notNull(),
    flowName: text('flow_name').notNull(),
    codeHash: text('code_hash').notNull(),
    codeVersion: integer('code_version'),
    manifestVersion: integer('manifest_version'),
    scope: text('scope', { mode: 'json' }).$type<FlowScope>().notNull(),
    model: text('model'),
    runAsUserId: text('run_as_user_id').notNull(),
    startedBy: text('started_by').notNull(),
    inputs: text('inputs', { mode: 'json' }).$type<Record<string, Json>>().notNull(),
    deliver: text('deliver', { mode: 'json' }).$type<FlowDestination[]>().notNull(),
    status: text('status').$type<FlowRunStatus>().notNull(),
    outputs: text('outputs', { mode: 'json' }).$type<Record<string, Json>>(),
    /** Set when outputs were too big for D1; the full JSON is in R2. */
    outputsKey: text('outputs_key'),
    deliveries: text('deliveries', { mode: 'json' }).$type<FlowDelivery[]>(),
    /** Test runs: writes and deliveries that were captured instead of performed. */
    captured: text('captured', { mode: 'json' }).$type<{ kind: string; target: string; preview: string }[]>(),
    pendingApproval: text('pending_approval', { mode: 'json' }).$type<FlowApproval>(),
    /** Secrets passed for this run only, encrypted. Cleared when the run finishes. */
    runSecrets: text('run_secrets'),
    error: text('error'),
    aiCalls: integer('ai_calls').notNull().default(0),
    aiTokens: integer('ai_tokens').notNull().default(0),
    createdAt: ts('created_at'),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('flow_run_ws').on(t.workspaceId, t.createdAt),
    index('flow_run_flow').on(t.flowId, t.createdAt),
    index('flow_run_status').on(t.workspaceId, t.status),
  ],
)

export const flowRunStep = sqliteTable(
  'flow_run_step',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => flowRun.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
    kind: text('kind').$type<'step' | 'sleep' | 'approval'>().notNull(),
    status: text('status').$type<'running' | 'done' | 'failed' | 'waiting' | 'sleeping'>().notNull(),
    attempt: integer('attempt').notNull().default(1),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    until: integer('until', { mode: 'timestamp_ms' }),
    error: text('error'),
    preview: text('preview'),
  },
  (t) => [uniqueIndex('flow_run_step_name').on(t.runId, t.name)],
)

export const flowRunLog = sqliteTable(
  'flow_run_log',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => flowRun.id, { onDelete: 'cascade' }),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
    level: text('level').$type<'info' | 'warn' | 'error'>().notNull(),
    message: text('message').notNull(),
    data: text('data', { mode: 'json' }).$type<Json>(),
    /** Replays re-run code outside steps; the hash keeps a log line from appearing twice. */
    hash: text('hash').notNull(),
  },
  (t) => [uniqueIndex('flow_run_log_hash').on(t.runId, t.hash)],
)

/**
 * API keys for flows. Flow code never sees the value: it uses a placeholder,
 * and Brainspace swaps the real value in on requests to the secret's hosts.
 * `ownerId` is "team" for workspace secrets or a user id for personal ones;
 * a person's own secret wins over a team secret with the same name.
 */
export const flowSecret = sqliteTable(
  'flow_secret',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    value: text('value').notNull(),
    /** Hosts the value may be sent to, e.g. ["api.openweathermap.org"]. */
    hosts: text('hosts', { mode: 'json' }).$type<string[]>().notNull(),
    description: text('description'),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  },
  (t) => [uniqueIndex('flow_secret_name').on(t.workspaceId, t.ownerId, t.name)],
)
