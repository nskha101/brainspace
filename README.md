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
| Agent skills | `skills/` |

Storage: D1 holds metadata, doc content, versions and an FTS5 index. R2 holds binary files. Vectorize and Workers AI (`bge-base-en-v1.5`) power semantic search. Connection credentials are AES-GCM encrypted with `ENCRYPTION_KEY`.

### Drives and versions

Paths start with a drive: `/team/...` is shared, `/me/...` is private. Every write adds a version with its author, the agent client that made it and a commit message. Reads return the latest version unless a `version` is passed. Writes take an optional `baseVersion` and fail with a conflict instead of overwriting newer work. Promoting a private doc onto an existing team doc makes it that doc's next version.

### Roles

- Admin: everything, including deleting team files, managing people and removing connections.
- Member: everything except destructive actions.
- Read-only: reads the team drive and calls read-only connection tools.

### Connections

Admins and members connect upstream MCP servers or HTTP APIs once for the workspace (`src/server/services/connections.ts`). Their tools appear to agents as `<slug>__<tool>`. Credentials can be shared or per user, and access can be limited by role, by person and by tool.

## Agent skills

`skills/` holds the skills that teach agents to use Brainspace. `bun run skills:build` regenerates `skills/brainspace/references/tools.md` from the tool definitions and packages everything into `public/`:

- Claude Code plugin (skills plus MCP server): `/plugin marketplace add https://usebrain.space/marketplace.json`, then `/plugin install brainspace@brainspace`
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

Secrets live in the Worker (`wrangler secret put`): `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`.

### Running your own copy

1. Create the Cloudflare resources and put their IDs in `wrangler.jsonc` (`account_id`, the D1 `database_id`, and your domain under `routes`):
   ```sh
   wrangler d1 create brainspace
   wrangler r2 bucket create brainspace-files
   wrangler vectorize create brainspace-chunks --dimensions=768 --metric=cosine
   wrangler vectorize create-metadata-index brainspace-chunks --property-name=workspaceId --type=string
   wrangler vectorize create-metadata-index brainspace-chunks --property-name=driveId --type=string
   wrangler r2 bucket lifecycle add brainspace-files expire-tmp-results tmp/results/ --expire-days 1
   ```
2. Set `APP_URL` and `EMAIL_FROM` in `wrangler.jsonc`, and change `APP` in `scripts/build-skills.mjs` to your domain.
3. For Google sign-in, create an OAuth web client in Google Cloud with the redirect URI `https://<your domain>/api/auth/callback/google`. Skip it to use email links only.
4. Verify your sending domain in Resend.
5. Set the secrets, then `bun run deploy`.
