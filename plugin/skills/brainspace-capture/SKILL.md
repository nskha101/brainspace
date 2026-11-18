---
name: brainspace-capture
description: Use when the user says "remember this", "save this to the brain", "add this to our docs", or when a session produced a decision, process or fact the team will need again. Files the knowledge into the right Brainspace doc instead of losing it in chat.
---

# Capture knowledge into Brainspace

The goal is one good home per fact. A decision recorded in three places will drift. Recorded in none, it gets lost.

## Steps

1. Decide what's worth keeping. Decisions and the reason behind them, processes, customer facts, numbers, and naming all qualify. Chit-chat and dead ends don't.
2. `search` for where it belongs. Look for an existing doc on the topic in `/team` first, then `/me`.
3. Pick the destination:
   - It updates an existing doc: `read` it, then `edit` the relevant section. Keep the doc's structure.
   - It's a new topic: `write` a new doc in the folder that fits (`/team/company/`, `/team/projects/<project>/`, `/team/brand/`). Give it a `description`.
   - It's half-baked or personal: write it to `/me/` and tell the user they can `promote` it later.
4. Write it plainly. Lead with the fact or decision, then the why, then the date and who decided if known.
5. Leave a commit `message` that says what was captured.
6. Tell the user where it went, with the full path.

## Decision log format

For `/team/projects/<project>/decisions.md`, use `append`:

```markdown
## 2026-11-03: Use usage-based pricing for the API tier
Decided by: Priya, Sam
Why: seat pricing punished teams with many occasional users.
Instead of: flat $499/month.
```

## Don't

- Don't paste whole chat transcripts. Summarize.
- Don't save secrets, credentials or personal data about customers beyond what the team already stores.
- Don't write to `/team` when the user asked to keep it private.
