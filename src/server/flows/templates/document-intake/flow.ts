import { defineFlow } from 'brainspace'

const PARSEABLE = /\.(pdf|docx?|pptx?|xlsx?|odt|rtf)$/i

export default defineFlow(async ({ inputs, step, brain, ai, log }) => {
  const listing = await step.do('list folder', () => brain.list(inputs.folder, { depth: 5 }))
  const since = Date.now() - inputs.since_hours * 3_600_000
  const fresh = listing.entries.filter((e) => e.kind === 'file' && PARSEABLE.test(e.name) && e.updatedAt >= since)
  log(`${fresh.length} new or changed documents`)

  const done: string[] = []
  for (const file of fresh.slice(0, 20)) {
    const summary = await step.do(`summarize ${file.name}`, async () => {
      const doc = await brain.read(file.path)
      if (doc.text?.status !== 'done') return null
      const text = await ai.write({
        task: 'Summarize this document for the team: what it is, who it involves, key terms, dates, amounts and anything that needs action. Use short sections.',
        context: (doc.text.content ?? '').slice(0, 150_000),
      })
      await brain.write(`${file.path}.summary.md`, `# ${file.name}\n\n${text}`, { message: `Summary of ${file.name}` })
      return text.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? ''
    })
    if (summary !== null) done.push(`- ${file.path}: ${summary}`)
  }

  return { report: done.length ? done.join('\n') : `No new documents in ${inputs.folder}.` }
})
