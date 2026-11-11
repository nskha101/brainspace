// The `brainspace` module flows import. Runs inside the sandbox: no secrets,
// no network except hosts the flow declares, and every call into Brainspace
// goes through env.BRAIN with this run's signed token.

import { NonRetryableError } from 'cloudflare:workflows'

const FATAL = 'BRAINSPACE_FATAL: '
let active = null

/** Wrap the flow function. `export default defineFlow(async (ctx) => { ... })` */
export function defineFlow(fn) {
  if (typeof fn !== 'function') throw new Error('defineFlow needs a function: defineFlow(async ({ inputs, step }) => { ... })')
  return { __brainspaceFlow: true, run: fn }
}

/**
 * A placeholder for a secret (an API key) declared in uses.secrets. Put it in
 * a fetch URL, header or body; Brainspace swaps in the real value on the way
 * out, and only for the hosts the secret is bound to. Flow code never sees it.
 */
export function secret(name) {
  if (typeof name !== 'string' || !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(name)) {
    throw new Error(`secret("${name}"): secret names are UPPER_SNAKE_CASE, like WEATHER_API_KEY.`)
  }
  return `__bs_secret_${name}__`
}

function current() {
  if (!active) throw new Error('Brainspace calls only work while a flow is running.')
  return active
}

function cleanError(err) {
  const msg = String((err && err.message) || err)
  return msg.replace(/^Error: /, '')
}

function preview(value) {
  if (value === undefined || value === null) return null
  let s
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    s = String(value)
  }
  return s.length > 400 ? s.slice(0, 399) + '…' : s
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'approval'
}

