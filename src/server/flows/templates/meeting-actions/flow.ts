import { defineFlow } from 'brainspace'

type Item = { task: string; owner: string; due: string }

export default defineFlow(async ({ inputs, step, brain, ai, approve }) => {
  const { items } = await step.do('extract action items', () =>
    ai.extract<{ items: Item[] }>({
      task: 'List every action item. Owner is the person responsible, or "unassigned". Due is a date like 2026-05-01, or "none".',
      input: inputs.notes,
      schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { task: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' } },
            },
          },
        },
      },
    }),
  )

  if (items.length === 0) return { actions: [] }

  const list = items.map((i) => `- [ ] ${i.task} (${i.owner}, due ${i.due})`).join('\n')
  const decision = await approve({
    title: `Add ${items.length} action items from ${inputs.meeting}`,
    summary: 'Check owners and dates before they go on the team list.',
    preview: list,
  })
  if (!decision.approved) return { actions: [] }

  await step.do('append to action list', () =>
    brain.append('/team/meetings/action-items.md', `\n## ${inputs.meeting}\n\n${list}\n`, { message: `Action items from ${inputs.meeting}` }),
  )

  return { actions: items }
})
