---
name: hubspot-pipeline
description: Pipeline review from HubSpot, flagging deals that have gone quiet or are past their close date.
inputs:
  stale_days:
    type: number
    description: A deal counts as quiet after this many days without activity
    default: 14
outputs:
  report:
    type: markdown
    description: Deals that need attention, grouped by owner
uses:
  connections: [hubspot]
  ai: true
---

# HubSpot pipeline review

Pulls open deals from HubSpot and flags the ones with no activity in N days
or a close date in the past. Groups them by owner with a suggested next step.

Needs the HubSpot connection. If the tool names differ in your connection,
find them with `connection_tools` and adjust flow.ts.
