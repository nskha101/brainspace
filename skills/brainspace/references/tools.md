# Brainspace MCP tool reference

Generated from the server's tool definitions by `scripts/gen-tool-reference.ts`. Don't edit by hand.

Paths always start with a drive: `/team/...` (shared) or `/me/...` (private). Tools from connected services appear as `<slug>__<tool>` and are listed by `connection_tools`, not here.

## Orientation

### `whoami`

Start here. Returns you, your workspace, your role and what it allows, the drives, available skills and connections. Call it once at the start of a session.

Who: everyone, read-only.

No arguments.

### `guide`

The full guide to working with Brainspace: path rules, versioning, promotion, skills and connections. Read it if anything is unclear.

Who: everyone, read-only.

No arguments.

## Reading and search

### `list`

List a folder. Use path "/team" or "/me" for a drive root. Set depth > 1 to see nested folders in one call.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string |  | Path starting with the drive: /team/... (shared) or /me/... (private). |
| `depth` | integer |  | How many levels to include. Default 1. |

### `read`

Read a doc. You always get the latest version unless you pass version to check out an older one (see history). Returns content and the version number to pass as baseVersion when you write. For binary files (images, PDFs) returns a temporary download URL. offset/limit (1-based lines) page through long docs.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |
| `version` | integer |  |  |
| `offset` | integer |  |  |
| `limit` | integer |  |  |

### `read_many`

Read up to 20 docs in one call. Use it to pull in related context (e.g. voice guide plus brand kit) without many round trips.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `paths` | string[] | yes |  |

### `search`

Search both drives by meaning and keywords (hybrid). Use it before creating a doc so you update the existing one instead of duplicating it.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | yes |  |
| `drive` | "all" \| "team" \| "me" |  |  |
| `mode` | "hybrid" \| "keyword" \| "semantic" |  |  |
| `pathPrefix` | string |  | Only return results under this path, e.g. /team/brand |
| `limit` | integer |  |  |

### `recent`

Docs and files changed most recently, newest first.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `drive` | "all" \| "team" \| "me" |  |  |
| `limit` | integer |  |  |

### `activity`

What happened in the workspace: edits, moves, promotions, invites, connection calls. Filter by path prefix or action.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `pathPrefix` | string |  |  |
| `actions` | string[] |  | e.g. ["edit","create","promote"] |
| `limit` | integer |  |  |

## Writing

### `write`

Create a doc or replace its whole content. Missing folders are created. Paths without an extension become markdown. To change part of an existing doc, prefer edit. When replacing, pass baseVersion from your last read.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |
| `content` | string | yes |  |
| `message` | string |  | Short commit message describing the change, like a git commit. |
| `baseVersion` | integer |  | Version you read. If the file changed since, the write is rejected so you can merge instead of overwriting. |
| `description` | string |  | One-line summary shown in listings and search. |
| `createOnly` | boolean |  | Fail instead of overwriting if the doc already exists. |

### `edit`

Change part of a doc with exact find-and-replace edits, applied in order to the latest version. Each oldText must match exactly once unless replaceAll is true. Safer than write for concurrent changes.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |
| `edits` | object[] | yes |  |
| `message` | string |  | Short commit message describing the change, like a git commit. |
| `baseVersion` | integer |  | Version you read. If the file changed since, the write is rejected so you can merge instead of overwriting. |

### `append`

Append text to the end of a doc, creating it if needed. Good for logs, meeting notes and running lists.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |
| `text` | string | yes |  |
| `message` | string |  | Short commit message describing the change, like a git commit. |

### `upload`

Store a binary file (logo, image, PDF, font) from a public URL or base64 data. Re-uploading to the same path creates a new version.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |
| `url` | string |  | Fetch the file from this URL. |
| `base64` | string |  | File bytes as base64, if you have them inline. |
| `mimeType` | string |  |  |
| `description` | string |  | What it is and when to use it, e.g. "Primary logo, use on light backgrounds". |
| `message` | string |  | Short commit message describing the change, like a git commit. |

### `describe`

Set the one-line description of a doc or file. Descriptions show up in listings and search, so agents can pick the right asset without opening it.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |
| `description` | string | yes |  |

### `mkdir`

Create a folder (and any missing parents).

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |

### `move`

