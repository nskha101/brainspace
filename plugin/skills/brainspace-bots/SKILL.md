---
name: brainspace-bots
description: Use when the user wants an agent to keep doing a job in Brainspace on its own, such as "make a bot that...", "have something check this every morning", "keep this doc up to date", "watch for X and tell me" or "set up a recurring task". Also use to run, pause, change, debug or share an existing bot. Covers writing a bot's instructions, choosing its schedule, model, tools and access, and reading its runs.
---

# Bots in Brainspace

A bot is an agent that Brainspace runs on a schedule. You set it up once: what to do, how often, which model, and what it may touch. From then on it runs on its own, as the person who made it, and reports what it did after every run.

Each run is a fresh agent with the bot's instructions and a set of Brainspace tools. It reads and searches docs, edits them, queries and updates databases, calls connected services, runs flows, and can hand pieces of the job to subagents. Everything it changes is versioned and shows in the activity log under the bot's name.

## Bot or flow?

Both run on a schedule. Pick by how fixed the job is.

- A **flow** is code. The steps are the same every time, each one is durable, and it can wait days for an approval. Use it when the job is a pipeline: fetch these, transform, write there.
- A **bot** is an agent. It reads what's there and decides what to do. Use it when the job needs judgment: "tidy the meeting notes folder", "review new docs against our voice guide", "work out what changed in the pipeline this week and say what matters".

A bot can run flows, so a common setup is a bot that decides and a flow that does the fixed part.

## Creating one

1. Work out the job with the user: what it checks, where the result goes, and what counts as nothing to report.
2. Choose the schedule yourself from what they asked for and tell them what you picked. "Every Monday morning" is `0 9 * * 1` in their timezone. "Keep an eye on" is usually daily or hourly. The minimum gap is 15 minutes, and a bot that runs more often than its job needs wastes model spend. Leave `cron` out for a bot that only runs when asked.
3. Give it the least access that does the job (see below).
4. Call `bot_create`, then `bot_run` once and read the result with `bot_run_get`. Fix the instructions with `bot_update` until a run does what the user wanted.

```
bot_create({
  name: "Monday competitor digest",
  instructions: "Read our notes on each competitor in /team/research/competitors. For each one, search the web connection for what they shipped in the last 7 days. Write a digest to /team/research/digests/<date>.md, one section per competitor, in the voice from /team/brand/voice.md. If a competitor shipped nothing, say so in one line.",
  cron: "0 9 * * 1",
  timezone: "America/New_York",
  paths: { read: ["/team/research", "/team/brand"], write: ["/team/research/digests"] },
  connections: ["exa"]
})
```

## Writing instructions

The bot sees its instructions and nothing from your conversation. Write them the way you would brief a colleague who is new to the team.

- Name the paths: where to read, where to write, and what to call new files.
- Say what done looks like and what to do when there is nothing new. A bot that writes "no changes" to a doc every hour is noise.
- Point at team skills and docs instead of pasting them in. "Follow the brand-voice skill" stays current; pasted rules go stale.
- For jobs that split cleanly, tell it to use subagents ("one subagent per competitor"). Each gets a fresh context and the same access, and up to four run at once.
- Mention what it should remember between runs. A bot has a small memory (the `remember` tool) that it sees at the start of each run, for things like "already reported on these deals".

## Access

A bot acts as its owner and can never do more than they can. On top of that:

- `visibility: "private"` (default): only its owner sees it. It can use `/team` and the owner's `/me`.
- `visibility: "team"`: everyone sees the bot and its runs, and any member can run it. It works in `/team` only, and only with team flows and team skills.
- `paths` narrows what it may read and change. `write` paths can be read too.
- `tools` narrows which tools it has. Leave it out for all of them; a read-only reporter might get `["list","read","read_many","search","db_query","append"]`. `bot_get` lists every tool under `allTools`.
- `connections` narrows which connected services it may call. `[]` means none.
- `model` sets the model (an AI Gateway id that supports tool calling). Leave it out for the workspace default.

Bots can't delete, share, change access or manage the workspace. A bot may run a flow only if everything that flow touches is inside the bot's own paths and connections.

Only the owner can change a bot or add a request to a run, because the bot acts with their access. Admins can pause or delete any team bot.

## Running and checking

- `bots_list` shows every bot you can see with its schedule, next run and last run. `whoami` lists them too and says when one failed.
- `bot_run` starts a run now. The owner can pass `prompt` for a one-off request on top of the instructions.
- `bot_runs` lists runs with each one's summary. `bot_run_get` shows a run step by step: what the bot said, every tool call with its result, and its subagents.
- `bot_run_cancel` stops a run. What it already changed stays; `history` and `restore_version` undo a doc change.
- `bot_update({ bot, enabled: false })` pauses a bot and `enabled: true` resumes it. `bot_delete` removes it with its memory and run history; ask the user first.

When a run goes wrong, read it with `bot_run_get` before changing anything. Most failures are one of these:

- "AI is not set up": an admin needs to add a Vercel AI Gateway key (`workspace_ai`, or Settings → AI).
- A tool error saying the bot isn't allowed somewhere: widen `paths` or `connections`, or fix the instructions so it stays inside them.
- The run ended with "out of time": the job is too big for one run. Narrow it, split it across subagents, or move the fixed part into a flow.
- A bot pauses by itself when its owner leaves the workspace or becomes read-only. `pausedReason` says why.

## Before you schedule or share

Ask the user before creating a bot that runs on a schedule, before making one visible to the team, and before deleting one. Tell them the schedule in plain words, what it may read and change, and which model it uses.
