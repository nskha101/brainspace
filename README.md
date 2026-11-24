<img src="assets/icon.svg" width="64" height="64" alt="">

# Brainspace

A shared brain for a team's AI agents, live at [usebrain.space](https://usebrain.space). Agents connect over MCP to read and update versioned docs (brand kit, company overview, playbooks), share private drafts with the team, and use tools from services the team has connected, such as HubSpot, PostHog or Context.dev. The web app is for browsing and editing. Agents can do nearly everything without it.

## How it fits together

One Cloudflare Worker serves everything:

| Piece | Where |
| --- | --- |
| Web app (TanStack Start, React, Tiptap) | `src/routes`, `src/components` |
| MCP server at `/mcp` | `src/server/mcp` |
| Services shared by the app and MCP | `src/server/services` |
| Auth (Better Auth: Google, magic link, OAuth 2.1 provider for MCP clients) | `src/server/auth.ts` |
| D1 schema and migrations (Drizzle 1.0 RC) | `src/server/db`, `drizzle/`, `migrations/` |
| Flows: compiler, sandbox SDK, Workflow runtime | `src/server/flows`, `src/server/services/flows.ts` |
| Bots: scheduled agents on the Cloudflare Agents SDK | `src/server/bots`, `src/server/services/bots.ts` |
| Databases in folders (one Durable Object each) | `src/server/databases`, `src/server/services/databases.ts` |
| Artifacts: sandboxed pages over databases | `src/components/ArtifactView.tsx`, `src/lib/artifact-frame.ts`, `src/server/services/artifacts.ts` |
| Agent skills and the Claude plugin | `plugin/`, `.claude-plugin/marketplace.json` |

Storage: D1 holds metadata, doc content, versions and an FTS5 index. R2 holds binary files. Each folder database is a SQLite database in its own Durable Object. Vectorize and Workers AI (`bge-base-en-v1.5`) power semantic search. Connection credentials are AES-GCM encrypted with `ENCRYPTION_KEY`.

### Spaces and versions

Paths start with a space: `/team/...` is shared, `/me/...` is private. Every write adds a version with its author, the agent client that made it and a commit message. Reads return the latest version unless a `version` is passed. Writes take an optional `baseVersion` and fail with a conflict instead of overwriting newer work. Promoting a private doc onto an existing team doc makes it that doc's next version.

Folders can carry notes for agents (`node.notes`, set with the `folder_notes` tool or from the folder page). Agents get the notes of every folder above a path when they list, read or create something there, and `whoami` lists the folders that have them.

### Databases

A folder can hold SQLite databases next to its docs, at paths ending in `.db` (`/team/customers/customers.db`). They're for records that flows and agents keep current and query, such as active customers and their channels, where a doc would have to be rewritten on every update. Several flows can share one, and a flow can keep its own state in a database inside its folder.

The entry in the space is a `node` row of kind `database`, so it gets a path, a description, restricted access, move, copy, trash and search like any file. Its rows live in a `BrainDatabase` Durable Object named by the node id (`src/server/databases/object.ts`), which is why moving or renaming the entry never touches the data. `node.content` holds a one-line-per-table summary that search indexes, and purging the entry from the trash wipes the object.

Agents use `db_list`, `db_schema`, `db_query` (read-only, enforced by rolling back anything that writes), `db_insert` (with upserts) and `db_exec`. Flows get the same through `db.*`, limited by `uses.read` and `uses.write`, and a test run executes its changes and rolls them back. Every call that changes data is one transaction. Rows have no version history; writes are logged in the activity feed. The app shows each database as a grid you can sort, filter and edit, with CSV import and export and a SQL box.

### Artifacts

An artifact is a page the app runs: a dashboard, a tracker, a small tool. It is a doc ending in `.html` whose head carries `<meta name="brainspace" content="artifact">`, so there's no new kind of node and no new agent tools. An `.html` doc without that tag stays a plain file and is shown as code. `write` and `edit` create and change it, every save is a version, it's private under `/me` until it's promoted, and it can be restricted like any file. The Artifacts page lists them all.

The app shows the page in a frame with `sandbox="allow-scripts allow-forms allow-modals"` and no origin (`src/components/ArtifactView.tsx`). `src/lib/artifact-frame.ts` builds the document: a content security policy that blocks every request except scripts, styles and fonts from a few public CDNs, then a small SDK, then the page's HTML. The app's own `frame-src 'self'` policy (`src/routes/__root.tsx`) stops the frame from navigating to another site. So a page can show what it reads and has nowhere to send it. Links to other sites don't open from the page: the app shows the address and the viewer clicks it.

