import { Marked } from 'marked'
import { appUrl, getEnv } from './env'
import { setupPrompt } from '../lib/agent-links'

type Email = { to: string; subject: string; html: string; text: string }
export type EmailMessage = Omit<Email, 'to'>

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

// ------------------------------------------------------------------ design
//
// Every email Brainspace sends goes through renderEmail(), so they all share
// one look: the logo, a white card on the app's paper background, an optional
// label above the title, then blocks. Each block renders both HTML and plain
// text, so the text part always says the same thing as the HTML part.
//
// Email clients ignore <style> unevenly, so everything is inline styles and
// tables. The colours and fonts are the app's (src/styles.css).

const C = {
  paper: '#f6f5f8',
  sheet: '#ffffff',
  ink: '#1a1820',
  ink2: '#4a4655',
  ink3: '#807b8c',
  line: '#e4e1ea',
  wash: '#eeecf2',
  brand: '#d6246e',
  brandInk: '#a8124f',
  brandWash: '#fbe8f0',
  agent: '#0f7b83',
  agentWash: '#e3f3f3',
  danger: '#c2341b',
  dangerWash: '#fbe9e5',
}
const SANS = `'Hanken Grotesk',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif`
const MONO = `'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`

export type Tone = 'brand' | 'agent' | 'danger' | 'neutral'
const TONE: Record<Tone, { fg: string; bg: string }> = {
  brand: { fg: C.brandInk, bg: C.brandWash },
  agent: { fg: C.agent, bg: C.agentWash },
  danger: { fg: C.danger, bg: C.dangerWash },
  neutral: { fg: C.ink2, bg: C.wash },
}

export type Block = { html: string; text: string }

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const P = `margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.ink2}`

/** A paragraph of plain text. Line breaks are kept. */
export function paragraph(text: string, opts: { muted?: boolean } = {}): Block {
  const style = opts.muted ? `${P};font-size:13px;color:${C.ink3}` : P
  return { html: `<p style="${style}">${esc(text).replace(/\n/g, '<br>')}</p>`, text }
}

/**
 * The main call to action. The full link is printed under the button too,
 * for clients that strip buttons or block the click.
 */
export function button(href: string, label: string): Block {
  const a = esc(href)
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px"><tr><td bgcolor="${C.brand}" style="border-radius:8px;background:${C.brand}"><a href="${a}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px">${esc(label)}</a></td></tr></table>
<p style="margin:0 0 20px;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.ink3}">Button not working? Open this link:<br><a href="${a}" target="_blank" style="color:${C.brandInk};text-decoration:underline;word-break:break-all">${a}</a></p>`,
    text: `${label}: ${href}`,
  }
}

/** A boxed block: an error, a prompt to paste, a quote from a flow. */
export function panel(text: string, opts: { mono?: boolean; tone?: Tone } = {}): Block {
  const t = TONE[opts.tone ?? 'neutral']
  const font = opts.mono ? `font-family:${MONO};font-size:12.5px` : `font-family:${SANS};font-size:14px`
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr><td style="background:${opts.tone ? t.bg : C.paper};border:1px solid ${opts.tone ? t.bg : C.line};border-radius:8px;padding:12px 14px;${font};line-height:1.55;color:${opts.tone ? t.fg : C.ink};white-space:pre-wrap;word-break:break-word">${esc(text)}</td></tr></table>`,
    text: text
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n'),
  }
}

