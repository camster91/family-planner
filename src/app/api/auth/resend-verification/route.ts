import { storageBackend } from '@/lib/storage-backend'
import { getD1Database } from '@/lib/cloudflare/database'
import { findD1Account } from '@/lib/cloudflare/accounts'
import { restoreD1VerificationToken } from '@/lib/cloudflare/account-recovery'
import { PRODUCT_BRAND } from '@/lib/brand'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { getClientIp } from '@/lib/client-ip'
import { createVerificationToken, hashToken } from '@/lib/tokens'
import { normalizeEmail } from '@/lib/family-invite'
import { sendAccountMail } from '@/lib/notification-delivery'
import { escapeHtml } from '@/lib/escape-html'
import { brandedEmailHtml, emailButton } from '@/lib/email-layout'
import { logRouteError, logRouteWarning } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

// POST /api/auth/resend-verification { email }
// Re-issues a verification email for an unverified account. Always answers
// 200 with the same message so the endpoint cannot be used to probe which
// emails exist or which of them are verified.
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rateCheck = await checkRateLimit(`resend-verify:${ip}`, 5, 60 * 60 * 1000)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }

    let payload: any
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const email = normalizeEmail(payload?.email)
    if (!email) {
      // 400 here is safe: the caller sent a non-email-shaped value, so this
      // leaks nothing about any particular account.
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
    }

    const user = storageBackend() === 'd1'
      ? await findD1Account(await getD1Database(), email)
      : await prisma!.user.findUnique({ where: { email } })

    if (user && !user.email_verified) {
      // Snapshot the existing token before createVerificationToken overwrites
      // it, so a failed delivery can restore the previously issued link.
      const oldToken = user.verify_token
      const oldExpires = user.verify_token_expires
      let issuedToken: string | undefined
      // Best-effort: never leak delivery status through the response.
      try {
        const token = await createVerificationToken(user.id)
        issuedToken = token
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'
        const verifyUrl = appUrl + '/verify-email?token=' + token

        const html = brandedEmailHtml([
          '<h2>Verify Your Email</h2>',
          `<p>Hi ${escapeHtml(user.name)},</p>`,
          `<p>Here is a new verification link for your ${escapeHtml(PRODUCT_BRAND.wordmark)} account.</p>`,
          `<p>${emailButton(verifyUrl, 'Verify Email')}</p>`,
          `<p>Or copy this link: ${escapeHtml(verifyUrl)}</p>`,
          '<p>This link expires in 24 hours.</p>',
        ].join('\n'))

        await sendAccountMail('email_verification', {
          to: email,
          subject: `Verify your ${PRODUCT_BRAND.wordmark} email`,
          html,
          text: `Verify your ${PRODUCT_BRAND.wordmark} email: ${verifyUrl} - this link expires in 24 hours.`,
        })
      } catch (e) {
        // Delivery failed AFTER the new token was written — restore the prior
        // token so the previously delivered link stays usable.
        if (storageBackend() === 'd1') {
          if (issuedToken) await restoreD1VerificationToken(await getD1Database(), user.id,
            hashToken(issuedToken), oldToken, oldExpires?.getTime() ?? null).catch(() => undefined)
        } else {
          await prisma!.user
            .update({
              where: { id: user.id },
              data: { verify_token: oldToken, verify_token_expires: oldExpires },
            })
            .catch(() => undefined)
        }
        logRouteWarning('POST /api/auth/resend-verification (mail)', e, getRequestId(request))
      }
    }

    return NextResponse.json({
      message: 'If that email belongs to an unverified account, a new verification link has been sent.',
    })
  } catch (error) {
    logRouteError('POST /api/auth/resend-verification', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}