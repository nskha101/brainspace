---
name: brainspace-connections
description: Use when the user wants to connect a service (HubSpot, PostHog, Context.dev, Linear, Notion, GitHub, Stripe or any MCP server or REST API) to Brainspace, give the team or one person access to it, or call a connected tool. Also use when a connection tool fails with an auth error.
---

# Connections

A connection plugs a third-party service into Brainspace once, for the whole team. Brainspace stores the credentials encrypted and proxies the calls, so agents never see the keys.

## Using connected tools

- `connections_list` shows what's connected, its status, and agent instructions per connection. Read those instructions.
- Tools are exposed as `<slug>__<tool>`, for example `posthog__query-run`.
- If a tool isn't exposed directly, use `connection_tools` to see its schema and `connection_call` to run it.
- Viewers only get tools marked read-only.

## Adding a connection

1. `connection_presets` lists known services and the credentials each needs.
2. Ask the user for what's needed. For API-key services that means the key. For OAuth services, nothing up front.
3. Call `connection_add`:
   - API key: `{ presetId: "posthog", token: "phx_..." }`
   - OAuth: `{ presetId: "linear" }`. The result has an `authorizeUrl`. Give it to the user to open. The connection turns active once they approve.
   - Pre-registered OAuth app (HubSpot): `{ presetId: "hubspot", oauthClientId, oauthClientSecret }`, then send the user the `authorizeUrl`.
   - Any MCP server: `{ name, slug, url, token? }`.
   - Any REST API: `{ type: "http", name, slug, url: "https://api.example.com", headers: { "X-Api-Key": "..." } }`. Agents get a single `<slug>__request` tool scoped to that base URL.
4. Add `instructions` saying when agents should use it ("Use for CRM lookups. Never create contacts without asking.").
5. `connection_test` confirms it works and loads the tool list.

## Shared or per person

- `credentialMode: "shared"` (default) means one login used by everyone. It suits analytics and data tools.
- `credentialMode: "per_user"` means each person authorizes their own account and calls run as them. It suits email, calendars and anything personal. Each user runs `connection_authorize` once.

## Who can use it

Admins can limit a connection with `connection_update`:

- `minRole: "member"` hides it from viewers.
- `accessMode: "restricted"` with `allowedUsers: ["sam@acme.com"]` limits it to named people.
- `toolAllowlist` exposes only some tools.
- `readOnlyTools` lists the tools viewers may call.

## When it breaks

- `unauthorized`: for OAuth, run `connection_authorize` and send the user the link. For API keys, ask for a new key and `connection_update` with `token`.
- `upstream`: the service failed. Retry once, then tell the user with the message.

Never paste credentials into docs or chat summaries. They belong only in `connection_add` or `connection_update`.
