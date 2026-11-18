---
name: brainspace-skills
description: Use when creating, improving or sharing a team skill (playbook) in Brainspace, or when the user asks to "make this a skill", "turn this into a playbook" or "teach the agents how we do X".
---

# Team skills in Brainspace

A skill is a folder holding a `SKILL.md`. It teaches any agent how this team does one job. Team skills live in `/team/skills/`, private ones in `/me/skills/`. Agents discover them with `skills_list` and load them with `skill_get`. MCP clients that support prompts also see each skill as a prompt.

## Layout

```
/team/skills/<skill-name>/SKILL.md      required
/team/skills/<skill-name>/examples.md   optional supporting docs
/team/skills/<skill-name>/template.md   optional
```

Use lowercase-hyphenated names: `sales-follow-up`, `weekly-metrics-report`.

## SKILL.md format

```markdown
---
name: weekly-metrics-report
description: Use when asked for the weekly metrics update. Pulls numbers from PostHog and writes the report in our format.
---

# Weekly metrics report

1. Call posthog__... for signups, activation and retention over the last 7 days.
2. Compare with the previous week.
3. Write the report using /team/skills/weekly-metrics-report/template.md.
4. Append it to /team/reports/weekly.md.
```

The `description` decides whether an agent picks the skill, so say when to use it, not just what it is. Start with "Use when...".

## Writing a good skill

- Steps an agent can follow, in order. Name exact paths and tool names.
- Point to source docs (`/team/brand/voice.md`) instead of copying their content, so the skill stays current when the doc changes.
- Say what "done" looks like and what to check before finishing.
- Keep it under a page. Move long examples into supporting files.

## Creating one

1. `skills_list` to make sure it doesn't already exist. If it does, improve that one with `edit`.
2. Draft in `/me/skills/<name>/SKILL.md` unless the user wants it shared right away.
3. Try it on a real task if you can, and fix the steps that were unclear.
4. `promote` it to `/team/skills/<name>` when the user is happy.

## Private overrides

If `/me/skills/<name>` and `/team/skills/<name>` both exist, `skill_get` returns the private one. People can use this to try a change before promoting it.
