import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { getClientIp } from '@/lib/client-ip'
import { createResetToken } from '@/lib/tokens'
import { sendMail } from '@/lib/mail'
import { escapeHtml } from '@/lib/escape-html'

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

    const { email } = payload
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const user = await prisma!.user.findUnique({ where: { email: email.toLowerCase() } })

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
    const html = [
      '<h2>Password Reset Request</h2>',
      `<p>Hi ${escapeHtml(user.name)},</p>`,
      '<p>You requested a password reset for your Family Planner account.</p>',
      `<p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#3B82F6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a></p>`,
      `<p>Or copy this link: ${escapeHtml(resetUrl)}</p>`,
      '<p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>',
    ].join('\n')

    try {
      await sendMail({
        to: user.email,
        subject: 'Reset Your Family Planner Password',
        html,
        text: `Reset your Family Planner password: ${resetUrl} - this link expires in 1 hour.`,
      })
    } catch (e) {
      // Never surface send failures to the caller (avoids enumeration/probing),
      // but make them visible in the logs.
      console.warn('Failed to send reset email:', e)
    }

    return NextResponse.json({
      message: 'If an account exists with that email, a reset link has been sent.',
      ...(process.env.NODE_ENV !== 'production' && { resetToken: token }),
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
