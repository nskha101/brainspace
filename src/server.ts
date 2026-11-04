import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { handleRaw } from './server/http'
import { handleExtractBatch, type ExtractMessage } from './server/services/extract'
import { runDueSchedules } from './server/services/flows'

export { WorkspaceLive } from './server/live'
// Flows: the Workflow class, the sandbox's bindings back into Brainspace, and
// the library class that tags workflow instances (must be a top-level export).
export { FlowWorkflow, FlowBrain, FlowOutbound } from './server/flows/runtime'
export { DynamicWorkflowBinding } from '@cloudflare/dynamic-workflows'

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
