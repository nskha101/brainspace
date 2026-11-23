# Brainspace plugin

Adds the Brainspace MCP server (https://usebrain.space/mcp) and these skills:

- brainspace: Use whenever the Brainspace MCP server is connected and a task touches company knowledge, such as brand kit, voice, docs, project notes, team skills or connected tools like HubSpot and PostHog. Covers how to find, read, write, version and share things in the team brain.
- brainspace-admin: Use when managing a Brainspace workspace, such as inviting people, changing roles, removing members, creating or revoking API keys, setting up a new workspace, or connecting a new agent client (Claude Code, Cursor, Claude.ai) to Brainspace.
- brainspace-artifacts: Use when the user wants something to look at or click in Brainspace instead of a doc to read, such as a dashboard, a tracker, a report with charts, a small internal tool, a form over a database, or "make this an artifact". Covers writing the page, reading and updating databases from it, keeping it current with flows, and sharing it with the team.
- brainspace-brand-kit: Use when building or updating the brand kit in Brainspace (logos, colors, fonts, voice), or when producing anything visual or customer-facing that must match the brand. Covers where brand assets live and how to keep them usable by agents.
- brainspace-capture: Use when the user says "remember this", "save this to the brain", "add this to our docs", or when a session produced a decision, process or fact the team will need again. Files the knowledge into the right Brainspace doc instead of losing it in chat.
- brainspace-connections: Use when the user wants to connect a service (HubSpot, PostHog, Context.dev, Google Drive, Linear, Notion, GitHub, Stripe or any MCP server or REST API) to Brainspace, give the team or one person access to it, or call a connected tool. Also use when a connection tool fails with an auth error.
- brainspace-flows: Use when the user wants something in Brainspace to happen automatically or repeatedly, such as "every Monday", "when a webhook fires", "turn this into a flow", "automate this" or "schedule a report". Also use to run, test, approve, debug or share an existing flow. Covers writing flow code, testing it, scheduling it and choosing where results go.
- brainspace-import: Use when the user wants to bring what their agent already knows into Brainspace, says "import my CLAUDE.md", "move my skills to Brainspace", "put our notes in the brain", or has just connected Brainspace to a workspace that already has content. Finds local instructions files, skills and notes, proposes where each piece goes, and files it after one approval.
- brainspace-review: Use when the user asks what changed in Brainspace, wants a digest of recent edits, suspects an agent broke or overwrote a doc, or asks to clean up the brain (duplicates, stale docs, missing descriptions). Covers reading activity, diffing versions and rolling back safely.
- brainspace-setup: Use when a Brainspace workspace is new or mostly empty, or when the user says "set up our brain", "set up Brainspace from our website", "fill in Brainspace" or "onboard our company". Builds the company overview, brand kit, voice guide and first skills from the company's website and the user's answers, then helps invite the team and connect tools.
- brainspace-skills: Use when creating, improving or sharing a team skill (playbook) in Brainspace, or when the user asks to "make this a skill", "turn this into a playbook" or "teach the agents how we do X".

## Install

In Claude (chat, Cowork and the desktop app): Customize > Plugins > Add > Add marketplace, enter `nskha101/brainspace`, add the Brainspace plugin, and turn on Sync automatically for the marketplace so new versions arrive without doing anything.

In Claude Code:

    /plugin install brainspace --marketplace nskha101/brainspace

Then run /mcp and sign in to brainspace. To get new versions without doing anything, open /plugin, go to Marketplaces, pick brainspace and choose Enable auto-update.
