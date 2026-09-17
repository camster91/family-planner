const DEFAULT_FROM = 'Family Planner <noreply@ashbi.ca>'
const DEFAULT_DOMAIN = 'ashbi.ca'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

export function isMailConfigured(): boolean {
  return Boolean(process.env.MAILGUN_API_KEY)
}

export async function sendMail(options: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<void> {
  const apiKey = process.env.MAILGUN_API_KEY
  const domain = process.env.MAILGUN_DOMAIN || DEFAULT_DOMAIN
  const from = process.env.MAILGUN_FROM || process.env.FROM_EMAIL || DEFAULT_FROM

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MAILGUN_API_KEY is not set')
    }
    console.log(`[DEV] Email to ${options.to}: ${options.subject}\n${options.text}`)
    return
  }

  const auth = Buffer.from(`api:${apiKey}`).toString('base64')
  const response = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
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
    const detail = await response.text()
    throw new Error(`Mailgun failed (${response.status}): ${detail.slice(0, 200)}`)
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
  const subject = `${options.inviterName} invited you to ${options.familyName} on Family Planner`
  const html = [
    `<p>Hi,</p>`,
    `<p>${inviterName} invited you to join <strong>${familyName}</strong> as a <strong>${role}</strong>.</p>`,
    `<p><a href="${options.joinUrl}" style="display:inline-block;background:#3B82F6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Join family</a></p>`,
    `<p>Or copy this link: ${escapeHtml(options.joinUrl)}</p>`,
    `<p>This invite expires in 48 hours. If you were not expecting this, you can ignore it.</p>`,
  ].join('\n')
  const text = [
    `${options.inviterName} invited you to join ${options.familyName} as a ${options.role}.`,
    `Join: ${options.joinUrl}`,
    'This invite expires in 48 hours.',
  ].join('\n')
  return { subject, html, text }
}
