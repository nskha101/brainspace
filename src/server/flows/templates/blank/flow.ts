import { defineFlow } from 'brainspace'

export default defineFlow(async ({ inputs, step, brain, ai }) => {
  const notes = await step.do('find notes', () => brain.search(inputs.topic, { limit: 5 }))

  const report = await step.do('write report', () =>
    ai.write({ task: `Write a short brief about ${inputs.topic}.`, context: notes }),
  )

  return { report }
})
