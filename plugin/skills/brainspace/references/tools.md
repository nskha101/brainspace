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

List a folder. Use path "/team" or "/me" for a space root. Set depth > 1 to see nested folders in one call. Returns the notes on this folder and the folders above it (what they hold, how to use them): follow them. Folders marked hasNotes have notes of their own. Items people have read (in the app or through an agent) carry reads, readers (different people) and lastRead; one person counts at most once every 10 minutes. flowReads counts reads by automated flows separately.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string |  | Path starting with the space: /team/... (shared) or /me/... (private). |
| `depth` | integer |  | How many levels to include. Default 1. |

### `read`

Read a doc. You always get the latest version unless you pass version to check out an older one (see history). Returns content and the version number to pass as baseVersion when you write. Notes on the folders it sits in come first: follow them. For PDFs, Word, PowerPoint and Excel files it returns the extracted text (PDF pages are marked <!-- page N -->) plus a temporary download URL; for images, just the URL. offset/limit (1-based lines) page through long docs and long extracted text.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `version` | integer |  |  |
| `offset` | integer |  |  |
| `limit` | integer |  |  |

### `read_many`

Read up to 20 docs in one call. Use it to pull in related context (e.g. voice guide plus brand kit) without many round trips. folderNotes holds the notes on the folders they sit in: follow them.

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

Docs, files and databases, newest first. sort "edited" (default) orders by last change, "read" by last read, "most_read" by how many reads they have, which is how to find what the team relies on. Reads are by people, in the app or through an agent, one person at most once every 10 minutes; flowReads counts automated flows separately and plays no part in the order.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `space` | "all" \| "team" \| "me" |  |  |
| `sort` | "edited" \| "read" \| "most_read" |  |  |
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

Create a doc or replace its whole content. Missing folders are created. Paths without an extension become markdown. To change part of an existing doc, prefer edit. When replacing, pass baseVersion from your last read. An .html doc with <meta name="brainspace" content="artifact"> in its head is an artifact: the app runs it as a live page that can read and update databases. Load the brainspace-artifacts skill before writing one.

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

Store a file from a public URL (or small base64 data). Re-uploading to the same path creates a new version. For a file on your machine, or one the user has, use upload_link instead: base64 costs tokens and is capped near 3 MB. The result has `link`, the file's page in the Brainspace app: put it in your reply so the user can open it or copy it to share.

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

Get a short-lived link for putting files into the space without sending them through the conversation. Give `url` to the user: it opens a page where they can drop files or folders (no sign-in needed). Or run the `forAgents` curl command yourself to upload a local file of any size up to 95 MB; it prints the file's `link` in the Brainspace app, which you should pass on to the user. Target a folder inside a space (end the path with "/"), not the space root, or an exact file path. A folder link only adds files: a name already in use gets -2, -3 and so on. An exact file path gets a new version. HTML arrives as a plain file, never a running artifact. Files land as you, with your role.

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

See which files have arrived through an upload link, each with a `link` to its page in the Brainspace app to give the user. Without an id, lists your active links.

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

### `folder_notes`

