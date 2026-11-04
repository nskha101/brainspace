import { defineFlow } from 'brainspace'

export default defineFlow(async ({ inputs, step, brain, connections, ai, run }) => {
  // run.startedAt stays the same when the flow resumes, unlike Date.now().
  const from = run.startedAt - inputs.since_days * 86_400_000
  const findings: unknown[] = []

  for (const competitor of inputs.competitors) {
    const isDomain = /\.[a-z]{2,}$/i.test(competitor)
    const news = await step.do(`news: ${competitor}`, () =>
      connections.call('context', 'get-news-search', {
        ...(isDomain ? { domain: competitor } : { companyName: competitor }),
        sortBy: 'newest',
        limit: 15,
        filterBy: { date: { from, to: run.startedAt } },
      }),
    )
    const notes = await step.do(`our notes: ${competitor}`, () => brain.search(competitor, { limit: 3 }))
    findings.push({ competitor, news, notes })
  }

  const report = await step.do('write digest', () =>
    ai.write({
      task:
        `Write a competitor digest covering the last ${inputs.since_days} days. ` +
        'One section per competitor with the notable launches, pricing changes and announcements, each with its source link. ' +
        'Skip competitors with nothing new and say so in one line. End with a short "What this means for us".',
      context: findings,
    }),
  )

  return { report }
})
