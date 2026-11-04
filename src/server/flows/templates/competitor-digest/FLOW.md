---
name: competitor-digest
description: Weekly digest of what competitors shipped and announced, written in the team's voice.
inputs:
  competitors:
    type: string[]
    description: Competitor names or domains, like linear.app
    required: true
  since_days:
    type: number
    description: How far back to look
    default: 7
outputs:
  report:
    type: markdown
    description: One section per competitor, newest news first
uses:
  connections: [context]
  read: [/team]
  write: []
  ai: true
---

# Competitor digest

For each competitor, searches recent news with Context.dev and reads anything
the team already wrote about them. Then writes one digest with a section per
competitor and a short "what this means for us" at the end.

Good destinations: a new doc per week in `/team/research/digests/{date}.md`,
plus a Slack message with the link.

Needs the Context.dev connection.
