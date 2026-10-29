import { PRODUCT_BRAND } from '@/lib/brand'
import { escapeHtml } from '@/lib/escape-html'
import { brandedEmailHtml, emailButton } from '@/lib/email-layout'

const DEFAULT_FROM = `${PRODUCT_BRAND.wordmark} <noreply@ashbi.ca>`
const DEFAULT_DOMAIN = 'ashbi.ca'

export type MailTransportState = 'configured' | 'off' | 'unavailable'

/**
 * Mail is a provider integration, not a Cloudflare public endpoint.  The
 * Worker-compatible transport uses fetch and a secret binding/env value; it
 * never logs message bodies or treats an absent provider as successful send.
 */
export function mailTransportState(env: Record<string, string | undefined> = process.env): MailTransportState {
  if (env.MAIL_TRANSPORT === 'off') return 'off'
  if (env.MAIL_PROVIDER && env.MAIL_PROVIDER !== 'mailgun') return 'unavailable'
  return env.MAILGUN_API_KEY ? 'configured' : 'off'
}

export function isMailConfigured(): boolean {
  return mailTransportState() === 'configured'
}

export async function sendMail(options: {
  to: string
  subject: string
  html: string
  text: string
  /** Opt-in household delivery can bound its transport to a membership lock. */
  signal?: AbortSignal
}): Promise<void> {
  const apiKey = process.env.MAILGUN_API_KEY
  const domain = process.env.MAILGUN_DOMAIN || DEFAULT_DOMAIN
  const from = process.env.MAILGUN_FROM || process.env.FROM_EMAIL || DEFAULT_FROM

  const state = mailTransportState()
  if (state === 'off' || !apiKey) throw new Error('MAILGUN_API_KEY is not set')
  if (state === 'unavailable') throw new Error('MAIL_TRANSPORT_UNAVAILABLE')

  // btoa is available in Workers and Node 22. Mailgun API keys are ASCII
  // tokens, so no Node Buffer/polyfill is needed in the edge bundle.
  const auth = globalThis.btoa(`api:${apiKey}`)
  const response = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    ...(options.signal ? { signal: options.signal } : {}),
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    }),
  })

  if (!response.ok) {
    // Provider response bodies can contain recipient/message data. Keep the
    // error identity useful to callers without exposing that data in logs.
    if (response.body) await response.body.cancel().catch(() => {})
    throw new Error(`Mailgun failed (${response.status})`)
  }
}

export function familyInviteEmail(options: {
  familyName: string
  inviterName: string
  role: string
  joinUrl: string
}): { subject: string; html: string; text: string } {
  const familyName = escapeHtml(options.familyName)
  const inviterName = escapeHtml(options.inviterName)
  const role = escapeHtml(options.role)
  const subject = `${options.inviterName} invited you to ${options.familyName} on ${PRODUCT_BRAND.wordmark}`
  const html = brandedEmailHtml([
    `<p>Hi,</p>`,
    `<p>${inviterName} invited you to join <strong>${familyName}</strong> as a <strong>${role}</strong>.</p>`,
    `<p>${emailButton(options.joinUrl, 'Join family')}</p>`,
    `<p>Or copy this link: ${escapeHtml(options.joinUrl)}</p>`,
    `<p>This invite expires in 48 hours. If you were not expecting this, you can ignore it.</p>`,
  ].join('\n'))
  const text = [
    `${options.inviterName} invited you to join ${options.familyName} as a ${options.role}.`,
    `Join: ${options.joinUrl}`,
    'This invite expires in 48 hours.',
  ].join('\n')
  return { subject, html, text }
}

/**
 * Morning summary email (O-40). Every user-controlled value (name, chore and
 * event titles, dinner) is escaped in the HTML part. Ends with the plain
 * "Turn this off" line and a link to where the switch lives.
 */
export function morningSummaryEmail(options: {
  name: string
  dayLabel: string
  lines: readonly string[]
  todayUrl: string
  settingsUrl: string
  /** Where the switch is, in words, e.g. "Settings → Notifications". */
  settingsLabel: string
}): { subject: string; html: string; text: string } {
  const firstName = options.name.trim().split(/\s+/)[0] || 'there'
  const subject = `Your day: ${options.dayLabel}`
  const html = [
    `<p>Good morning, ${escapeHtml(firstName)}.</p>`,
    `<p>Here is ${escapeHtml(options.dayLabel)}:</p>`,
    '<ul>',
    ...options.lines.map((line) => `<li>${escapeHtml(line)}</li>`),
    '</ul>',
    `<p><a href="${escapeHtml(options.todayUrl)}">Open Today</a></p>`,
    `<p style="color:#6b7280;font-size:13px;">Turn this off in ${escapeHtml(options.settingsLabel)}: <a href="${escapeHtml(options.settingsUrl)}">${escapeHtml(options.settingsUrl)}</a></p>`,
  ].join('\n')
  const text = [
    `Good morning, ${firstName}.`,
    '',
    `Here is ${options.dayLabel}:`,
    ...options.lines.map((line) => `- ${line}`),
    '',
    `Open Today: ${options.todayUrl}`,
    '',
    `Turn this off in ${options.settingsLabel}: ${options.settingsUrl}`,
  ].join('\n')
  return { subject, html, text }
}