Move or rename a doc or folder. End "to" with "/" to move into a folder. Moving from /me to /team shares it with the team (same as promote). Only admins can move things out of /team.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |
| `to` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |

### `copy`

Copy a doc, file or folder. Use it to take a team doc into /me to draft changes privately.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |
| `to` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |

### `promote`

Share something from your private drive with the whole team. If nothing exists at the team path, it moves there with its history. If a doc already exists there (say /team/brand/brand-kit.md), yours becomes its next version: everyone gets it by default and the previous version stays in history. Folders merge file by file. The private copy goes to your trash unless keepCopy is set. Pass baseVersion (the team version you started from) to be stopped if someone changed the team doc in the meantime.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path in your private drive, e.g. /me/drafts/brand-kit.md |
| `to` | string |  | Destination under /team. Defaults to the same relative path. |
| `keepCopy` | boolean |  |  |
| `baseVersion` | integer |  | Version you read. If the file changed since, the write is rejected so you can merge instead of overwriting. |
| `message` | string |  | Short commit message describing the change, like a git commit. |

## Versions

### `history`

List the versions of a doc or file: who changed it, when, through which agent, and the commit message.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |
| `limit` | integer |  |  |

### `diff`

Unified diff between two versions of a doc. "to" defaults to the current version.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |
| `from` | integer | yes |  |
| `to` | integer |  |  |

### `restore_version`

Make an old version current again. This adds a new version, so nothing is lost.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |
| `version` | integer | yes |  |
| `message` | string |  | Short commit message describing the change, like a git commit. |

## Trash

### `delete`

Move a doc or folder to the trash. It can be restored with trash_restore. Deleting from /team needs the admin role; you can always delete your own /me files.

Who: members and admins. Destructive.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the drive: /team/... (shared) or /me/... (private). |

### `trash_list`

List deleted items you can see, with ids for trash_restore.

Who: everyone, read-only.

No arguments.

### `trash_restore`

Restore a deleted item by id (from trash_list). Pass "to" if something now exists at the original path.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |
| `to` | string |  |  |

### `trash_purge`

Permanently delete a trashed item and all its versions. This cannot be undone. Admins only for team files.

Who: members and admins. Destructive.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |

## Team skills

### `skills_list`

Skills are team playbooks stored as /team/skills/<name>/SKILL.md (and private ones in /me/skills). Check this list when starting a task; if a skill matches, load it with skill_get and follow it.

Who: everyone, read-only.

No arguments.

### `skill_get`

Load a skill by name: its SKILL.md instructions plus a list of supporting files you can read.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |

## Workspaces

### `workspaces_list`

Workspaces you belong to.

Who: everyone, read-only.

No arguments.

### `workspace_switch`

Make another workspace your default. Takes effect on the next tool call. (API keys are tied to one workspace and ignore this.)

Who: everyone.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `workspace` | string | yes | Workspace slug or id |

### `workspace_create`

Create a new workspace (with starter folders) and make it your default. You become its admin.

Who: everyone.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |

### `workspace_rename`

Rename the current workspace.

Who: admins only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |

### `workspace_auto_join`

Turn on auto-join so anyone who signs in with a verified email on your company domain (the domain of your own email, e.g. @acme.com) joins this workspace automatically with the given role. Existing users on that domain are added right away. Public domains like gmail.com aren't allowed. Admins only.

Who: admins only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean | yes |  |
| `role` | "admin" \| "member" \| "viewer" |  | Role for people who join this way. Default member. |

## People and access

### `members_list`

Everyone in the workspace with their role (admin, member, viewer), plus pending invites.

Who: everyone, read-only.

No arguments.

### `member_invite`

Invite someone by email with a role: admin (full control), member (everything except destructive actions) or viewer (read-only). Omit email to get a shareable join link. Returns the invite URL.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string |  |  |
| `role` | "admin" \| "member" \| "viewer" |  |  |
| `sendEmail` | boolean |  | Email the invite. Default true when email is set. |

### `invite_revoke`

Revoke a pending invite by id (from members_list).

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |

### `member_set_role`

Change a member's role. Admins only.

Who: admins only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `member` | string | yes | Email or user id |
| `role` | "admin" \| "member" \| "viewer" | yes |  |

### `member_remove`

Remove someone from the workspace and revoke their API keys. Admins only. Their private drive is kept in case they return.

Who: admins only. Destructive.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `member` | string | yes | Email or user id |