Set the notes on a folder: what it holds and how agents should use it (what to read first, naming rules, what belongs there and what doesn't). Every agent gets them when it lists the folder, reads anything inside it or creates something there, including in subfolders. Markdown, up to 4000 characters. Replaces the current notes, so list the folder first and keep what's still right. An empty string clears them. Use describe for a one-line summary instead.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `notes` | string | yes |  |

### `move`

Move or rename a doc, database or folder. End "to" with "/" to move into a folder. Moving from /me to /team shares it with the team (same as promote). Only admins can move things out of /team.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `to` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |

### `copy`

Copy a doc, file, database or folder. Use it to take a team doc into /me to draft changes privately. Databases copy with all their rows, up to 50 MB.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |
| `to` | string | yes | Path starting with the space: /team/... (shared) or /me/... (private). |

### `promote`

Share something from your personal space with the whole team. If nothing exists at the team path, it moves there with its history. If a doc already exists there (say /team/brand/brand-kit.md), yours becomes its next version: everyone gets it by default and the previous version stays in history. Folders merge file by file. Team flows have no access to personal spaces, so promoting a flow also moves the private files, databases and subflows it uses and updates its paths: the first call fails and lists them, and you pass them back in alsoShare once the user agrees. The private copy goes to your trash unless keepCopy is set. Pass baseVersion (the team version you started from) to be stopped if someone changed the team doc in the meantime.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path in your personal space, e.g. /me/drafts/brand-kit.md |
| `to` | string |  | Destination under /team. Defaults to the same relative path. |
| `people` | string[] |  | Share it with only these people (emails, names or ids) instead of the whole team. It arrives restricted to them and you. Needs a team path where nothing exists yet. |
| `alsoShare` | string[] |  | For a flow that uses private files, databases or subflows: the /me paths to share along with it. promote fails and lists them when they are missing. Tell the user what becomes shared, and with whom, before passing them. |
| `keepCopy` | boolean |  |  |
| `baseVersion` | integer |  | Version you read. If the file changed since, the write is rejected so you can merge instead of overwriting. |
| `message` | string |  | Short commit message describing the change, like a git commit. |

## Versions

### `history`

List the versions of a doc or file: who changed it, when, through which agent, and the commit message. Also lists who has read it (how many times, when last, in the app or through which agent) and which flows read it.

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

Move a doc, database or folder to the trash. It can be restored with trash_restore. Deleting from /team needs the admin role; you can always delete your own /me files.

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

## Databases

### `db_list`

Databases are SQLite databases kept in folders (paths ending in .db). They hold records that flows and agents keep up to date and query, like the list of active customers, where a doc would have to be rewritten each time. Lists the ones you can see with their tables, columns and row counts.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `pathPrefix` | string |  | Only databases under this folder, e.g. /team/customers. |

### `db_schema`

The tables in a database: columns with types, keys, indexes and row counts. Call it before you write SQL against a database you have not used in this session.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path of the database, e.g. /team/customers/customers.db. |

### `db_query`

Run one read-only SQL statement (SQLite: SELECT, WITH, joins, aggregates, json_extract, FTS5 MATCH). Returns columns and rows. Up to 200 rows by default: filter and aggregate in SQL instead of pulling every row, and page with LIMIT and OFFSET when truncated is true.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path of the database, e.g. /team/customers/customers.db. |
| `sql` | string | yes | One SELECT statement. |
| `params` | any[] |  | Values for the ? placeholders, in order. Always pass values this way instead of writing them into the SQL. Objects and arrays are stored as JSON text. |
| `maxRows` | integer |  | Default 200. |

### `db_create`

Create a database in a folder. Put it next to the docs or the flow it belongs to (/team/customers/customers.db, /team/flows/renewals/state.db); ".db" is added if you leave it off. Pass sql with CREATE TABLE statements to set up the tables in the same call, and a description saying what the data is and what keeps it current. Give key columns a PRIMARY KEY or UNIQUE constraint so rows can be upserted. Use a database for records that get added to, updated or queried; use a doc for prose.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path of the database, e.g. /team/customers/customers.db. |
| `description` | string |  | What it holds and what updates it. Shown in listings and search. |
| `sql` | string |  | CREATE TABLE (and index) statements to run right away, separated by semicolons. |

### `db_exec`

Run SQL that changes a database: INSERT, UPDATE, DELETE, CREATE TABLE, ALTER TABLE, CREATE INDEX and so on. Everything in one call runs as one transaction, so either all of it applies or none of it does (leave out BEGIN and COMMIT). Pass sql with params for one statement, or statements for several. RETURNING rows come back in results. There is no undo and no version history for rows: check a risky UPDATE or DELETE with db_query first, and confirm with the user before deleting data or dropping a table.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path of the database, e.g. /team/customers/customers.db. |
| `sql` | string |  | One statement, or a script of several separated by semicolons (a script takes no params). |
| `params` | any[] |  | Values for the ? placeholders, in order. Always pass values this way instead of writing them into the SQL. Objects and arrays are stored as JSON text. |
| `statements` | object[] |  | Several statements, each with its own params, run in order as one transaction. |

### `db_insert`

Add rows to a table from JSON objects keyed by column name, up to 5000 per call, as one transaction. Pass upsertOn with the key columns to update the rows that already exist and insert the rest: the way to keep a table in step with another system. upsertOn needs a PRIMARY KEY or UNIQUE constraint on those columns. The table must exist (create it with db_exec).

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Path of the database, e.g. /team/customers/customers.db. |
| `table` | string | yes |  |
| `rows` | object[] | yes | Objects keyed by column name. Missing columns are stored as NULL. |
| `upsertOn` | string[] |  | Key columns, e.g. ["email"]. A row matching an existing key updates it. |
| `onConflict` | "error" \| "ignore" |  | Without upsertOn: fail on a duplicate key (default) or skip that row. |

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

Connect an MCP server or HTTP API for the whole team. Use presetId for known services, or pass url. For bearer/API-key auth pass token. For OAuth services the result includes authorizeUrl: give it to the user to open in a browser. presetId "slack" installs the Brainspace Slack app (authorizeUrl is its Add to Slack link), or pass a bot token (xoxb-...) as token.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `presetId` | string |  |  |
| `name` | string |  |  |
| `slug` | string |  | Short prefix for proxied tool names, e.g. "hubspot". |
| `type` | "mcp" \| "http" \| "slack" \| "gdrive" |  |  |
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

### `slack_account`

Whether you have connected your own Slack account through the workspace's Slack app, with a link to connect it if not. Connecting lets your own flows and private bots read Slack and post as you (flow code uses secret("SLACK_USER_TOKEN") with slack.com, and the slack connection's read_messages, search_messages and view_file work), and lets a flow start on the Slack messages you can see and on clicks on buttons it posted (flow_trigger_set with kind "slack"). Only you can use your account; nobody else sees your messages. Pass disconnect: true to remove it and revoke the token. Give the link to the user to open in the browser where they are signed in to Brainspace.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `disconnect` | boolean |  | Remove your Slack account from Brainspace and revoke its token. Ask the user first: their Slack triggers stop. |

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

