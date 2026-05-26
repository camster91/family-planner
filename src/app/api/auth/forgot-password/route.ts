import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/auth'
import { createResetToken } from '@/lib/tokens'

function buildResetEmail(userName: string, email: string, resetUrl: string, fromEmail: string): string {
  const html = [
    '<h2>Password Reset Request</h2>',
    `<p>Hi ${userName},</p>`,
    '<p>You requested a password reset for your Family Planner account.</p>',
    `<p><a href="${resetUrl}" style="display:inline-block;background:#3B82F6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a></p>`,
    `<p>Or copy this link: ${resetUrl}</p>`,
    '<p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>',
  ].join('\n')

  const mime = [
    `From: Family Planner <${fromEmail}>`,
    `To: ${email}`,
    'Subject: Reset Your Family Planner Password',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
  ].join('\n')

  return Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rateCheck = checkRateLimit(`forgot:${ip}`, 5, 60 * 60 * 1000)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }

    const { email } = await request.json()
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

    // Send email via Maton if configured
    const matonKey = process.env.MATON_API_KEY || process.env.MATON_API_KEY_ASHBI
    if (matonKey) {
      try {
        const mimeBody = buildResetEmail(user.name, user.email, resetUrl, process.env.FROM_EMAIL || 'noreply@family.ashbi.ca')
        const res = await fetch('https://api.maton.ai/google-mail/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${matonKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw: mimeBody }),
        })
        if (!res.ok) console.warn('Maton email failed:', await res.text())
      } catch (e) {
        console.warn('Failed to send reset email:', e)
      }
    } else {
      console.log(`[DEV] Reset URL for ${email}: ${resetUrl}`)
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
