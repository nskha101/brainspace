import { invalid } from '../errors'
import { SECRET_NAME } from './manifest'

/**
 * How a webhook trigger checks that a request really came from the service it
 * is for. Without one, anyone who has the URL can start a run with any body.
 * `secret` is the name of a saved secret; its value never leaves the server.
 */
export type WebhookVerify = {
  scheme: 'slack' | 'github' | 'stripe' | 'hmac' | 'header'
  /** Name of the saved secret holding the signing secret (or, for `header`, the expected value). */
  secret: string
  /** hmac and header: which request header carries the signature or the value. */
  header?: string
}

export const VERIFY_SCHEMES = {
  slack: "Slack's signature (X-Slack-Signature), made with the app's signing secret. Requests older than five minutes are refused.",
  github: "GitHub's signature (X-Hub-Signature-256), made with the webhook's secret.",
  stripe: "Stripe's signature (Stripe-Signature), made with the endpoint's signing secret (whsec_...). Requests older than five minutes are refused.",
  hmac: 'An HMAC-SHA256 of the raw body in the header you name, as hex or base64, with or without a "sha256=" prefix.',
  header: 'The secret itself in the header you name, on its own or after "Bearer ".',
} as const

/** Signed requests older than this are refused, so a captured one can't be sent again later. */
const MAX_AGE_SECONDS = 300

export function parseVerify(input: unknown): WebhookVerify {
  const v = (input ?? {}) as Record<string, unknown>
  const scheme = String(v.scheme ?? '') as WebhookVerify['scheme']
  if (!(scheme in VERIFY_SCHEMES)) throw invalid(`"${String(v.scheme)}" isn't a way to check a webhook.`, `Use one of: ${Object.keys(VERIFY_SCHEMES).join(', ')}.`)
  const secret = String(v.secret ?? '').trim().toUpperCase()
  if (!SECRET_NAME.test(secret)) {
    throw invalid('verify.secret is the name of a saved secret, like SLACK_SIGNING_SECRET.', 'Save the signing secret first (Settings → Secrets, or secret_set with hosts: []), then pass its name. Never pass the value here.')
  }
  const needsHeader = scheme === 'hmac' || scheme === 'header'
  const header = String(v.header ?? '').trim().toLowerCase()
  if (needsHeader && !/^[a-z0-9][a-z0-9-]*$/.test(header)) throw invalid(`The ${scheme} check needs verify.header, the request header to read, like "x-signature".`)
  return needsHeader ? { scheme, secret, header } : { scheme, secret }
}

export function describeVerify(v: WebhookVerify) {
  const what = { slack: "Slack's signature", github: "GitHub's signature", stripe: "Stripe's signature", hmac: `the signature in ${v.header}`, header: `the ${v.header} header` }[v.scheme]
  return `Checks ${what} with ${v.secret}`
}

const enc = new TextEncoder()

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const base64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

/** Compares without stopping at the first difference, so timing says nothing about how much matched. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const fresh = (seconds: number, now: number) => Number.isFinite(seconds) && Math.abs(now / 1000 - seconds) <= MAX_AGE_SECONDS

/**
 * Checks one request. `raw` is the body exactly as it arrived, before any
 * parsing: every scheme signs those bytes. Returns null when it passes, or why
 * it didn't.
 */
export async function verifyWebhook(v: WebhookVerify, secret: string, raw: string, headers: Headers, now = Date.now()): Promise<string | null> {
  if (!secret) return 'the secret is empty'
  switch (v.scheme) {
    case 'slack': {
      const ts = headers.get('x-slack-request-timestamp') ?? ''
      const given = headers.get('x-slack-signature') ?? ''
      if (!ts || !given) return 'no Slack signature on the request'
      if (!fresh(Number(ts), now)) return 'the request is more than five minutes old'
      return same(`v0=${hex(await hmac(secret, `v0:${ts}:${raw}`))}`, given) ? null : "the signature doesn't match"
    }
    case 'github': {
      const given = headers.get('x-hub-signature-256') ?? ''
      if (!given) return 'no X-Hub-Signature-256 header on the request'
      return same(`sha256=${hex(await hmac(secret, raw))}`, given.toLowerCase()) ? null : "the signature doesn't match"
    }
    case 'stripe': {
      const parts = (headers.get('stripe-signature') ?? '').split(',').map((p) => p.trim().split('='))
      const t = parts.find(([k]) => k === 't')?.[1] ?? ''
      const sigs = parts.filter(([k]) => k === 'v1').map(([, s]) => s ?? '')
      if (!t || !sigs.length) return 'no Stripe-Signature header on the request'
      if (!fresh(Number(t), now)) return 'the request is more than five minutes old'
      const want = hex(await hmac(secret, `${t}.${raw}`))
      return sigs.some((s) => same(want, s)) ? null : "the signature doesn't match"
    }
    case 'hmac': {
      const given = (headers.get(v.header!) ?? '').trim().replace(/^sha256=/i, '')
      if (!given) return `no ${v.header} header on the request`
      const mac = await hmac(secret, raw)
      return same(hex(mac), given.toLowerCase()) || same(base64(mac), given) ? null : "the signature doesn't match"
    }
    case 'header': {
      const given = (headers.get(v.header!) ?? '').trim().replace(/^Bearer\s+/i, '')
      if (!given) return `no ${v.header} header on the request`
      return same(secret, given) ? null : "the value doesn't match"
    }
  }
}
