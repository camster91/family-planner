/**
 * The in-app path to go to after sign-in, or null.
 *
 * `?redirect=` on /login is attacker-controllable (anyone can send a login
 * link). Only a same-origin path is accepted: it must start with a single `/`.
 * `//evil.example` and `/\evil.example` are protocol-relative URLs to a browser
 * and would leave the app, so they are refused, as are control characters.
 */
export function safeRedirectPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return null
  }
  return raw
}

/**
 * Notices for the query parameters /api/auth/verify-email redirects to.
 * A mail scanner that opens the link first consumes the token, so an
 * "invalid" link may well mean the address is already verified.
 */
export function loginNoticeFor(params: URLSearchParams): { kind: 'success' | 'error'; text: string } | null {
  if (params.get('verified') === '1') {
    return { kind: 'success', text: 'Your email is verified. Sign in to get started.' }
  }
  switch (params.get('error')) {
    case 'invalid_token':
      return {
        kind: 'error',
        text: 'That verification link has expired or was already used. If you already verified, just sign in. Otherwise sign in and choose "Resend verification email".',
      }
    case 'missing_token':
      return { kind: 'error', text: 'That verification link is incomplete. Copy the whole link from the email, or sign in to get a new one.' }
    case 'server':
      return { kind: 'error', text: 'We could not verify your email just now. Please try the link again in a minute.' }
    default:
      return null
  }
}
