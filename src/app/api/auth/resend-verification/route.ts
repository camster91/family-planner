import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { createVerificationToken } from '@/lib/tokens'
import { normalizeEmail } from '@/lib/family-invite'
import { sendMail } from '@/lib/mail'

export const dynamic = 'force-dynamic'

// POST /api/auth/resend-verification { email }
// Re-issues a verification email for an unverified account. Always answers
// 200 with the same message so the endpoint cannot be used to probe which
// emails exist or which of them are verified.
export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
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

    const user = await prisma!.user.findUnique({ where: { email } })

    if (user && !user.email_verified) {
      // Best-effort: never leak delivery status through the response.
      try {
        const token = await createVerificationToken(user.id)
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'
        const verifyUrl = appUrl + '/api/auth/verify-email?token=' + token

        const html = [
          '<h2>Verify Your Email</h2>',
          `<p>Hi ${user.name},</p>`,
          '<p>Here is a new verification link for your Family Planner account.</p>',
          `<p><a href="${verifyUrl}" style="display:inline-block;background:#3B82F6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Verify Email</a></p>`,
          `<p>Or copy this link: ${verifyUrl}</p>`,
          '<p>This link expires in 24 hours.</p>',
        ].join('\n')

        await sendMail({
          to: email,
          subject: 'Verify Your Family Planner Email',
          html,
          text: `Verify your Family Planner email: ${verifyUrl} - this link expires in 24 hours.`,
        })
      } catch (e) {
        console.warn('Resend-verification mail failed:', e)
      }
    }

    return NextResponse.json({
      message: 'If that email belongs to an unverified account, a new verification link has been sent.',
    })
  } catch (error) {
    console.error('Resend-verification error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}