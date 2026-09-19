import { prisma } from './prisma'

/**
 * Transactional email via Mailgun.
 *
 * Config lives in the environment, never in the repo:
 *   MAILGUN_API_KEY   - secret, set on the VPS only (see .env.example)
 *   MAILGUN_DOMAIN    - ashbi.ca
 *   MAILGUN_BASE_URL  - https://api.mailgun.net/v3 (US region)
 *   MAILGUN_FROM      - e.g. "Family Planner <noreply@ashbi.ca>"
 *
 * Sends are best-effort: registration and password reset must never fail
 * because the mail provider was slow or down. But unlike the previous
 * silent-swallow behaviour, failures are surfaced here so a broken mail path
 * is visible in logs instead of silently locking users out.
 */

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text?: string
}

export interface SendEmailResult {
  ok: boolean
  /** Provider message id when accepted. */
  id?: string
  /** Populated when ok is false. */
  error?: string
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN)
}

function fromAddress(): string {
  return process.env.MAILGUN_FROM || 'Family Planner <noreply@ashbi.ca>'
}

/**
 * Send one transactional email. Never throws — returns a result the caller
 * can log. Use `requireEmail` in flows where a send is mandatory.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.MAILGUN_API_KEY
  const domain = process.env.MAILGUN_DOMAIN

  if (!apiKey || !domain) {
    // Dev / pre-config: log the payload so the flow is still testable locally.
    console.warn(
      `[email] Mailgun not configured; would have sent "${input.subject}" to ${input.to}`
    )
    return { ok: false, error: 'email_not_configured' }
  }

  const base = (process.env.MAILGUN_BASE_URL || 'https://api.mailgun.net/v3').replace(/\/+$/, '')
  const url = `${base}/${domain}/messages`

  const form = new URLSearchParams()
  form.set('from', fromAddress())
  form.set('to', input.to)
  form.set('subject', input.subject)
  form.set('html', input.html)
  if (input.text) form.set('text', input.text)

  const auth = Buffer.from(`api:${apiKey}`).toString('base64')

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error(`[email] Mailgun rejected send to ${input.to}: ${res.status} ${detail}`)
      return { ok: false, error: `mailgun_${res.status}` }
    }

    const data = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, id: data?.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[email] Mailgun request failed for ${input.to}: ${message}`)
    return { ok: false, error: message }
  }
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca').replace(/\/+$/, '')
}

function button(href: string, label: string): string {
  return `<p><a href="${href}" style="display:inline-block;background:#3B82F6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">${label}</a></p>`
}

/** Verification email for a new registration. */
export async function sendVerificationEmail(
  to: string,
  name: string,
  token: string
): Promise<SendEmailResult> {
  const verifyUrl = `${appUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}`
  const html = [
    '<h2>Verify Your Email</h2>',
    `<p>Hi ${name},</p>`,
    '<p>Welcome to Family Planner! Please verify your email address to get started.</p>',
    button(verifyUrl, 'Verify Email'),
    `<p>Or copy this link: ${verifyUrl}</p>`,
    '<p>This link expires in 24 hours. If you did not sign up, you can ignore this email.</p>',
  ].join('\n')

  return sendEmail({
    to,
    subject: 'Verify Your Family Planner Email',
    html,
    text: `Verify your Family Planner email: ${verifyUrl} (expires in 24 hours)`,
  })
}

/** Password reset email. */
export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string
): Promise<SendEmailResult> {
  const resetUrl = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`
  const html = [
    '<h2>Password Reset Request</h2>',
    `<p>Hi ${name},</p>`,
    '<p>You requested a password reset for your Family Planner account.</p>',
    button(resetUrl, 'Reset Password'),
    `<p>Or copy this link: ${resetUrl}</p>`,
    '<p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>',
  ].join('\n')

  return sendEmail({
    to,
    subject: 'Reset Your Family Planner Password',
    html,
    text: `Reset your Family Planner password: ${resetUrl} (expires in 1 hour)`,
  })
}