The SDK is a global `brain` that posts messages to the app, and each call becomes a server call as the person looking at the page (`src/server/services/artifacts.ts`): `brain.db.query/exec/batch/insert/schema` on databases, `brain.read` and `brain.file` for docs and files, and `brain.onChange` to redraw when a flow, an agent or a person changes data the page has used. Since the page's author may not be its viewer, a team artifact can only touch what everyone who can open it can also see: nothing under `/me`, and nothing restricted to fewer people than the artifact.

Agents can't see a page run, so `write` and `edit` on an artifact return the link to open and warnings for anything the sandbox will block (a script from another host, `fetch`, `localStorage`, a remote image).

### Roles

- Admin: everything, including deleting team files, managing people and removing connections.
- Member: everything except destructive actions.
- Read-only: reads the team space and calls read-only connection tools.

### Connections

Admins and members connect upstream MCP servers or HTTP APIs once for the workspace (`src/server/services/connections.ts`). Their tools appear to agents as `<slug>__<tool>`. Credentials can be shared or per user, and access can be limited by role, by person and by tool. Slack is built in rather than an upstream server: a workspace installs the Brainspace Slack app with Add to Slack, and its tools (`slack__post_message`, `slack__upload_file`...) run in `src/server/services/slack.ts` with the bot token. Setting up the app is in `docs/slack-app.md`.

### Flows

Flows are team automations that agents write and Brainspace runs on demand, on a schedule or from a webhook. A flow is a folder in a space (`/team/flows/<name>`) holding `FLOW.md` (description, inputs, outputs, and what it may touch) and `flow.ts`. Saving either file compiles the code (types stripped with Sucrase), stores it in R2 by hash, and derives the diagram the app draws.

Runs use [Dynamic Workflows](https://developers.cloudflare.com/dynamic-workers/usage/dynamic-workflows/): one Workflow class (`FlowWorkflow`) loads each run's code into its own Dynamic Worker through the Worker Loader, so every step is durable and runs can sleep or wait for an approval. Flow code has no secrets and no network. It calls back into Brainspace through the `FlowBrain` binding with a signed run token, limited to the paths, connections and hosts in `FLOW.md`, and acting as the person who started the run. Outputs go to destinations (space docs, connection tools, email, webhooks) as extra durable steps. API keys are saved as secrets bound to specific hosts; flow code only gets a placeholder, which `FlowOutbound` swaps for the real value on requests to those hosts. Schedules run from a one-minute cron trigger. AI calls go through Vercel AI Gateway with each workspace's own key. The design is in `docs/design/flows.md`.

### Bots

A bot is an agent that runs on a schedule: instructions, a model, a set of tools and the paths it may touch. A person's agent creates one with `bot_create` and picks the cron and timezone from what the person asked for. Bots are private to their owner or shared with the team, and a team bot works in `/team` only.

Each bot is a Durable Object built on the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) (`BrainBot` in `src/server/bots/agent.ts`), named by the bot's id. The agent owns its schedule: it computes the next run in the bot's timezone and sets its own alarm with `this.schedule`, so bots don't use the Worker's cron trigger. A run is a fiber (`runFiber`) that loops over model turns and tool calls through Vercel AI Gateway, with the workspace's key. The bot's memory between runs is the agent's state. Subagents are child agents (`BrainBotWorker`, through `this.dynamicAgents`), each with a fresh context and its own storage, which is wiped when it reports back.

Besides its schedule, a bot can be woken by a webhook (`POST /api/bots/hook/<token>`, token stored hashed) or by a flow step (`bots.run` in the flow SDK). Webhook events go into an inbox table in the agent's own SQLite; a run takes everything waiting, so events that arrive mid-run are batched into the next one. A flow waits on a bot the way it waits on a subflow: a durable start step, `waitForEvent`, and an event sent to the Workflow instance when the bot run closes. What a webhook or flow sends reaches the model fenced off as data.

Bots call the same tools agents get over MCP, minus anything that deletes, shares or manages the workspace (`src/server/bots/tools.ts`). A run acts as the bot's owner with `via: 'bot'`, so every change is a version and an activity row under the bot's name. Each tool call is checked against the bot's paths, tools and connections first, and a bot may run a flow only when everything that flow touches is inside the bot's own access. The `bot`, `bot_run` and `bot_run_event` tables in D1 hold what the app and agents list. Only the owner can change a bot or steer a run, because it acts with their access; admins can pause or delete team bots.

## Agent skills

