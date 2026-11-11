---
title: Set up Brainspace in your AI agent
description: Steps an AI agent follows to connect itself to Brainspace, install the Brainspace skills and get the person started.
source: {{APP}}/setup.md
---

# Set up Brainspace in this agent

You're connecting the person you work with to Brainspace ({{APP}}), their team's shared brain: versioned docs, brand kit, team skills and connected tools, reached over MCP at `{{APP}}/mcp`.

Run the commands yourself. The person only signs in when a browser opens, so tell them before it does. Never ask them to paste a password, token or API key into this chat.

If the person gave you a website or a first task along with this link, keep it for step 6.

## 1. Check what's there

If you already have Brainspace tools (`whoami`, `search`, `read` and so on from a server called brainspace or Brainspace), call `whoami`.

- It works: the connection is done. Install only the skills for your agent (the `npx -y skills add` line in step 2, or nothing for Claude Code with the plugin), then go to step 3.
- It fails with an auth error: the person needs to sign in again. Tell them how for your agent (step 4), then continue.

## 2. Install

Find your agent and follow only its section. If you can't tell which agent you are, ask.

### Claude Code

```sh
claude plugin marketplace add {{APP}}/marketplace.json
claude plugin install brainspace@brainspace --scope user
```

The plugin brings the MCP server and the Brainspace skills together. If the marketplace is already added, run `claude plugin marketplace update brainspace` and install again.

If the `claude` command isn't available to you, install the skills with `npx -y skills add {{APP}} -g -a claude-code -y` and the server with `claude mcp add --transport http --scope user brainspace {{APP}}/mcp` from the person's terminal.

### Codex

```sh
codex mcp add brainspace --url {{APP}}/mcp
npx -y skills add {{APP}} -g -a codex -y
```

Then sign in with `codex mcp login brainspace`, which opens a browser. If your sandbox can't open a browser or reach the network, give the person that command to run in their own terminal.

### Cursor

```sh
npx -y add-mcp {{APP}}/mcp -g -a cursor -n brainspace -y
npx -y skills add {{APP}} -g -a cursor -y
```

### VS Code (GitHub Copilot)

```sh
code --add-mcp '{"name":"brainspace","type":"http","url":"{{APP}}/mcp"}'
npx -y skills add {{APP}} -g -a github-copilot -y
```

If `code` isn't on the path, use `npx -y add-mcp {{APP}}/mcp -g -a vscode -n brainspace -y` instead.

### Gemini CLI, Windsurf, OpenCode, Goose, Zed, Cline and others

```sh
npx -y add-mcp {{APP}}/mcp -g -a <agent> -n brainspace -y
npx -y skills add {{APP}} -g -a <agent> -y
```

Agent ids for add-mcp include `gemini-cli`, `windsurf`, `opencode`, `goose`, `zed`, `cline`, `kiro-cli` and `claude-desktop`. Run `npx -y add-mcp --help` for the full list. If the skills installer doesn't know your agent, skip it: the same skills come through Brainspace itself as MCP prompts.

### Claude app (claude.ai, Desktop, Cowork) or ChatGPT

You can't install anything from a chat app. Give the person this link, which opens Claude's "Add custom connector" dialog with Brainspace filled in. They click Add, then Connect, and sign in:

{{CLAUDE_LINK}}

In ChatGPT, they add `{{APP}}/mcp` as a custom connector in settings (developer mode has to be on).

### No browser sign-in (CI, servers, scripts)

Ask the person to create an API key under Agents at {{APP}}/app/agents and put it in an environment variable such as `BRAINSPACE_API_KEY` themselves. Then configure the server with the header `Authorization: Bearer $BRAINSPACE_API_KEY`, for example:

```sh
claude mcp add --transport http --scope user brainspace {{APP}}/mcp --header "Authorization: Bearer $BRAINSPACE_API_KEY"
```

## 3. Add a short rule to your instructions

Agents use Brainspace more reliably when their instructions file says when to. Show the person this block and ask before you add it:

```md
## Brainspace

Our team's shared knowledge lives in Brainspace (the `brainspace` MCP server): company overview, brand kit, voice, decisions, team skills and connected tools. Call its `whoami` tool before the first Brainspace task in a session. Search Brainspace before writing anything new, follow team skills that match the task, and save decisions and reusable knowledge there instead of in local notes. Draft in /me and ask before sharing to /team.
```

Where it goes:

- Claude Code: `~/.claude/CLAUDE.md`
- Codex: `~/.codex/AGENTS.md`
- Gemini CLI: `~/.gemini/GEMINI.md`
- Cursor and Windsurf have no global file you can edit. Tell the person to paste it into User Rules in the app's settings.
- Anything else: the agent's global instructions file, if it has one.

Append to the file and never replace what's there. Skip this step if the file already has a Brainspace section.

## 4. Restart and sign in

New MCP servers and skills load when the agent starts. Tell the person exactly what to do for their agent, then stop and wait for them to come back:

- Claude Code: type `/reload-plugins` or restart (`claude --continue` resumes this conversation), then run `/mcp`, pick brainspace and sign in.
- Codex: quit and run `codex resume --last`. Sign in with `codex mcp login brainspace` if you haven't.
- Cursor: open Cursor Settings, find brainspace under MCP and sign in when it asks. If the tools don't appear, reload the window.
- VS Code: start the brainspace server from the MCP servers list and sign in when it asks.
- Others: restart the agent and sign in when it asks.

Ask them to say "continue Brainspace setup" when they're back.

## 5. Check it works

Call `whoami` and tell the person which workspace you're in and their role. Their Brainspace welcome page shows "Connected" as soon as this call lands.

- Auth error: they haven't signed in yet, or the sign-in was for another agent. Repeat step 4.
- No workspace: they finish signing up at {{APP}}, create a workspace or accept their invite, then you call `whoami` again.

## 6. Give it a first job

Offer one of these, in this order:

1. If the person gave you a website, or `whoami` returns a `suggestion` that the team space is nearly empty, offer to fill in the workspace from the website. Follow the `brainspace-setup` skill.
2. Otherwise offer to bring in what you already know: instructions files, local skills and notes that belong in the team brain. Follow the `brainspace-import` skill.
3. Or give them a short tour: what's in /team, which team skills exist, which tools are connected.

If a skill isn't loaded in your agent, read it from `{{APP}}/skills/<name>/SKILL.md`, or get it as an MCP prompt from Brainspace.

## 7. Report

Finish with a short list of what's done and what's still pending, such as a restart or a sign-in. Don't mark a step done that you skipped or that failed.
