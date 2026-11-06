---
name: stale-doc-review
description: Lists team docs nobody has touched in a while, so the owners can update or archive them.
inputs:
  folder:
    type: string
    description: Folder to review
    default: /team
  older_than_days:
    type: number
    default: 90
outputs:
  report:
    type: markdown
    description: Stale docs grouped by folder, with a suggested action for each
uses:
  read: [/team]
  ai: true
---

# Stale doc review

Walks a folder of the team space and finds docs not updated in N days. For
each one it reads the start of the doc and suggests whether to update, merge
or archive it.

Schedule it monthly and deliver it to `/team/reports/stale-docs.md` with
mode `version`, so the report keeps one history.
