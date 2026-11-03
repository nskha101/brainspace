import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { handleRaw } from './server/http'

export default createServerEntry({
  async fetch(request) {
    const raw = await handleRaw(request)
    if (raw) return raw
    return handler.fetch(request)
  },
})