/** Label and value rows, like "Flow: Weekly digest". */
export function facts(rows: [label: string, value: string][]): Block {
  const shown = rows.filter(([, v]) => v)
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid ${C.line}">${shown
      .map(
        ([k, v]) =>
          `<tr><td valign="top" style="padding:9px 12px 9px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:13px;color:${C.ink3};white-space:nowrap;width:1%">${esc(k)}</td><td valign="top" style="padding:9px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:14px;color:${C.ink}">${esc(v)}</td></tr>`,
      )
      .join('')}</table>`,
    text: shown.map(([k, v]) => `${k}: ${v}`).join('\n'),
  }
}

/** A bulleted list of plain-text items. */
export function bullets(items: string[]): Block {
  return {
    html: `<ul style="margin:0 0 16px;padding-left:22px;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.ink2}">${items.map((i) => `<li style="margin:0 0 4px">${esc(i)}</li>`).join('')}</ul>`,
    text: items.map((i) => `- ${i}`).join('\n'),
  }
}

// Markdown from flows. Raw HTML is shown as text, and only http(s) and
// mailto links become links, so a flow's output can't restyle the email or
// slip in a javascript: link.
const md = new Marked({ gfm: true, breaks: true, async: false })
const safeHref = (href: string) => (/^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : null)
md.use({
  renderer: {
    html: (t) => ('block' in t && t.block ? `<p style="${P}">${esc(t.text.trim())}</p>\n` : esc(t.text)),
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens)
      const url = safeHref(href)
      return url ? `<a href="${esc(url)}" target="_blank" style="color:${C.brandInk};text-decoration:underline">${label}</a>` : label
    },
    image({ href, text }) {
      const url = safeHref(href)
      return url ? `<img src="${esc(url)}" alt="${esc(text)}" style="max-width:100%;height:auto;border-radius:6px">` : esc(text)
    },
    codespan: ({ text }) =>
      `<code style="font-family:${MONO};font-size:13px;background:${C.wash};border-radius:4px;padding:1px 5px;color:${C.ink}">${esc(text)}</code>`,
    code: ({ text }) =>
      `<pre style="margin:0 0 16px;background:${C.paper};border:1px solid ${C.line};border-radius:8px;padding:12px 14px;font-family:${MONO};font-size:12.5px;line-height:1.55;color:${C.ink};white-space:pre-wrap;word-break:break-word">${esc(text)}</pre>`,
  },
})
const MD_STYLES: [RegExp, string][] = [
  [/<p>/g, `<p style="${P}">`],
  [/<h([1-6])>/g, `<h$1 style="margin:24px 0 10px;font-family:${SANS};font-size:17px;line-height:1.35;font-weight:600;color:${C.ink}">`],
  [/<(ul|ol)( start="\d+")?>/g, `<$1$2 style="margin:0 0 16px;padding-left:22px;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.ink2}">`],
  [/<li>/g, '<li style="margin:0 0 4px">'],
  [/<blockquote>/g, `<blockquote style="margin:0 0 16px;padding:2px 0 2px 14px;border-left:3px solid ${C.line}">`],
  [/<table>/g, `<table cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;font-family:${SANS};font-size:14px">`],
  [/<(th|td)( align="\w+")?>/g, `<$1$2 style="border:1px solid ${C.line};padding:6px 10px;text-align:left;color:${C.ink}">`],
  [/<hr>/g, `<hr style="border:0;border-top:1px solid ${C.line};margin:20px 0">`],
  [/<strong>/g, `<strong style="color:${C.ink}">`],
]

export function markdown(source: string): Block {
  let html = md.parse(source) as string
  for (const [re, to] of MD_STYLES) html = html.replace(re, to)
  return { html, text: source }
}

export function renderEmail(m: {
  subject: string
  /** Shown after the subject in the inbox list. */
  preheader?: string
  /** A small label above the title. */
  label?: { text: string; tone?: Tone }
  title: string
  blocks: Block[]
  /** Why they got this email, in the footer. */
  reason?: string
}): EmailMessage {
  const base = appUrl()
  const host = base.replace(/^https?:\/\//, '')
  const t = TONE[m.label?.tone ?? 'brand']
  const label = m.label
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px"><tr><td style="background:${t.bg};border-radius:999px;padding:4px 10px;font-family:${SANS};font-size:12px;font-weight:600;line-height:1.2;color:${t.fg}">${esc(m.label.text)}</td></tr></table>`
    : ''
  const pre = m.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(m.preheader)}${'&#8204;&nbsp;'.repeat(60)}</div>`
    : ''
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${esc(m.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:${C.paper};-webkit-font-smoothing:antialiased">${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.paper}" style="background:${C.paper}"><tr><td align="center" style="padding:32px 16px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="padding:0 4px 18px"><a href="${esc(base)}" target="_blank" style="text-decoration:none"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding-right:9px"><img src="${esc(base)}/email/logo.png" width="26" height="26" alt="" style="display:block;border:0;border-radius:6px"></td><td valign="middle" style="font-family:${SANS};font-size:16px;font-weight:600;letter-spacing:-0.01em;color:${C.ink}">brainspace</td></tr></table></a></td></tr>
<tr><td bgcolor="${C.sheet}" style="background:${C.sheet};border:1px solid ${C.line};border-radius:12px;padding:32px 32px 16px">
${label}<h1 style="margin:0 0 14px;font-family:${SANS};font-size:21px;line-height:1.3;font-weight:600;letter-spacing:-0.015em;color:${C.ink}">${esc(m.title)}</h1>
${m.blocks.map((b) => b.html).join('\n')}
</td></tr>
<tr><td style="padding:20px 4px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.ink3}">${m.reason ? `${esc(m.reason)}<br>` : ''}Brainspace, your team's shared brain · <a href="${esc(base)}" target="_blank" style="color:${C.ink3};text-decoration:underline">${esc(host)}</a></td></tr>
</table></td></tr></table></body></html>`
  const text = [m.title, ...m.blocks.map((b) => b.text), `--\n${m.reason ? `${m.reason}\n` : ''}Brainspace · ${base}`].join('\n\n')
  return { subject: m.subject, html, text }
}

