---
name: posthog-weekly
description: Weekly product metrics write-up from PostHog, compared with the week before.
inputs:
  events:
    type: string[]
    description: Event names to report on, like signed_up or project_created
    required: true
outputs:
  report:
    type: markdown
    description: The metrics write-up
uses:
  connections: [posthog]
  read: [/team]
  ai: true
---

# PostHog weekly

Pulls weekly counts for the events you list from PostHog (this week and last
week), then writes a short update: what moved, by how much, and what might
explain it.

Needs the PostHog connection. If your PostHog MCP server names its query
tool differently, find it with `connection_tools` and change the tool name
in flow.ts.
