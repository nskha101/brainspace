import { getEnv } from './env'

type Email = { to: string; subject: string; html: string; text: string }

export async function sendEmail(email: Email): Promise<boolean> {
  const env = getEnv()
  if (!env.RESEND_API_KEY || /localhost|127\.0\.0\.1/.test(env.APP_URL)) {
    console.log(`[email] RESEND_API_KEY missing. Would send to ${email.to}:\n${email.text}`)
    return false
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, ...email }),
  })
  if (!res.ok) {
    console.error('[email] resend failed', res.status, await res.text())
    return false
  }
  return true
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function layout(body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f6f5f1;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1b19">
<div style="max-width:480px;margin:40px auto;background:#fff;border:1px solid #e7e4dc;border-radius:12px;padding:32px">
<div style="font-weight:700;font-size:15px;letter-spacing:-0.01em;margin-bottom:24px">brainspace</div>
${body}
</div></body></html>`
}

function button(href: string, label: string) {
  return `<a href="${esc(href)}" style="display:inline-block;background:#1c1b19;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">${esc(label)}</a>`
}

export function magicLinkEmail(url: string): Omit<Email, 'to'> {
  return {
    subject: 'Your Brainspace sign-in link',
    text: `Sign in to Brainspace: ${url}\n\nThe link expires in 10 minutes. If you didn't ask for it, ignore this email.`,
    html: layout(
      `<p style="font-size:15px;line-height:1.5;margin:0 0 20px">Click below to sign in. The link expires in 10 minutes.</p>${button(url, 'Sign in to Brainspace')}<p style="font-size:13px;color:#6f6b62;margin:24px 0 0">If you didn't ask for this, ignore it.</p>`,
    ),
  }
}

export function inviteEmail(opts: {
  url: string
  workspace: string
  inviter: string
  role: string
}): Omit<Email, 'to'> {
  const line = `${opts.inviter} invited you to the ${opts.workspace} workspace on Brainspace as ${opts.role === 'viewer' ? 'a read-only member' : `an ${opts.role === 'admin' ? 'admin' : 'member'}`}.`
  return {
    subject: `${opts.inviter} invited you to ${opts.workspace} on Brainspace`,
    text: `${line}\n\nAccept: ${opts.url}`,
    html: layout(
      `<p style="font-size:15px;line-height:1.5;margin:0 0 8px">${esc(line)}</p><p style="font-size:14px;line-height:1.5;color:#6f6b62;margin:0 0 20px">Brainspace is your team's shared brain: docs, brand kit and skills your AI agents can read and update.</p>${button(opts.url, 'Accept invite')}`,
    ),
  }
}
