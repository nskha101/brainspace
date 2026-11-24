import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { handleRaw } from './server/http'
import { handleExtractBatch, type ExtractMessage } from './server/services/extract'
import { runDueSchedules } from './server/services/flows'

export { WorkspaceLive } from './server/live'
// Folder databases: each one is a SQLite database in its own Durable Object.
export { BrainDatabase } from './server/databases/object'
// Flows: the Workflow class, the sandbox's bindings back into Brainspace, and
// the library class that tags workflow instances (must be a top-level export).
export { FlowWorkflow, FlowBrain, FlowOutbound } from './server/flows/runtime'
export { DynamicWorkflowBinding } from '@cloudflare/dynamic-workflows'
// Bots: each bot is an agent that schedules itself, and its subagents are child agents.
export { BrainBot, BrainBotWorker } from './server/bots/agent'

const entry = createServerEntry({
  async fetch(request) {
    const raw = await handleRaw(request)
    if (raw) return raw
    return handler.fetch(request)
  },
})

export default {
  fetch: entry.fetch,
  // Text extraction jobs (PDF, Word...) run here, with retries and no 30-second limit.
  async queue(batch: MessageBatch<ExtractMessage>) {
    await handleExtractBatch(batch)
  },
  // Every minute: start flow schedules that are due.
  async scheduled(controller: ScheduledController) {
    await runDueSchedules(new Date(controller.scheduledTime))
  },
}