export async function __runFlow(def, env, event, step) {
  const fn = typeof def === 'function' ? def : def && def.run
  if (typeof fn !== 'function') throw new Error('flow.ts must `export default defineFlow(async ({ inputs, step }) => { ... })`.')
  const payload = event.payload || {}
  const token = payload.token
  const B = env.BRAIN
  let inStep = 0
  const counts = new Map()

  const call = async (op, args) => {
    try {
      return await B.call(token, op, args)
    } catch (err) {
      const msg = cleanError(err)
      if (msg.includes(FATAL)) throw new NonRetryableError(msg.slice(msg.indexOf(FATAL) + FATAL.length))
      throw new Error(msg)
    }
  }
  const needStep = (what) => {
    if (inStep <= 0) {
      throw new Error(
        `${what} must run inside step.do(...). Steps run once and their results are saved; code outside steps runs again every time the flow resumes.`,
      )
    }
  }
  const stepName = (name) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Every step needs a name, like step.do("fetch news", async () => ...).')
    const n = (counts.get(name) || 0) + 1
    counts.set(name, n)
    return n === 1 ? name : `${name} (${n})`
  }

  const wrappedStep = {
    do(name, a, b) {
      const fn = typeof a === 'function' ? a : b
      const config = typeof a === 'function' ? undefined : a
      if (typeof fn !== 'function') throw new Error(`step.do("${name}") needs a function to run.`)
      const label = stepName(name)
      const body = async () => {
        inStep++
        await call('step', { name: label, status: 'running' })
        try {
          const result = await fn()
          await call('step', { name: label, status: 'done', preview: preview(result) })
          return result === undefined ? null : result
        } catch (err) {
          await call('step', { name: label, status: 'failed', error: cleanError(err) })
          throw err
        } finally {
          inStep--
        }
      }
      return config ? step.do(label, config, body) : step.do(label, body)
    },
    async sleep(name, duration) {
      const label = stepName(name)
      await call('sleep', { name: label, duration: typeof duration === 'number' ? duration : String(duration) })
      return step.sleep(label, duration)
    },
    async sleepUntil(name, when) {
      const label = stepName(name)
      const at = when instanceof Date ? when.getTime() : new Date(when).getTime()
      await call('sleep', { name: label, until: at })
      return step.sleepUntil(label, when)
    },
  }

  const brain = {
    read: (path, opts) => (needStep('brain.read'), call('read', { path, ...(opts || {}) })),
    readMany: (paths) => (needStep('brain.readMany'), call('readMany', { paths })),
    list: (path, opts) => (needStep('brain.list'), call('list', { path, ...(opts || {}) })),
    search: (query, opts) => (needStep('brain.search'), call('search', { query, ...(opts || {}) })),
    write: (path, content, opts) => (needStep('brain.write'), call('write', { path, content, ...(opts || {}) })),
    edit: (path, edits, opts) => (needStep('brain.edit'), call('edit', { path, edits, ...(opts || {}) })),
    append: (path, text, opts) => (needStep('brain.append'), call('append', { path, text, ...(opts || {}) })),
    upload: (path, data, opts) => (needStep('brain.upload'), call('upload', { path, data, ...(opts || {}) })),
    skill: (name) => (needStep('brain.skill'), call('skill', { name })),
  }

  const connections = {
    call: (connection, tool, args) => (needStep('connections.call'), call('connectionCall', { connection, tool, args: args || {} })),
    tools: (connection, query) => (needStep('connections.tools'), call('connectionTools', { connection, query })),
  }

  const ai = {
    write: (opts) => (needStep('ai.write'), call('ai', { op: 'write', ...normalize(opts, 'task') })),
    extract: (opts) => (needStep('ai.extract'), call('ai', { op: 'extract', ...normalize(opts, 'input') })),
    classify: (opts) => (needStep('ai.classify'), call('ai', { op: 'classify', ...normalize(opts, 'input') })),
    chat: (opts) => (needStep('ai.chat'), call('ai', { op: 'chat', ...normalize(opts, 'prompt') })),
  }

  const log = (message, data) => {
    call('log', { level: 'info', message: String(message), data: data === undefined ? null : data }).catch(() => {})
  }
  log.warn = (message, data) => call('log', { level: 'warn', message: String(message), data: data ?? null }).catch(() => {})
  log.error = (message, data) => call('log', { level: 'error', message: String(message), data: data ?? null }).catch(() => {})

  const approve = async ({ title, summary, preview: show, timeout } = {}) => {
    if (!title) throw new Error('approve() needs a title, like approve({ title: "Publish the digest" }).')
    const key = slug(title)
    const label = stepName(`approval: ${title}`)
    await wrappedStep.do(`ask: ${title}`, () =>
      call('approvalRequest', { key, title, summary: summary ?? null, preview: preview(show) && (typeof show === 'string' ? show : JSON.stringify(show, null, 2)), timeout: timeout || '7 days' }),
    )
    try {
      const ev = await step.waitForEvent(label, { type: `approval-${key}`, timeout: timeout || '7 days' })
      const p = (ev && ev.payload) || {}
      return { approved: !!p.approved, by: p.by ?? null, note: p.note ?? null, timedOut: false }
    } catch {
      await wrappedStep.do(`expired: ${title}`, () => call('approvalExpired', { key }))
      return { approved: false, by: null, note: null, timedOut: true }
    }
  }

  /**
   * Run another flow and wait for it. Durable like approve(): it records its own
   * steps, so call it on its own, never inside step.do(). Returns the child's
   * outputs, or throws if the child fails or is cancelled.
   */
  const flows = {
    async run(name, inputs) {
      if (inStep > 0) {
        throw new Error('flows.run() must not go inside step.do(...). Call it on its own line, like approve(): it saves its own result.')
      }
      if (typeof name !== 'string' || !name.trim()) {
        throw new Error('flows.run needs a flow name, like flows.run("competitor-digest", { competitors: ["linear.app"] }).')
      }
      if (inputs !== undefined && (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs))) {
        throw new Error(`flows.run("${name}", inputs): inputs must be an object of the flow's inputs.`)
      }
      const label = stepName(`flow: ${name}`)
      const started = await step.do(label, { retries: { limit: 5, delay: '30 seconds', backoff: 'exponential' } }, async () => {
        await call('step', { name: label, kind: 'flow', status: 'running' })
        try {
          return await call('flowStart', { flow: name, inputs: inputs || {}, key: label })
        } catch (err) {
          await call('step', { name: label, kind: 'flow', status: 'failed', error: cleanError(err) })
          throw err
        }
      })
      const readResult = async () => {
        const res = await call('flowResult', { runId: started.runId })
        if (res.done) {
          const ok = res.status === 'succeeded'
          await call('step', {
            name: label,
            kind: 'flow',
            status: ok ? 'done' : 'failed',
            error: ok ? null : `${name} ${res.status}${res.error ? `: ${res.error}` : ''}`,
            preview: ok ? preview(res.outputs) : null,
          })
        }
        return res
      }
      let result
      for (let round = 1; ; round++) {
        const suffix = round > 1 ? ` #${round}` : ''
        if (!started.finished) {
          // The child wakes us when it ends. A day-long timeout is only a fallback check.
          try {
            await step.waitForEvent(`${label} › wait${suffix}`, { type: `subflow-${started.runId}`.slice(0, 100), timeout: '1 day' })
          } catch {
            // Timed out: check on the child below.
          }
        }
        result = await step.do(`${label} › result${suffix}`, readResult)
        if (result.done) break
      }
      if (result.status !== 'succeeded') {
        throw new Error(`The ${name} flow ${result.status === 'cancelled' ? 'was cancelled' : 'failed'}${result.error ? `: ${result.error}` : ''} (run ${result.runId})`)
      }
      return result.outputs || {}
    },
  }

  active = { token }
  const run = {
    id: event.instanceId,
    test: !!payload.test,
    flow: payload.flow,
    trigger: payload.trigger ?? null,
    startedAt: payload.startedAt,
  }
  const result = await fn({ inputs: payload.inputs || {}, step: wrappedStep, brain, connections, ai, approve, flows, log, run, secret })
  return result === undefined ? null : result
}

function normalize(opts, key) {
  if (typeof opts === 'string') return { [key]: opts }
  return opts || {}
}
