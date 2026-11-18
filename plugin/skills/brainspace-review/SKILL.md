---
name: brainspace-review
description: Use when the user asks what changed in Brainspace, wants a digest of recent edits, suspects an agent broke or overwrote a doc, or asks to clean up the brain (duplicates, stale docs, missing descriptions). Covers reading activity, diffing versions and rolling back safely.
---

# Review and tidy the brain

Every change in Brainspace is versioned and logged with who made it and which agent client did it. That makes review cheap. Rollback never destroys anything, because it adds a new version.

## What changed

1. `activity` with a `limit` (and `pathPrefix` to narrow it, e.g. `/team/brand`). Each entry shows who, through which client (web or a named agent), the action and the path.
2. `recent` lists the most recently changed docs and files.
3. For each doc worth looking at, `history` shows its versions and messages, and `diff` with `from` set to the version before the change shows exactly what changed.

When you report, group by doc, say who changed it and why (from the commit message), and quote the meaningful part of the diff. Skip noise like whitespace.

## Rolling back

If a change was wrong:

1. `diff` to confirm which version was last good.
2. Ask the user before rolling back someone else's work in `/team`.
3. `restore_version` with that version and a `message` explaining why ("Revert v7: agent dropped the pricing table").
4. If only part of the change was bad, `read` the good version with `version`, then `edit` the current doc to bring back just that part.

Deleted docs are in `trash_list`. `trash_restore` brings them back with their history.

## Tidying

Look for these and fix or report them:

- Near-duplicates (`voice.md` and `voice-v2.md`, or two docs on the same topic). Merge into one with `edit`, then move the other to `/team/archive/`. Only admins can delete from `/team`.
- Docs and assets without a `description`. Add one with `describe`.
- Placeholder or `TODO:` lines that are still open. List them for the user.
- Skills whose description doesn't start with "Use when". Fix the frontmatter so agents can pick them.

Make one change per commit, with a message that says what and why, so the history stays readable.