`plugin/` is the Brainspace plugin for Claude: the skills that teach agents to use Brainspace (`plugin/skills/`), the MCP server entry and the manifest. `.claude-plugin/marketplace.json` at the root of this repository lists it, so the repository itself is a plugin marketplace and people who add it get new versions from `main`.

`bun run skills:build` regenerates `plugin/skills/brainspace/references/tools.md` from the tool definitions, writes the plugin's manifest files, and packages everything into `public/`:

- Claude (chat, Cowork, desktop), with updates: Customize → Plugins → Add → Add marketplace, enter `nskha101/brainspace`, add the Brainspace plugin, and turn on Sync automatically for the marketplace.

- Any coding agent: "Set me up with Brainspace: run `curl -fsSL https://usebrain.space/setup.md` and follow the steps." The agent works out which client it's in and runs the matching install below. The steps live in `scripts/setup.md`.
- Claude Code plugin (skills plus MCP server): `/plugin marketplace add nskha101/brainspace`, then `/plugin install brainspace@brainspace`. For updates without asking, open `/plugin` → Marketplaces → brainspace → Enable auto-update. `https://usebrain.space/marketplace.json` works as the marketplace too.
- Claude app, as a file: upload `https://usebrain.space/brainspace.plugin` under Customize → Plugins → Upload plugin, then connect Brainspace from the plugin's Connectors tab. An uploaded copy never updates, so prefer the marketplace.
- Most other agents: `npx skills add https://usebrain.space`
- Shell: `curl -fsSL https://usebrain.space/install.sh | sh`

The plugin version bumps itself when skill content changes (`scripts/plugin-version.json` keeps the last hash, and the build writes the version into `plugin/.claude-plugin/plugin.json`). Commit those with the skill change: Claude only gives people a new copy when the version in `main` changes.

## Development

```sh
bun install
cp .dev.vars.example .dev.vars   # then fill in the secrets
bun run db:migrate:local
bun run dev                      # http://localhost:3000
```

On localhost, emails aren't sent. Magic links are printed in the dev server log instead. Vectorize and Workers AI run against the real Cloudflare resources in dev, so the Cloudflare API token needs to be in your environment.

Schema changes: edit `src/server/db/app-schema.ts`, then `bun run db:generate`. drizzle-kit 1.0 writes `drizzle/<timestamp>_<name>/migration.sql`, and `scripts/sync-migrations.mjs` copies those into `migrations/` for wrangler. Better Auth tables come from `bun run auth:schema`.

## Deploying

```sh
bun run deploy   # skills, build, remote D1 migrations, wrangler deploy
```

A bot that is mid-run keeps the code it started with. The deploy gives running bots 12 minutes, a little longer than a run can last, before they are moved to the new code, so a deploy never cuts a run short. To move them at once, deploy the same version again with `npx wrangler versions deploy <version>@100% --durable-objects-code-update-mode immediate`.

Secrets live in the Worker (`wrangler secret put`): `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `SLACK_BOT_TOKEN`, and `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` for the Slack app.

Sign-in is limited to the email domains in `ALLOWED_EMAIL_DOMAINS` (`wrangler.jsonc`, comma-separated). Leave it empty to let anyone sign up. A blocked attempt is posted to `SLACK_ALERT_CHANNEL`, a channel ID or a user ID for a DM, using `SLACK_BOT_TOKEN` (a bot token with `chat:write`). Without the token, the alert only goes to the Worker log.

### Running your own copy

1. Create the Cloudflare resources and put their IDs in `wrangler.jsonc` (`account_id`, the D1 `database_id`, and your domain under `routes`):
   ```sh
   wrangler d1 create brainspace
   wrangler r2 bucket create brainspace-files
   wrangler vectorize create brainspace-chunks --dimensions=768 --metric=cosine
   wrangler vectorize create-metadata-index brainspace-chunks --property-name=workspaceId --type=string
   wrangler vectorize create-metadata-index brainspace-chunks --property-name=spaceId --type=string
   wrangler r2 bucket lifecycle add brainspace-files expire-tmp-results tmp/results/ --expire-days 1
   ```
2. Set `APP_URL` and `EMAIL_FROM` in `wrangler.jsonc`, and change `APP` in `scripts/build-skills.mjs` to your domain (it also fills in `setup.md`).
3. For Google sign-in, create an OAuth web client in Google Cloud with the redirect URI `https://<your domain>/api/auth/callback/google`. Skip it to use email links only.
4. Verify your sending domain in Resend.
5. Set the secrets, then `bun run deploy`.
