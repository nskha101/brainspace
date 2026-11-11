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
| Agent skills | `skills/` |

Storage: D1 holds metadata, doc content, versions and an FTS5 index. R2 holds binary files. Vectorize and Workers AI (`bge-base-en-v1.5`) power semantic search. Connection credentials are AES-GCM encrypted with `ENCRYPTION_KEY`.

### Spaces and versions

Paths start with a space: `/team/...` is shared, `/me/...` is private. Every write adds a version with its author, the agent client that made it and a commit message. Reads return the latest version unless a `version` is passed. Writes take an optional `baseVersion` and fail with a conflict instead of overwriting newer work. Promoting a private doc onto an existing team doc makes it that doc's next version.

Folders can carry notes for agents (`node.notes`, set with the `folder_notes` tool or from the folder page). Agents get the notes of every folder above a path when they list, read or create something there, and `whoami` lists the folders that have them.

### Roles

- Admin: everything, including deleting team files, managing people and removing connections.
- Member: everything except destructive actions.
- Read-only: reads the team space and calls read-only connection tools.

### Connections

Admins and members connect upstream MCP servers or HTTP APIs once for the workspace (`src/server/services/connections.ts`). Their tools appear to agents as `<slug>__<tool>`. Credentials can be shared or per user, and access can be limited by role, by person and by tool. Slack is built in rather than an upstream server: a workspace installs the Brainspace Slack app with Add to Slack, and its tools (`slack__post_message`, `slack__upload_file`...) run in `src/server/services/slack.ts` with the bot token. Setting up the app is in `docs/slack-app.md`.

### Flows

Flows are team automations that agents write and Brainspace runs on demand, on a schedule or from a webhook. A flow is a folder in a space (`/team/flows/<name>`) holding `FLOW.md` (description, inputs, outputs, and what it may touch) and `flow.ts`. Saving either file compiles the code (types stripped with Sucrase), stores it in R2 by hash, and derives the diagram the app draws.

Runs use [Dynamic Workflows](https://developers.cloudflare.com/dynamic-workers/usage/dynamic-workflows/): one Workflow class (`FlowWorkflow`) loads each run's code into its own Dynamic Worker through the Worker Loader, so every step is durable and runs can sleep or wait for an approval. Flow code has no secrets and no network. It calls back into Brainspace through the `FlowBrain` binding with a signed run token, limited to the paths, connections and hosts in `FLOW.md`, and acting as the person who started the run. Outputs go to destinations (space docs, connection tools, email, webhooks) as extra durable steps. API keys are saved as secrets bound to specific hosts; flow code only gets a placeholder, which `FlowOutbound` swaps for the real value on requests to those hosts. Schedules run from a one-minute cron trigger. AI calls go through Vercel AI Gateway with each workspace's own key. The design is in `docs/design/flows.md`.

## Agent skills

`skills/` holds the skills that teach agents to use Brainspace. `bun run skills:build` regenerates `skills/brainspace/references/tools.md` from the tool definitions and packages everything into `public/`:

- Any coding agent: "Set me up with Brainspace: run `curl -fsSL https://usebrain.space/setup.md` and follow the steps." The agent works out which client it's in and runs the matching install below. The steps live in `scripts/setup.md`.
- Claude Code plugin (skills plus MCP server): `/plugin marketplace add https://usebrain.space/marketplace.json`, then `/plugin install brainspace@brainspace`
- Claude app (chat and Cowork): upload `https://usebrain.space/brainspace.plugin` under Customize → Plugins → Upload plugin, then connect Brainspace from the plugin's Connectors tab
- Most other agents: `npx skills add https://usebrain.space`
- Shell: `curl -fsSL https://usebrain.space/install.sh | sh`

The plugin version bumps itself when skill content changes (`skills/.plugin-version.json`).

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
