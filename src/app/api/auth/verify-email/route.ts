import { NextRequest, NextResponse } from 'next/server'
import { consumeEmailVerificationToken, isVerificationTokenAlreadyUsed } from '@/lib/tokens'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { getClientIp } from '@/lib/client-ip'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

// Email verification is a two-step flow (O-24). Mail security scanners open
// every link in an email, so a link that verified on GET was used up before
// the person ever clicked it. The emailed link now opens the /verify-email
// page, and only its "Confirm my email" button POSTs here.

const MAX_TOKEN_LENGTH = 256

function appUrl(path: string): URL {
  return new URL(path, process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca')
}

/**
 * Links in emails sent before the confirm step pointed here. GET never
 * consumes the token: it only forwards to the confirm page.
 */
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(appUrl('/login?error=missing_token'))
  }
  const target = appUrl('/verify-email')
  target.searchParams.set('token', token)
  return NextResponse.redirect(target)
}

/**
 * POST /api/auth/verify-email { token }
 *   200 { status: 'verified' }          the email is now verified
 *   200 { status: 'already_verified' }  this link was already used; just sign in
 *   400 { status: 'invalid', error }    unknown, expired or malformed token
 *   429                                 rate limited per client address
 */
export async function POST(request: NextRequest) {
  try {
    // Public and unauthenticated like reset-password: bound token guessing.
    const rateCheck = await checkRateLimit(`verify-email:${getClientIp(request)}`, 10, 60 * 60 * 1000)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      )
    }

    let payload: any
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ status: 'invalid', error: 'Invalid JSON' }, { status: 400 })
    }

    const token = payload?.token
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) {
      return NextResponse.json({ status: 'invalid', error: 'Invalid or expired verification link' }, { status: 400 })
    }

    // Single atomic claim: matches the token hash and an unexpired row, marks
    // the email verified and clears the expiry in one UPDATE.
    if (await consumeEmailVerificationToken(token)) {
      return NextResponse.json({ status: 'verified' })
    }

    if (await isVerificationTokenAlreadyUsed(token)) {
      return NextResponse.json({ status: 'already_verified' })
    }

    return NextResponse.json({ status: 'invalid', error: 'Invalid or expired verification link' }, { status: 400 })
  } catch (error) {
    logRouteError('POST /api/auth/verify-email', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
