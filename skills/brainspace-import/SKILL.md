---
name: brainspace-import
description: Use when the user wants to bring what their agent already knows into Brainspace, says "import my CLAUDE.md", "move my skills to Brainspace", "put our notes in the brain", or has just connected Brainspace to a workspace that already has content. Finds local instructions files, skills and notes, proposes where each piece goes, and files it after one approval.
---

# Import what the agent already knows

People arrive with knowledge spread across their agent setup: a global CLAUDE.md or AGENTS.md, project instructions, skills they wrote, notes folders. Most of it belongs in Brainspace, where every agent and teammate can use it. Your job is to find it, sort it and file it, with one approval from the user.

Nothing leaves the machine before the user approves the plan.

## 1. Look around (read only)

Call `whoami` first for the workspace, your role and the skills that already exist. Then look for these, skipping anything that doesn't exist:

- Global instructions: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`
- Instructions for the current project: `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, `.github/copilot-instructions.md`
- Skills the person wrote: `~/.claude/skills/`, `~/.agents/skills/`, `~/.cursor/skills/`, and `.claude/skills/` in the project. Leave out skills that came from an installer or plugin, including the `brainspace-*` skills.
- Anything the user points you at, such as a notes or docs folder.

Don't read `.env` files, key files, shell history, browser data or anything that looks like credentials.

## 2. Sort it

Split the content into pieces, one topic each. For every piece decide:

- **Team knowledge** (company facts, product details, how the team does a job, brand and voice, decisions): proposed for `/team`, in the folder that fits (`/team/company/`, `/team/brand/`, `/team/projects/<name>/`).
- **Personal** (the user's own preferences, writing style, tool habits, notes about their machine): goes to `/me`.
- **Workflows**: a skill. Use `/me/skills/<name>/SKILL.md` and follow the `brainspace-skills` skill for the format.
- **Leave out**: anything specific to one machine or repo (paths, build commands, local ports), duplicates of what's already in Brainspace, and anything that looks like a secret, token, password or private customer data.

`search` Brainspace for each topic before proposing a new doc. If a doc already covers it, propose an edit to that doc instead.

## 3. Propose one plan

Show the user a short table: each piece, where it would go (full path, new doc or edit), and what you're leaving out and why. Ask once for approval. They can drop or move items.

## 4. File it

- Write everything to `/me` first, including the team pieces, as drafts with a `description` and a commit `message` such as "Imported from ~/.claude/CLAUDE.md".
- `promote` the team pieces only after the user has approved sharing them. Promoting onto an existing team doc adds a version, so read it first and merge carefully.
- Don't change or delete the local files. If the user wants, offer to replace a moved section of their local instructions with one line pointing at the Brainspace doc, and show the change before making it.

## 5. Report

List every doc you created or edited with its full path, what's still in `/me` waiting to be promoted, and what you left out.
