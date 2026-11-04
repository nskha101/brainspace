---
name: my-flow
description: What this flow does, in one sentence.
inputs:
  topic:
    type: string
    description: What to work on
    required: true
outputs:
  report:
    type: markdown
    description: The result
uses:
  read: [/team]
  write: []
  connections: []
  network: []
  ai: true
---

# My flow

Explain what the flow does, when to run it, and where its results should go.
People read this page to decide whether to use the flow.
