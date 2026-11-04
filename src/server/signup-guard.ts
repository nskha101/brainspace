import { APIError } from 'better-auth/api'
import { background, getEnv } from './env'

export const DOMAIN_NOT_ALLOWED = 'EMAIL_DOMAIN_NOT_ALLOWED'

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
export function assertAllowedEmail(email: string, via: 'Google' | 'email link', name?: string) {
  if (isAllowedEmail(email)) return
  const domains = allowedDomains()
  background(notifyBlockedSignup(email, via, name))
  throw new APIError('FORBIDDEN', {
    code: DOMAIN_NOT_ALLOWED,
    message: `Brainspace is only open to ${domains.map((d) => `@${d}`).join(', ')} accounts right now.`,
  })
}

const slackEsc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

async function notifyBlockedSignup(email: string, via: string, name?: string) {
  const env = getEnv()
  const who = name?.trim() ? `${slackEsc(name.trim())} (${slackEsc(email)})` : slackEsc(email)
  const text = `Blocked a Brainspace sign-in from ${who} via ${via}. Only ${allowedDomains().join(', ')} accounts can sign in.`
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_ALERT_CHANNEL) {
    console.log(`[signup-guard] Slack not configured. ${text}`)
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
  if (!body?.ok) console.error('[signup-guard] slack post failed', res.status, body?.error)
}
