---
name: brainspace
description: Use whenever the Brainspace MCP server is connected and a task touches company knowledge, such as brand kit, voice, docs, project notes, team skills or connected tools like HubSpot and PostHog. Covers how to find, read, write, version and share things in the team brain.
---

# Brainspace

Brainspace is the team's shared brain. It holds docs and files in two spaces, versions every change, and routes tools from connected services (HubSpot, PostHog, Context.dev and others) through one MCP server. You can do almost everything through tools. People rarely need to open the app.

## First call

Call `whoami` once per session. It tells you the workspace, your role, what that role allows, which skills exist and which connections are live. Don't guess any of that.

## Paths

Every path starts with a space:

- `/team/...` is the shared space. Everyone in the workspace reads it. Members and admins edit it.
- `/me/...` is the personal space of whoever you're acting for. Nobody else sees it.

`/team/brand/voice.md` and `/me/drafts/launch-email.md` are typical. A path without an extension becomes a markdown doc. Folders are created for you on write.

## Before you write

1. `search` for the topic. Hybrid search covers meaning and keywords across both spaces.
2. If a doc exists, `read` it and note its `version`.
3. Update it rather than creating `voice-v2.md` or `voice-new.md`. Versions already keep the history.

## Changing docs

- `edit` applies exact find-and-replace edits to the latest version. Use it for most changes. Copy `oldText` exactly from what you read.
- `write` replaces the whole doc. Pass `baseVersion` (the version you read) so you don't overwrite someone else's change. A version conflict means: re-read, merge, retry.
- `append` adds to the end, which suits logs and running notes.
- Always pass a short `message`, like a commit message: "Add Q4 pricing tiers", not "update".
- Set `description` on new docs. It shows up in listings and search and helps the next agent pick the right file.

## Versions

Versioning works like git for every doc and file, logos included. Each write is a new version with its author, time, the agent that made it and the message. Everyone gets the latest version by default, so when someone promotes a new brand kit, the next agent that reads `/team/brand/brand-kit.md` gets the new one.

- `history` lists versions.
- `read` with `version` checks out an older one without changing anything.
- `diff` shows what changed between two versions.
- `restore_version` makes an old version current by adding a new version on top. Nothing is lost.

## Private to team

Draft in `/me`, then share:

- `promote` puts a private doc or folder into `/team`. If nothing exists at the team path, it moves there with its history. If a team doc already exists there, yours becomes its next version, and the old one stays in history. Folders merge file by file.
- To revise a team doc privately: `copy` it into `/me`, note the team version you started from, edit, then `promote` with `baseVersion` set to that version. If someone changed the team doc meanwhile you get a `conflict`. `diff` the two and merge before promoting.

Ask the user before promoting unless they told you to share it. Promoting publishes it to the whole team.

## Deleting

`delete` moves things to the trash. `trash_list` and `trash_restore` bring them back. Only admins can delete from `/team`. If you're a member and something in `/team` should go away, move it to `/team/archive/` or tell the user an admin needs to delete it.

## Roles

- admin: full control, including deleting team files, managing members and roles, and removing connections.
- member: everything except destructive actions.
- viewer: read-only. Write tools are hidden.

If a tool returns `forbidden`, don't try to work around it. Tell the user what role is needed.

## Skills

Team playbooks live at `/team/skills/<name>/SKILL.md`. Private ones live at `/me/skills/`. At the start of a task, check `skills_list` (or the list from `whoami`). If one matches, load it with `skill_get` and follow it. It encodes how this team does that job.

## Connections

Connected services show up as tools named `<slug>__<tool>`, for example `hubspot__search_crm_objects`. You can also call any connection tool with `connection_call`. `connections_list` shows what's connected and any agent instructions per connection. See the `brainspace-connections` skill for adding new ones.

## Files

- A file at a public URL: `upload` with `url`. Brainspace fetches it, which is how you pull in logos from a website.
- A file on your machine: `upload_link` with the target path, then run the `forAgents` curl command it returns. The bytes go straight to storage, up to 95 MB, without passing through the conversation. Don't base64 local files into `upload`.
- A file the user has: `upload_link`, then give them the `url`. It opens a page where they drop files or whole folders, no sign-in needed. Add a `note` saying what you need. Check `upload_link_status` to see what arrived, then `read` or `describe` it.
- Target a folder with a trailing slash (`/team/brand/assets/`) or name an exact file path (`/me/contracts/msa.pdf`). Uploading to an existing path adds a new version.

PDF, Word, PowerPoint, Excel, RTF, OpenDocument and EPUB files get their text extracted by Context.dev right after upload. `read` returns that text (PDF pages are marked `<!-- page N -->`, so you can cite pages) along with the download link, `search` finds them by content, and `offset`/`limit` page through long ones. If `read` says extraction failed, the workspace needs a Context.dev connection with an API key. Then run `extract_text`.

`read` on any binary file returns a download URL that is valid for an hour. Describe assets with `describe` ("Primary logo, dark backgrounds, SVG") so other agents can pick the right one.

## Flows

Flows are small programs the team runs on demand, on a schedule or from a webhook: a weekly competitor digest, meeting notes turned into action items, a daily summary of new contracts. Each one is a folder at `/team/flows/<name>` or `/me/flows/<name>` with `FLOW.md` and `flow.ts`. `flows_list` shows them, `flow_run` runs one, and runs waiting for a person's approval show up in `whoami`. When the user wants something to happen automatically or repeatedly, follow the `brainspace-flows` skill.

## Errors

Errors come back as JSON with `error`, `message` and usually a `hint`. Follow the hint. Common ones:

- `conflict`: the doc changed since you read it. Re-read and merge.
- `not_found`: check the path starts with `/team/` or `/me/`, or `search` for it.
- `forbidden`: your role can't do this. Tell the user.

## Keep it clean

- One topic per doc. Link related docs by full path.
- Never store secrets in docs. Credentials belong in connections.
- Don't create files just to report what you did. Answer the user instead.

## More detail

- Every tool with its arguments and who can call it is in [references/tools.md](references/tools.md).
- Related skills cover specific jobs:
  - `brainspace-setup` fills in a new workspace.
  - `brainspace-capture` saves decisions and facts from a session.
  - `brainspace-review` digests recent changes and rolls back bad edits.
  - `brainspace-skills` writes team playbooks.
  - `brainspace-brand-kit` handles logos, colors and fonts.
  - `brainspace-connections` connects services like HubSpot and PostHog.
  - `brainspace-flows` writes, tests, schedules and debugs flows.
  - `brainspace-admin` manages people, roles and API keys.
