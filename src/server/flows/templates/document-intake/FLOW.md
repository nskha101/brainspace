---
name: document-intake
description: Summarizes new PDFs and Office files in a folder and saves each summary next to the file.
inputs:
  folder:
    type: string
    description: Folder to watch, like /team/contracts
    required: true
  since_hours:
    type: number
    description: Only files added or changed in this window
    default: 24
outputs:
  report:
    type: markdown
    description: One line per summarized file
uses:
  read: [/team]
  write: [/team]
  ai: true
---

# Document intake

Looks for PDFs, Word, PowerPoint and Excel files that changed recently in a
folder, reads the text Brainspace extracted from them, and writes
`<file>.summary.md` beside each one: what it is, key terms, dates and amounts.

Schedule it daily, or run it after someone drops files in with an upload link.
Narrow `uses` to the folder you point it at.
