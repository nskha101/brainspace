import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { handleRaw } from './server/http'
import { handleExtractBatch, type ExtractMessage } from './server/services/extract'

export { WorkspaceLive } from './server/live'

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
}
