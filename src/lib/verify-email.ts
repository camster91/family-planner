/**
 * Client side of the email confirm step (O-24). The /verify-email page shows a
 * "Confirm my email" button; only pressing it POSTs the token, so a mail
 * scanner that opens the link does not use it up.
 */

export type VerifyOutcome = 'verified' | 'already_verified' | 'invalid' | 'rate_limited' | 'error'

/** Map a POST /api/auth/verify-email response to what the page shows. */
export function verifyOutcomeFor(status: number, body: unknown): VerifyOutcome {
  const reported = body && typeof body === 'object' ? (body as { status?: unknown }).status : undefined
  if (status === 200 && reported === 'verified') return 'verified'
  if (status === 200 && reported === 'already_verified') return 'already_verified'
  if (status === 400) return 'invalid'
  if (status === 429) return 'rate_limited'
  return 'error'
}

/** POST the token. Never throws: a network failure is `'error'`. */
export async function confirmEmailToken(token: string, fetchImpl: typeof fetch = fetch): Promise<VerifyOutcome> {
  try {
    const res = await fetchImpl('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    return verifyOutcomeFor(res.status, body)
  } catch {
    return 'error'
  }
}

/** Where a successful confirm goes: the sign-in page's "verified" notice. */
export const VERIFIED_REDIRECT = '/login?verified=1'

export const VERIFY_MESSAGES: Record<Exclude<VerifyOutcome, 'verified'>, string> = {
  already_verified: 'Your email is already verified. You can sign in.',
  invalid:
    'That verification link has expired or is not valid. Sign in and choose "Resend verification email" to get a new one.',
  rate_limited: 'Too many attempts. Please wait a while and try again.',
  error: 'We could not confirm your email just now. Please try again in a minute.',
}