// ------------------------------------------------------------------ emails

export function magicLinkEmail(url: string): EmailMessage {
  return renderEmail({
    subject: 'Your Brainspace sign-in link',
    preheader: 'The link works once, for the next 10 minutes.',
    title: 'Sign in to Brainspace',
    blocks: [paragraph('Use the button below to sign in. The link works once, for the next 10 minutes.'), button(url, 'Sign in')],
    reason: "Someone asked to sign in with this email address. If it wasn't you, ignore this email.",
  })
}

export function inviteEmail(opts: { url: string; workspace: string; inviter: string; role: string }): EmailMessage {
  const prompt = setupPrompt(appUrl())
  const role = opts.role === 'viewer' ? 'a read-only member' : opts.role === 'admin' ? 'an admin' : 'a member'
  return renderEmail({
    subject: `${opts.inviter} invited you to ${opts.workspace} on Brainspace`,
    preheader: `Join ${opts.workspace} as ${role}.`,
    label: { text: 'Invitation' },
    title: `Join ${opts.workspace} on Brainspace`,
    blocks: [
      paragraph(`${opts.inviter} invited you to the ${opts.workspace} workspace as ${role}.`),
      paragraph("Brainspace is your team's shared brain: docs, brand kit and skills that your AI agents can read and update."),
      button(opts.url, 'Accept invite'),
      paragraph(
        'Or start from your AI agent. Paste this into Claude Code, Codex, Cursor or another coding agent, and sign in with this email address when it asks:',
        { muted: true },
      ),
      panel(prompt, { mono: true }),
    ],
    reason: `You got this because ${opts.inviter} invited this email address.`,
  })
}

export function flowOutputEmail(opts: { subject: string; flowName: string; body: string; runUrl: string }): EmailMessage {
  return renderEmail({
    subject: opts.subject,
    label: { text: opts.flowName, tone: 'agent' },
    title: opts.subject,
    blocks: [markdown(opts.body || '_The flow returned nothing._'), button(opts.runUrl, 'See the run')],
    reason: `The ${opts.flowName} flow sent this to you.`,
  })
}

export function approvalEmail(opts: { flowName: string; title: string; summary?: string; url: string }): EmailMessage {
  return renderEmail({
    subject: `Approval needed: ${opts.title}`,
    preheader: `${opts.flowName} is waiting for you.`,
    label: { text: 'Approval needed', tone: 'brand' },
    title: opts.title,
    blocks: [
      paragraph(`${opts.flowName} is paused until you approve or reject this step.`),
      ...(opts.summary ? [panel(opts.summary)] : []),
      button(opts.url, 'Review it'),
    ],
    reason: `You got this because ${opts.flowName} runs as you.`,
  })
}

export function flowFailedEmail(opts: { flowName: string; error?: string | null; url: string }): EmailMessage {
  return renderEmail({
    subject: `Flow failed: ${opts.flowName}`,
    preheader: (opts.error ?? '').slice(0, 120),
    label: { text: 'Flow failed', tone: 'danger' },
    title: `${opts.flowName} failed`,
    blocks: [...(opts.error ? [panel(opts.error, { mono: true, tone: 'danger' })] : []), button(opts.url, 'See the run')],
    reason: `You got this because ${opts.flowName} runs as you.`,
  })
}

export function flowPausedEmail(opts: { triggerName: string; reason: string; url: string }): EmailMessage {
  return renderEmail({
    subject: `Flow paused: ${opts.triggerName}`,
    label: { text: 'Flow paused', tone: 'danger' },
    title: `${opts.triggerName} is paused`,
    blocks: [paragraph(opts.reason), button(opts.url, 'Review it')],
    reason: `You got this because ${opts.triggerName} runs as you.`,
  })
}

export function flowChangedEmail(opts: {
  editor: string
  flowName: string
  newAccess: string[]
  problem?: string | null
  runsNote?: string
  url: string
}): EmailMessage {
  return renderEmail({
    subject: `${opts.editor} changed ${opts.flowName}`,
    label: { text: 'Flow changed', tone: 'agent' },
    title: `${opts.editor} changed ${opts.flowName}`,
    blocks: [
      ...(opts.newAccess.length ? [paragraph('It now has more access:'), bullets(opts.newAccess)] : []),
      ...(opts.problem != null ? [paragraph("It has a problem and won't run until that's fixed:"), panel(opts.problem, { mono: true, tone: 'danger' })] : []),
      ...(opts.runsNote ? [paragraph(opts.runsNote)] : []),
      button(opts.url, 'See the flow'),
    ],
    reason: 'You got this because you can see this team flow, or one of its triggers runs as you.',
  })
}
