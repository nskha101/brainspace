# Brainspace MCP tool reference

Generated from the server's tool definitions by `scripts/gen-tool-reference.ts`. Don't edit by hand.

Paths always start with a space: `/team/...` (shared) or `/me/...` (private). Tools from connected services appear as `<slug>__<tool>` and are listed by `connection_tools`, not here.

## Orientation

### `whoami`

Start here. Returns you, your workspace, your role and what it allows, the spaces, available skills and connections. Call it once at the start of a session.

Who: everyone, read-only.

No arguments.

### `guide`

The full guide to working with Brainspace: path rules, versioning, promotion, skills and connections. Read it if anything is unclear.

Who: everyone, read-only.

No arguments.

## Reading and search

### `list`

List a folder. Use path "/team" or "/me" for a space root. Set depth > 1 to see nested folders in one call.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string |  | Path starting with the space: /team/... (shared) or /me/... (private). |
| `depth` | integer |  | How many levels to include. Default 1. |

### `read`

Read a doc. You always get the latest version unless you pass version to check out an older one (see history). Returns content and the version number to pass as baseVersion when you write. For PDFs, Word, PowerPoint and Excel files it returns the extracted text (PDF pages are marked <!-- page N -->) plus a temporary download URL; for images, just the URL. offset/limit (1-based lines) page through long docs and long extracted text.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
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

Search both spaces by meaning and keywords (hybrid). Use it before creating a doc so you update the existing one instead of duplicating it.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | yes |  |
| `space` | "all" \| "team" \| "me" |  |  |
| `mode` | "hybrid" \| "keyword" \| "semantic" |  |  |
| `pathPrefix` | string |  | Only return results under this path, e.g. /team/brand |
| `limit` | integer |  |  |

### `recent`

Docs and files changed most recently, newest first.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `space` | "all" \| "team" \| "me" |  |  |
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
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
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
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `edits` | object[] | yes |  |
| `message` | string |  | Short commit message describing the change, like a git commit. |
| `baseVersion` | integer |  | Version you read. If the file changed since, the write is rejected so you can merge instead of overwriting. |

### `append`

Append text to the end of a doc, creating it if needed. Good for logs, meeting notes and running lists.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `text` | string | yes |  |
| `message` | string |  | Short commit message describing the change, like a git commit. |

### `upload`

Store a file from a public URL (or small base64 data). Re-uploading to the same path creates a new version. For a file on your machine, or one the user has, use upload_link instead: base64 costs tokens and is capped near 3 MB.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `url` | string |  | Fetch the file from this URL. |
| `base64` | string |  | File bytes as base64, if you have them inline. |
| `mimeType` | string |  |  |
| `description` | string |  | What it is and when to use it, e.g. "Primary logo, use on light backgrounds". |
| `message` | string |  | Short commit message describing the change, like a git commit. |

### `upload_link`

Get a short-lived link for putting files into the space without sending them through the conversation. Give `url` to the user: it opens a page where they can drop files or folders (no sign-in needed). Or run the `forAgents` curl command yourself to upload a local file of any size up to 95 MB. Target a folder (end the path with "/") or an exact file path. Files land as you, with your role.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Folder to upload into, ending with "/" (e.g. /team/brand/assets/), or an exact file path (e.g. /me/contracts/msa.pdf). |
| `expiresInMinutes` | integer |  | Default 60. Max 7 days. |
| `maxFiles` | integer |  | Default 100 for folders, 5 for a single path. |
| `note` | string |  | Shown to the person on the upload page, e.g. "The signed MSA, please". |
| `description` | string |  | Description to set on the file (single-path links only). |
| `message` | string |  | Commit message for the uploaded versions. |

### `upload_link_status`

See which files have arrived through an upload link. Without an id, lists your active links.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string |  |  |

### `upload_link_revoke`

Stop an upload link from accepting more files.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |

### `extract_text`

Re-run text extraction for a PDF, Word, PowerPoint or Excel file (Brainspace does this automatically on upload). Use it when read says extraction failed, or with ocr: false to skip OCR. Waits for the result.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `ocr` | boolean |  | Read scanned PDF pages with OCR. Default true. |

### `describe`

Set the one-line description of a doc or file. Descriptions show up in listings and search, so agents can pick the right asset without opening it.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `description` | string | yes |  |

