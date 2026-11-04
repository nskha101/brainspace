---
name: meeting-actions
description: Turns meeting notes into owned action items, asks for approval, then adds them to the team's action list.
inputs:
  notes:
    type: markdown
    description: The meeting notes or transcript
    required: true
  meeting:
    type: string
    description: Meeting name, like "Weekly growth sync"
    required: true
outputs:
  actions:
    type: json
    description: The action items that were added
uses:
  write: [/team/meetings]
  read: [/team/meetings]
  ai: true
---

# Meeting actions

Pulls action items (task, owner, due date) out of meeting notes, waits for a
person to approve the list, then appends it to
`/team/meetings/action-items.md`.

Run it from an agent right after a meeting, or point a meeting tool's
webhook at it.