Create a flow folder at /me/flows/<name> with FLOW.md (title, icon, description, inputs, outputs, uses) and flow.ts (the code), blank or from a template. Then edit those files with write/edit, check with flow_test, and share with promote.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Lowercase with dashes, e.g. "weekly-metrics". |
| `template` | string |  | Template id from flow_templates. |
| `description` | string |  |  |
| `title` | string |  | What people see in the app instead of the name, e.g. "Returning signups digest". Sets title in FLOW.md. |
| `icon` | string |  | One emoji shown next to the title, e.g. "📈". Sets icon in FLOW.md. |
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

Create or update a trigger: a schedule (cron + IANA timezone, at most every 15 minutes), a webhook (set verify to check its sender's signature), a Slack trigger (kind "slack": runs on the Slack messages and button clicks of the person it runs as, who must have connected their Slack account, see slack_account), or a saved manual run. A trigger holds input values and destinations. A new one runs as you, with your access. Updating a trigger that runs as a teammate (pass its id) leaves it running as them and logs your change; runAsMe: true takes it over. When a teammate edits a team flow, the next run uses their version and you get an email. Confirm the schedule and destinations with the user first.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `flow` | string | yes | Flow name (e.g. "competitor-digest"), id, or folder path like /team/flows/competitor-digest. |
| `id` | string |  | Trigger id to update. Omit to create. |
| `kind` | "schedule" \| "webhook" \| "slack" \| "manual" |  |  |
| `name` | string |  |  |
| `cron` | string |  | Five fields, e.g. "0 9 * * 1-5" = weekdays 09:00. |
| `timezone` | string |  | IANA name, e.g. America/New_York. Default UTC. |
| `inputs` | object |  |  |
| `deliver` | any[] |  |  |
| `enabled` | boolean |  |  |
| `runAsMe` | boolean |  | Only when updating a trigger that runs as someone else: run it as you from now on, with your access. Leave out to keep it running as them. |
| `slack` | object |  | Slack triggers only (kind "slack"). The Slack payload arrives as the flow's json input named body: an event_callback for a message, a block_actions payload for a click. Slack signed it and Brainspace checked that, so it needs no verify. Default: { messages: true }. |
| `verify` | any |  | Webhooks only: check that each request really comes from the service, using its signing secret. Without it anyone who has the URL can start a run with any body, so set it whenever the sender signs its requests. Save the secret first with hosts: [] (it is never sent anywhere); it is looked up as the person the trigger runs as, so use a team secret for a trigger that runs as a teammate. A request that fails gets a 401, starts nothing, and shows as the trigger's last status. null turns the check off. |

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

Approve a paused trigger. A trigger pauses for approval only when a teammate edits the flow to use something they have no access to themselves (a restricted secret, connection or folder). Only the person the trigger runs as can do this; tell them what the pausedReason says first.

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

API keys that flows can use: team secrets and your personal ones, with the hosts each may be sent to. Values are never returned. Your personal secret wins over a team secret with the same name in runs that act as you. A team secret with people set can only be used by runs that act as one of those people (canUse says whether you can).

Who: everyone, read-only.

No arguments.

### `secret_set`

Save or replace an API key for flows. hosts are the only hosts the value will ever be sent to; a webhook signing secret (flow_trigger_set verify) takes hosts: [] and is never sent anywhere. Flow code uses it as secret("NAME") and never sees the value. Rather than asking the user to paste a key into the chat, point them to the addInApp link from secrets_list; use this when they have already given you the key or asked you to save it.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | UPPER_SNAKE_CASE, e.g. WEATHER_API_KEY. |
| `value` | string |  | The key. Omit to change only hosts or description. |
| `hosts` | string[] |  | Hosts it may be sent to, e.g. ["api.openweathermap.org"]. Required for a new secret. [] for a webhook signing secret. |
| `scope` | "team" \| "me" |  | team (default): any run can use it, unless people is set. me: only runs that act as you. |
| `description` | string |  |  |
| `people` | any |  | Team secrets only: the people (emails or names) whose runs may use it, including you. Everyone else, admins included, can't. null opens it to every run again. Omit to leave it as is. Only whoever added the secret can change this. Use it for a token that acts as a person, like a Slack user token. |

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

## Bots

### `bots_list`

Bots are agents that work on their own schedule: each has instructions, a model, tools, and the part of the brain it may touch. Lists the team's bots and your private ones, with their schedule, next run and last run. One has kind "workspace": the workspace's own bot, which people ask things in Slack as @Brainspace or with bot_run and a prompt. It acts as whoever asks, in /team, and can build flows, bots and artifacts.

Who: everyone, read-only.

No arguments.

### `bot_get`

One bot: its instructions, schedule, model, tools, connections, paths and recent runs. Your own bots also show their memory, the notes a bot keeps between runs.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `bot` | string | yes | Bot name (e.g. "Monday competitor digest") or id. |

### `bot_create`

Set up a bot that does a job on a schedule, as you, without anyone opening a chat. Write instructions the way you would brief a colleague: what to check, where to write the result, what to skip. You choose the schedule from what the user asked for ("every Monday morning" is cron "0 9 * * 1" in their timezone; "keep an eye on" is usually hourly or daily, not every 15 minutes). A bot reads and changes docs and databases, calls connections, runs flows and can hand work to subagents; every change is versioned and shows in the activity log under the bot's name. Besides a schedule, a bot can be woken by a webhook (webhook: true), asked things in Slack by its @handle (slack: true), or run as a step of a flow (bots.run in flow code). Private by default; visibility "team" shares it and limits it to /team, and people shares it with only the people named. Tell the user the schedule and what it may touch, then run it once with bot_run to check it.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | A name people will recognize in a list, e.g. "Monday competitor digest". |
| `instructions` | string | yes | What to do on every run. The bot sees nothing else from this conversation. |
| `visibility` | "private" \| "team" |  | private (default): only you see it, and it can use /team and your /me. team: everyone sees it and its runs, and it works in /team only. On connections where each person signs in with their own account it uses yours; loginNote says when, so tell the user. |
| `people` | string[] |  | Share a team bot with only these people (emails, names or ids) instead of everyone. They and you see it and its runs, and can run it and ask it things. Passing people makes the bot a team bot. |
| `description` | string |  | One line on what it does, for the list of bots. |
| `icon` | any |  | One emoji shown next to its name in the app, e.g. "🔭". Pick one that fits the job. Null removes it. |
| `model` | string \| null |  | AI Gateway model id, like anthropic/claude-sonnet-5.5. It has to support tool calling. Omit (or null) for the workspace default; workspace_ai with listModels shows what there is. |
| `cron` | string \| null |  | When it runs: five cron fields, e.g. "0 9 * * 1" = Mondays 09:00. At most every 15 minutes. Null for a bot that only runs when asked. |
| `timezone` | string |  | IANA name for the schedule, e.g. America/New_York. Use the user's own. Default UTC. |
| `tools` | any |  | Limit the bot to these tools, e.g. ["read","search","db_query","append"]. Null (default) gives it every bot tool; bot_get lists them under allTools. |
| `connections` | any |  | Limit the bot to these connections (slugs), or [] for none. Null (default): every connection you can use. |
| `webhook` | boolean |  | true gives the bot a webhook URL (replacing any old one), returned once as webhookUrl: a POST to it wakes the bot, and the body reaches the run as data. false removes it. Use it when something outside should trigger the bot, like a monitor, a form or another system. A bot can have a schedule and a webhook. |
| `slack` | boolean |  | true lets people in the workspace ask the bot things in Slack: it gets an @handle there (a Slack user group), and a message that mentions it starts a run whose answer is posted in the thread. A team bot answers any member of this Brainspace workspace; a private bot answers only you. Needs the workspace's Slack connection. false takes it out of Slack. |
| `slackHandle` | any |  | Its Slack handle without the @, like "research-bot". Defaults to one made from the bot's name. Has to be free in that Slack workspace. |
| `paths` | any |  | Limit what it may touch. Default: all of /team, plus your /me for a private bot. Give a bot only what its job needs. |

### `bot_update`

Change a bot you own: its instructions, schedule, model, tools, connections, paths, name, icon, visibility, who it is shared with or whether it answers in Slack. Pass only what changes. enabled false pauses it and true resumes it (an admin can pause any team bot). Sharing a private bot with the team takes it out of your /me space. Any member can change the workspace's own bot (kind "workspace"): its name, icon, description, instructions, model, tools, connections and whether it answers in Slack. Its visibility, schedule, webhook and paths are fixed.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `bot` | string | yes | Bot name (e.g. "Monday competitor digest") or id. |
| `name` | string |  |  |
| `instructions` | string |  |  |
| `visibility` | "private" \| "team" |  |  |
| `people` | any |  | Who a team bot is shared with besides you (emails, names or ids). Replaces the list. null shares it with everyone. |
| `enabled` | boolean |  |  |
| `description` | string |  | One line on what it does, for the list of bots. |
| `icon` | any |  | One emoji shown next to its name in the app, e.g. "🔭". Pick one that fits the job. Null removes it. |
| `model` | string \| null |  | AI Gateway model id, like anthropic/claude-sonnet-5.5. It has to support tool calling. Omit (or null) for the workspace default; workspace_ai with listModels shows what there is. |
| `cron` | string \| null |  | When it runs: five cron fields, e.g. "0 9 * * 1" = Mondays 09:00. At most every 15 minutes. Null for a bot that only runs when asked. |
| `timezone` | string |  | IANA name for the schedule, e.g. America/New_York. Use the user's own. Default UTC. |
| `tools` | any |  | Limit the bot to these tools, e.g. ["read","search","db_query","append"]. Null (default) gives it every bot tool; bot_get lists them under allTools. |
| `connections` | any |  | Limit the bot to these connections (slugs), or [] for none. Null (default): every connection you can use. |
| `webhook` | boolean |  | true gives the bot a webhook URL (replacing any old one), returned once as webhookUrl: a POST to it wakes the bot, and the body reaches the run as data. false removes it. Use it when something outside should trigger the bot, like a monitor, a form or another system. A bot can have a schedule and a webhook. |
| `slack` | boolean |  | true lets people in the workspace ask the bot things in Slack: it gets an @handle there (a Slack user group), and a message that mentions it starts a run whose answer is posted in the thread. A team bot answers any member of this Brainspace workspace; a private bot answers only you. Needs the workspace's Slack connection. false takes it out of Slack. |
| `slackHandle` | any |  | Its Slack handle without the @, like "research-bot". Defaults to one made from the bot's name. Has to be free in that Slack workspace. |
| `paths` | any |  | Limit what it may touch. Default: all of /team, plus your /me for a private bot. Give a bot only what its job needs. |

### `bot_run`

Start a run now, without waiting for the schedule. Returns the run id; follow it with bot_run_get. Runs act as the bot's owner. The owner can add a request for this one run (prompt), e.g. "only look at last week". The workspace's own bot (kind "workspace") is different: any member can ask it, the prompt is the request and is required, and the run acts as you.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `bot` | string | yes | Bot name (e.g. "Monday competitor digest") or id. |
| `prompt` | string |  | An extra request for this run only. Owner only, except for the workspace's own bot, where it is what you are asking. |

### `bot_runs`

Recent runs, newest first, with what each bot said it did and what started each one (schedule, a person, a webhook or a flow). Filter by bot or status.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `bot` | string |  | Bot name (e.g. "Monday competitor digest") or id. |
| `status` | "queued" \| "running" \| "succeeded" \| "failed" \| "cancelled" |  |  |
| `limit` | integer |  |  |

### `bot_run_get`

One run step by step: what the bot said, each tool it called with the result, its subagents, and how it ended.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `runId` | string | yes |  |

### `bot_run_cancel`

Stop a run that is queued or running. Changes it already made stay; undo them with restore_version if needed.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `runId` | string | yes |  |

### `bot_delete`

Delete a bot, its schedule, its memory and its run history. What it wrote stays. Your own bots, or any team bot if you are an admin. The workspace's own bot can be paused but not deleted. Confirm with the user first; to stop a bot for a while, pause it with bot_update instead.

Who: members and admins. Destructive.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `bot` | string | yes | Bot name (e.g. "Monday competitor digest") or id. |

## Bot templates

### `templates_list`

Templates are bots, with the flows around them, that a teammate packaged so others can set up their own copy, running with their own logins and secrets. Lists the team's templates and your private ones: what each does, its bots and flows, and the connections, secrets and personal docs it needs.

Who: everyone, read-only.

No arguments.

### `template_get`

One template: its bots (with their instructions), flows, the fields to fill in, the setup guide, and `setup`, a checklist of where you are with it (which bots and flows you have, and whether each connection, secret, personal doc and trigger it needs is in place). Call it before template_use, and again afterwards to see what is left.

Who: everyone, read-only.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `template` | string | yes | Template name (e.g. "slack-reply-drafts"), title, or folder path like /team/templates/slack-reply-drafts. |

### `template_use`

Make your own copy of a template: its bots become private bots of yours and its flows go to /me/flows, all running as you. {{name}}, {{first_name}} and {{email}} become yours; pass the template's other fields in fields (ask the user for any you can't find; ones left out stay as {{field}} to fill in later). Returns todo: what is left, like signing in to a connection, adding a personal secret or writing a doc such as /me/slack/voice.md. Work through it with the user following the guide, then run the bot once with bot_run.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `template` | string | yes | Template name (e.g. "slack-reply-drafts"), title, or folder path like /team/templates/slack-reply-drafts. |
| `fields` | object |  | Values for the template's fields, by name, e.g. { "slack_user_id": "U0123ABC" }. template_get lists them. |

### `template_create`

Package bots, and the flows that run them, as a template a teammate can set up for themselves. Writes TEMPLATE.md, bots/<bot>.md and flows/<flow>/ under /me/templates/<name> (or /team/templates with space "team" when the user asked to share it). Swaps the owner's name and email for {{name}}, {{first_name}} and {{email}}, and lists the connections, secrets and personal docs it needs. Then read the files and replace anything else that belongs to one person (Slack ids, channel ids, nicknames) with a {{field}} declared under fields in TEMPLATE.md, and write the setup guide in its body. Bot memory, webhook URLs and run history are never copied.

Who: members and admins.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `bots` | string[] | yes | Bots to include, by name or id. Usually one. |
| `flows` | string[] |  | Flows to include, by id or name. Default: the flows that run these bots. [] for none. |
| `name` | string |  | Folder name, like "slack-reply-drafts". Default: made from the title. |
| `title` | string |  | What people see, like "Slack reply drafts". Default: the first bot's name. |
| `description` | string |  | One line on what someone gets by setting it up. |
| `icon` | any |  | One emoji. Default: the first bot's icon. |
| `space` | "me" \| "team" |  | me (default) to review it first and share it with promote; team to share it right away. |

