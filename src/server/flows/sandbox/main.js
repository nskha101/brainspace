// Entry module of every flow's Dynamic Worker. Brainspace injects this file,
// sdk.js and the compiled flow.js; flow code never sees this wiring.
import { WorkflowEntrypoint } from 'cloudflare:workers'
import flow from './flow.js'
import { __runFlow } from './sdk.js'

export class FlowRunner extends WorkflowEntrypoint {
  async run(event, step) {
    return __runFlow(flow, this.env, event, step)
  }
}

export default {
  fetch() {
    return new Response('Brainspace flow', { status: 404 })
  },
}
