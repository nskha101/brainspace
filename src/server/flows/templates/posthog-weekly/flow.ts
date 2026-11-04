import { defineFlow } from 'brainspace'

export default defineFlow(async ({ inputs, step, connections, ai }) => {
  const rows: unknown[] = []
  for (const event of inputs.events) {
    const result = await step.do(`count ${event}`, () =>
      connections.call('posthog', 'exec', {
        command: `query run-sql --sql "select countIf(timestamp >= now() - interval 7 day) as this_week, countIf(timestamp < now() - interval 7 day) as last_week from events where event = '${event.replace(/'/g, '')}' and timestamp >= now() - interval 14 day"`,
      }),
    )
    rows.push({ event, result })
  }

  const report = await step.do('write update', () =>
    ai.write({
      task: 'Write a weekly metrics update. For each event give this week, last week and the % change, then two or three sentences on what stands out.',
      context: rows,
    }),
  )

  return { report }
})