### `mkdir`

Create a folder (and any missing parents).

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |

### `move`

Move or rename a doc or folder. End "to" with "/" to move into a folder. Moving from /me to /team shares it with the team (same as promote). Only admins can move things out of /team.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `to` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |

### `copy`

Copy a doc, file or folder. Use it to take a team doc into /me to draft changes privately.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `to` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |

### `promote`

Share something from your personal space with the whole team. If nothing exists at the team path, it moves there with its history. If a doc already exists there (say /team/brand/brand-kit.md), yours becomes its next version: everyone gets it by default and the previous version stays in history. Folders merge file by file. The private copy goes to your trash unless keepCopy is set. Pass baseVersion (the team version you started from) to be stopped if someone changed the team doc in the meantime.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path in your personal space, e.g. /me/drafts/brand-kit.md |
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
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `limit` | integer |  |  |

### `diff`

Unified diff between two versions of a doc. "to" defaults to the current version.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `from` | integer | yes |  |
| `to` | integer |  |  |

### `restore_version`

Make an old version current again. This adds a new version, so nothing is lost.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `version` | integer | yes |  |
| `message` | string |  | Short commit message describing the change, like a git commit. |

## Restricted folders

### `access`

Show who can see a /team folder or file. Most of /team is open to the whole workspace; folders and files can be restricted to certain people, and everything inside a restricted folder is restricted too. list marks restricted items with restricted: true.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |

### `access_set`

Restrict a /team folder or file to certain people (by email or name), change who's on the list, or pass open: true to share it with the whole workspace again. Members and admins can do this for anything they can see. You are always kept on the list. Restricting a folder covers everything inside it, including files added later, and hides it from everyone else, admins included. Confirm the people with the user before restricting.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `people` | string[] |  | Emails or names of the members who should have access. You are added automatically. |
| `open` | boolean |  | Remove the restriction so everyone in the workspace can see it. |

## Trash

### `delete`

Move a doc or folder to the trash. It can be restored with trash_restore. Deleting from /team needs the admin role; you can always delete your own /me files.

Who: members and admins. Destructive.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |

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

Remove someone from the workspace and revoke their API keys. Admins only. Their personal space is kept in case they return.

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

## Flows

### `flows_list`

Flows are small programs the team runs on demand, on a schedule or from a webhook. Lists team flows and your private ones, with their status, last run, next scheduled run and runs waiting for approval.

Who: everyone, read-only.

No arguments.

### `flow_get`

A flow's description, inputs, outputs, what it may touch, its code, diagram, triggers and recent runs.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `flow` | string | yes | Flow name (e.g. "competitor-digest"), id, or folder path like /team/flows/competitor-digest. |
| `includeCode` | boolean |  | Include flow.ts source. Default true. |

### `flow_templates`

Starter flows you can copy with flow_create({ template }). Read the brainspace-flows skill before writing flow code.

Who: everyone, read-only.

No arguments.

### `flow_create`

Create a flow folder at /me/flows/<name> with FLOW.md (description, inputs, outputs, uses) and flow.ts (the code), blank or from a template. Then edit those files with write/edit, check with flow_test, and share with promote.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Lowercase with dashes, e.g. "weekly-metrics". |
| `template` | string |  | Template id from flow_templates. |
| `description` | string |  |  |
| `space` | "me" \| "team" |  | Default "me". Draft privately, then promote. |

### `flow_test`

Run a flow in test mode: real reads and AI calls, but writes, deliveries and non-read-only connection calls are recorded instead of made. Returns the run id; check it with flow_run_get. Always test before scheduling or promoting.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `flow` | string | yes | Flow name (e.g. "competitor-digest"), id, or folder path like /team/flows/competitor-digest. |
| `inputs` | object |  |  |
| `deliver` | any[] |  | Destinations to preview. |
| `secrets` | object |  | Secret values for this run only, for secrets the flow declares but nobody has saved. Prefer saved secrets (secret_set or the app) so keys stay out of chats. |

### `flow_run`

