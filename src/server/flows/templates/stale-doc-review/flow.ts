import { defineFlow } from 'brainspace'

export default defineFlow(async ({ inputs, step, brain, ai, log }) => {
  const listing = await step.do('list docs', () => brain.list(inputs.folder, { depth: 10, limit: 2000 }))

  const cutoff = Date.now() - inputs.older_than_days * 86_400_000
  const stale = listing.entries.filter((e) => e.kind === 'doc' && e.updatedAt < cutoff).slice(0, 40)
  log(`${stale.length} docs older than ${inputs.older_than_days} days`)

  if (stale.length === 0) {
    return { report: `Nothing in ${inputs.folder} is older than ${inputs.older_than_days} days.` }
  }

  const docs = await step.do('read stale docs', () => brain.readMany(stale.map((d) => d.path)))

  const report = await step.do('write report', () =>
    ai.write({
      task:
        'For each doc, give its path, when it was last updated, a one-line summary, and a suggestion: update, merge into another doc, or archive. ' +
        'Group by folder. Keep it scannable.',
      context: docs.map((d) => ({ path: d.path, updatedAt: new Date(d.updatedAt).toISOString().slice(0, 10), start: String(d.content ?? '').slice(0, 1500) })),
    }),
  )

  return { report }
})
