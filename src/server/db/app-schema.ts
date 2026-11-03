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
 * A file or folder. `driveId` is "team" for the shared drive or the owner's
 * user id for their private drive. `path` is the absolute path inside the
 * drive, e.g. "/brand/voice.md".
 */
export const node = sqliteTable(
  'node',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    driveId: text('drive_id').notNull(),
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
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    deletedBy: text('deleted_by'),
  },
  (t) => [
    uniqueIndex('node_live_path')
      .on(t.workspaceId, t.driveId, t.path)
      .where(sql`deleted_at is null`),
    index('node_parent').on(t.workspaceId, t.driveId, t.parentId),
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
    via: text('via').$type<'web' | 'mcp'>().notNull(),
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
    via: text('via').$type<'web' | 'mcp'>().notNull(),
    clientName: text('client_name'),
    action: text('action').notNull(),
    nodeId: text('node_id'),
    driveId: text('drive_id'),
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