### `api_key_create`

Create an API key for an agent or script. It acts as you, in this workspace, with your role. The key is shown once.

Who: everyone.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |

### `api_keys_list`

Your API keys (admins see everyone's).

Who: everyone, read-only.

No arguments.

### `api_key_revoke`

Revoke an API key by id.

Who: everyone.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |

## Connections

### `connections_list`

Third-party tools the team has connected (HubSpot, PostHog, Context.dev...). Their tools are exposed here as <slug>__<tool>, or call them through connection_call.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `includeUnavailable` | boolean |  |  |

### `connection_presets`

Known services you can connect with connection_add, and what credentials each needs.

Who: everyone, read-only.

No arguments.

### `connection_add`

Connect an MCP server or HTTP API for the whole team. Use presetId for known services, or pass url. For bearer/API-key auth pass token. For OAuth services the result includes authorizeUrl: give it to the user to open in a browser.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `presetId` | string |  |  |
| `name` | string |  |  |
| `slug` | string |  | Short prefix for proxied tool names, e.g. "hubspot". |
| `type` | "mcp" \| "http" |  |  |
| `url` | string |  |  |
| `authType` | "none" \| "bearer" \| "headers" \| "oauth" |  |  |
| `token` | string |  | API key or token, sent as "Authorization: Bearer <token>". |
| `headers` | object |  | Custom auth headers, e.g. {"X-Api-Key": "..."} |
| `oauthClientId` | string |  |  |
| `oauthClientSecret` | string |  |  |
| `credentialMode` | "shared" \| "per_user" |  | shared: one login for the team. per_user: each person authorizes their own account. |
| `instructions` | string |  | Guidance for agents on when and how to use this connection. |

### `connection_update`

Change a connection: rotate its token, rename it, limit which tools are exposed (toolAllowlist), mark tools read-only for viewers, set agent instructions, or (admins) restrict who can use it.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `connection` | string | yes | Slug or id |
| `name` | string |  |  |
| `url` | string |  |  |
| `token` | string |  |  |
| `headers` | object |  |  |
| `exposeTools` | boolean |  | false hides its tools from the tool list; they stay reachable through connection_tools. |
| `toolMode` | "auto" \| "direct" \| "search" |  | direct: list every tool as <slug>__<tool>. search: agents find tools with connection_tools. auto: search once a connection has more than 30 tools. |
| `toolAllowlist` | any |  | Only these tools are available. null = all. |
| `readOnlyTools` | any |  | Tools viewers may call. |
| `instructions` | string |  |  |
| `minRole` | "admin" \| "member" \| "viewer" |  |  |
| `accessMode` | "all" \| "restricted" |  |  |
| `allowedUsers` | string[] |  | Emails or user ids allowed when accessMode is restricted. |

### `connection_authorize`

Get a fresh OAuth sign-in link for a connection that needs auth. Give the link to the user to open.

Who: everyone.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `connection` | string | yes |  |

### `connection_test`

Reconnect to the upstream server and refresh its tool list.

Who: everyone.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `connection` | string | yes |  |

### `connection_remove`

Remove a connection and its stored credentials. Admins only.

Who: admins only. Destructive.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `connection` | string | yes |  |

### `connection_tools`

Search the tools of every connected service by what you want to do, e.g. "find a company's logo" or "list open deals". Without a query, lists one connection's tools. Large connections are only reachable this way, so search here when connections_list shows mode "search". Returns tool names and one-line summaries; get schemas with connection_describe.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string |  | What you want to do, in plain words. |
| `connection` | string |  | Limit to one connection (slug). |
| `limit` | integer |  |  |

### `connection_describe`

Full description and input schema for up to 10 tools on one connection. Call it before connection_call so you pass the right arguments.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `connection` | string | yes |  |
| `tools` | string[] | yes |  |

### `connection_call`

Call a tool on a connected service. Results over 40,000 characters are cut, and the rest can be read with connection_result.

Who: everyone.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `connection` | string | yes |  |
| `tool` | string | yes | Tool name as returned by connection_tools (the upstream name or the <slug>__ name). |
| `arguments` | any |  | Object, or a JSON string of one. |

### `connection_result`

Page through a connection tool result that was too long to return at once. Use the id and nextOffset from the truncation note.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |
| `offset` | integer |  |  |
| `limit` | integer |  |  |

