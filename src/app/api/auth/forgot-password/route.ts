import { storageBackend } from '@/lib/storage-backend'
import { getD1Database } from '@/lib/cloudflare/database'
import { findD1Account } from '@/lib/cloudflare/accounts'
import { PRODUCT_BRAND } from '@/lib/brand'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { getClientIp } from '@/lib/client-ip'
import { createResetToken } from '@/lib/tokens'
import { normalizeEmail } from '@/lib/family-invite'
import { sendAccountMail } from '@/lib/notification-delivery'
import { escapeHtml } from '@/lib/escape-html'
import { brandedEmailHtml, emailButton } from '@/lib/email-layout'
import { logRouteError, logRouteWarning } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rateCheck = await checkRateLimit(`forgot:${ip}`, 5, 60 * 60 * 1000)
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

    // Trimmed and lower-cased like every stored email (a pasted or autofilled
    // address often carries a trailing space).
    const email = normalizeEmail(payload?.email)
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Same lookup as login: the lower-cased form first, then the address as
    // typed (trimmed) so an older account stored with capitals can still
    // reset its password.
    const lookupUser = async (address: string) => storageBackend() === 'd1'
      ? findD1Account(await getD1Database(), address)
      : prisma!.user.findUnique({ where: { email: address } })
    let user = await lookupUser(email)
    const typed = String(payload.email).trim()
    if (!user && typed !== email) {
      user = await lookupUser(typed)
    }

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json({ message: 'If an account exists with that email, a reset link has been sent.' })
    }

    const token = await createResetToken(user.id)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'
    const resetUrl = appUrl + '/reset-password?token=' + token

    // Send the reset email through the shared Mailgun sender.
    // Previously this route used an inline Maton/Gmail path that silently fell
    // through to a dev-only console.log when MATON_API_KEY was unset, so
    // production sent no email at all.
    const html = brandedEmailHtml([
      '<h2>Password Reset Request</h2>',
      `<p>Hi ${escapeHtml(user.name)},</p>`,
      `<p>You requested a password reset for your ${escapeHtml(PRODUCT_BRAND.wordmark)} account.</p>`,
      `<p>${emailButton(resetUrl, 'Reset Password')}</p>`,
      `<p>Or copy this link: ${escapeHtml(resetUrl)}</p>`,
      '<p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>',
    ].join('\n'))

    try {
      await sendAccountMail('password_reset', {
        to: user.email,
        subject: `Reset your ${PRODUCT_BRAND.wordmark} password`,
        html,
        text: `Reset your ${PRODUCT_BRAND.wordmark} password: ${resetUrl} - this link expires in 1 hour.`,
      })
    } catch (e) {
      // Never surface send failures to the caller (avoids enumeration/probing),
      // but make them visible in the logs.
      logRouteWarning('POST /api/auth/forgot-password (reset email)', e, getRequestId(request))
    }

    return NextResponse.json({
      message: 'If an account exists with that email, a reset link has been sent.',
      // Only an explicitly development runtime may expose the fabricated
      // token for local UI testing. An unset NODE_ENV must stay private on a
      // Worker; production deployments must never depend on this guard being
      // populated by the host.
      ...(process.env.NODE_ENV === 'development' && { resetToken: token }),
    })
  } catch (error) {
    logRouteError('POST /api/auth/forgot-password', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
