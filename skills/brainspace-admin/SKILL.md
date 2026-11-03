---
name: brainspace-admin
description: Use when managing a Brainspace workspace, such as inviting people, changing roles, removing members, creating or revoking API keys, setting up a new workspace, or connecting a new agent client (Claude Code, Cursor, Claude.ai) to Brainspace.
---

# Running a Brainspace workspace

## Roles

| Role | Can |
| --- | --- |
| admin | Everything: delete team files, manage members and roles, remove connections, restrict connection access. |
| member | Read and edit everything, promote, upload, add connections, invite members and viewers. No destructive actions. |
| viewer | Read the team drive and use read-only connection tools. |

Every workspace keeps at least one admin.

## People

- `members_list` shows members, roles and pending invites.
- `member_invite` with `{ email, role }` emails an invite and returns its URL. Leave out `email` to get a join link anyone can use for 14 days. Share that carefully.
- `member_set_role` with `{ member: "sam@acme.com", role: "viewer" }` changes a role (admin only).
- `member_remove` removes someone and revokes their API keys. Their private drive stays in case they come back.
- `invite_revoke` cancels a pending invite.
- `workspace_auto_join` with `{ enabled: true, role: "member" }` lets anyone who signs in with a verified email on the admin's company domain (e.g. @acme.com) join without an invite. People already using Brainspace on that domain are added right away. Public domains like gmail.com are refused.

Confirm with the user before removing anyone or downgrading an admin.

## Agent access

There are two ways to connect an agent:

1. OAuth (best for people). Point the MCP client at `https://usebrain.space/mcp`. It opens a browser to sign in.
   - Claude Code: `claude mcp add --transport http brainspace https://usebrain.space/mcp`
   - Cursor or VS Code: add an HTTP MCP server with that URL.
   - Claude.ai: Settings → Connectors → Add custom connector → that URL.
   - Claude Cowork: download https://usebrain.space/brainspace.plugin, upload it under Customize → Plugins → Upload plugin, then connect Brainspace from the plugin's Connectors tab.
2. API key (best for scripts and headless agents). `api_key_create` returns a `bs_...` key once. Send it as `Authorization: Bearer bs_...`. The key acts as the user who made it, in one workspace, with their role.

`api_keys_list` and `api_key_revoke` manage keys. Admins can see and revoke everyone's.

## Workspaces

- `workspaces_list` and `workspace_switch` handle people in more than one workspace. OAuth sessions follow the default workspace. API keys stay in their own.
- `workspace_create` makes a new workspace with starter folders.

## Install the agent skills

These skills ship with Brainspace and teach any agent how to use it.

- Claude Code: `/plugin marketplace add https://usebrain.space/marketplace.json`, then `/plugin install brainspace@brainspace`. That adds the MCP server and the skills together.
- Claude Cowork and Claude.ai: upload https://usebrain.space/brainspace.plugin under Customize → Plugins → Upload plugin, then connect Brainspace from the plugin's Connectors tab.
- Codex, Cursor, Gemini CLI and most other agents: `npx skills add https://usebrain.space`.
- Anything with a shell: `curl -fsSL https://usebrain.space/install.sh | sh` installs into `~/.claude/skills` and `~/.agents/skills`.

Agents that don't support skills still see them as MCP prompts once the server is connected.