Start a real run now, as you. Pass inputs and, optionally, where to deliver the outputs. Returns the run id; follow it with flow_run_get. Runs can take minutes; they keep going after you return.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `flow` | string | yes | Flow name (e.g. "competitor-digest"), id, or folder path like /team/flows/competitor-digest. |
| `inputs` | object |  |  |
| `deliver` | any[] |  |  |
| `secrets` | object |  | Secret values for this run only, for secrets the flow declares but nobody has saved. Prefer saved secrets (secret_set or the app) so keys stay out of chats. |

### `flow_runs`

Recent runs, newest first. Filter by flow or status (waiting = needs an approval).

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `flow` | string |  | Flow name (e.g. "competitor-digest"), id, or folder path like /team/flows/competitor-digest. |
| `status` | "queued" \| "running" \| "waiting" \| "succeeded" \| "failed" \| "cancelled" |  |  |
| `limit` | integer |  |  |

### `flow_run_get`

One run: status, each step, logs, outputs, deliveries, captured writes (test runs) and any pending approval.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `runId` | string | yes |  |

### `flow_run_cancel`

Stop a queued, running or waiting run.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `runId` | string | yes |  |

### `flow_run_approve`

Answer a run that is waiting on approve(). Show the user the request (title, summary, preview from flow_run_get) and get their decision first.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `runId` | string | yes |  |
| `approved` | boolean | yes |  |
| `note` | string |  |  |

### `flow_trigger_set`

Create or update a trigger: a schedule (cron + IANA timezone, at most every 15 minutes), a webhook, or a saved manual run. A trigger holds input values and destinations. It runs as you, and you approve the flow's current access; if the flow later asks for more, the trigger pauses until you approve again. Confirm the schedule and destinations with the user first.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `flow` | string | yes | Flow name (e.g. "competitor-digest"), id, or folder path like /team/flows/competitor-digest. |
| `id` | string |  | Trigger id to update. Omit to create. |
| `kind` | "schedule" \| "webhook" \| "manual" |  |  |
| `name` | string |  |  |
| `cron` | string |  | Five fields, e.g. "0 9 * * 1-5" = weekdays 09:00. |
| `timezone` | string |  | IANA name, e.g. America/New_York. Default UTC. |
| `inputs` | object |  |  |
| `deliver` | any[] |  |  |
| `enabled` | boolean |  |  |

### `flow_triggers_list`

A flow's schedules, webhooks and saved runs.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `flow` | string | yes | Flow name (e.g. "competitor-digest"), id, or folder path like /team/flows/competitor-digest. |

### `flow_trigger_run`

Run a saved trigger right away, with its inputs and destinations, as you.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |

### `flow_trigger_approve`

Re-approve a paused trigger after its flow asked for more access. Only the person the trigger runs as can do this; tell them what the flow now touches first.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |

### `flow_trigger_remove`

Delete a schedule, webhook or saved run. Yours, or anyone's if you are an admin.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |

### `secrets_list`

API keys that flows can use: team secrets and your personal ones, with the hosts each may be sent to. Values are never returned. Your personal secret wins over a team secret with the same name in runs that act as you.

Who: everyone, read-only.

No arguments.

### `secret_set`

Save or replace an API key for flows. hosts are the only hosts the value will ever be sent to. Flow code uses it as secret("NAME") and never sees the value. Rather than asking the user to paste a key into the chat, point them to the addInApp link from secrets_list; use this when they have already given you the key or asked you to save it.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | UPPER_SNAKE_CASE, e.g. WEATHER_API_KEY. |
| `value` | string |  | The key. Omit to change only hosts or description. |
| `hosts` | string[] |  | Hosts it may be sent to, e.g. ["api.openweathermap.org"]. Required for a new secret. |
| `scope` | "team" \| "me" |  | team (default): any run can use it. me: only runs that act as you. |
| `description` | string |  |  |

### `secret_remove`

Delete a saved secret. Team secrets: whoever added it, or an admin.

Who: members and admins. Destructive.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `scope` | "team" \| "me" |  |  |

### `workspace_ai`

The model flows use for ai.* calls and whether AI is set up. Admins can set the Vercel AI Gateway key and the default model (an AI Gateway id like google/gemini-4-argon). Pass listModels to see available ids.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `key` | string \| null |  | Admins: a Vercel AI Gateway API key, or null to remove it. |
| `model` | string \| null |  | Admins: default model id, or null for the Brainspace default. |
| `listModels` | boolean |  |  |

