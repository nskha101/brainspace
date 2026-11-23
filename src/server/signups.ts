import { APIError } from 'better-auth/api'
import { count } from 'drizzle-orm'
import { getDb, user } from './db'
import { background, getEnv } from './env'

export const DOMAIN_NOT_ALLOWED = 'EMAIL_DOMAIN_NOT_ALLOWED'

export type SignupVia = 'Google' | 'email link'

/** Email domains that may sign in. Empty means anyone can. */
export function allowedDomains(): string[] {
  return (getEnv().ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
}

export function isAllowedEmail(email: string): boolean {
  const domains = allowedDomains()
  if (!domains.length) return true
  const domain = email.trim().toLowerCase().split('@').pop() ?? ''
  return domains.includes(domain)
}

/**
 * Stops sign-ins from outside the allowed domains and tells the team in Slack.
 * Better Auth turns the thrown error into the login form's error message, or
 * into `?error=EMAIL_DOMAIN_NOT_ALLOWED` on the Google callback redirect.
 */
export function assertAllowedEmail(email: string, via: SignupVia, name?: string) {
  if (isAllowedEmail(email)) return
  const domains = allowedDomains()
  background(postAlert(`Blocked a Brainspace sign-in from ${who(email, name)} via ${via}. Only ${domains.join(', ')} accounts can sign in.`))
  throw new APIError('FORBIDDEN', {
    code: DOMAIN_NOT_ALLOWED,
    message: `Brainspace is only open to ${domains.map((d) => `@${d}`).join(', ')} accounts right now.`,
  })
}

/**
 * Stops one person or one address from being sent a flood of sign-in emails.
 * Both limiters are Cloudflare rate-limit bindings (per minute, per location).
 */
export async function assertMagicLinkAllowed(email: string, ip: string | null) {
  const env = getEnv()
  const checks = [env.MAGIC_LINK_EMAIL_LIMIT.limit({ key: email.trim().toLowerCase() })]
  if (ip) checks.push(env.MAGIC_LINK_IP_LIMIT.limit({ key: ip }))
  const results = await Promise.all(checks)
  if (results.every((r) => r.success)) return
  throw new APIError('TOO_MANY_REQUESTS', {
    message: 'Too many sign-in links were requested. Wait a minute and try again.',
  })
}

/** Which sign-in created the account, from the auth endpoint that ran. */
export function signupVia(path: string | undefined): SignupVia | undefined {
  if (!path) return undefined
  if (path.includes('magic-link')) return 'email link'
  if (path.startsWith('/callback') || path.startsWith('/sign-in/social')) return 'Google'
  return undefined
}

/** Tells the team in Slack that someone new signed up. */
export function notifySignup(u: { email: string; name?: string | null }, via?: SignupVia) {
  background(
    (async () => {
      const [row] = await getDb().select({ n: count() }).from(user)
      const n = row?.n ?? 0
      const total = n ? ` That's ${n.toLocaleString('en-US')} ${n === 1 ? 'person' : 'people'} so far.` : ''
      await postAlert(`New Brainspace sign-up: ${who(u.email, u.name)}${via ? ` via ${via}` : ''}.${total}`)
    })(),
  )
}

const slackEsc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

function who(email: string, name?: string | null) {
  return name?.trim() ? `${slackEsc(name.trim())} (${slackEsc(email)})` : slackEsc(email)
}

async function postAlert(text: string) {
  const env = getEnv()
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_ALERT_CHANNEL) {
    console.log(`[signups] Slack not configured. ${text}`)
    return
  }
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel: env.SLACK_ALERT_CHANNEL, text, unfurl_links: false }),
  })
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
  if (!body?.ok) console.error('[signups] slack post failed', res.status, body?.error, text)
}
