import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyEmailToken, markEmailVerified } from '@/lib/tokens'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.redirect(new URL('/login?error=missing_token', process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'))
    }

    const userId = await verifyEmailToken(token)
    if (!userId) {
      return NextResponse.redirect(new URL('/login?error=invalid_token', process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'))
    }

    await markEmailVerified(userId)

    return NextResponse.redirect(new URL('/login?verified=1', process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'))
  } catch (error) {
    console.error('Verify email error:', error)
    return NextResponse.redirect(new URL('/login?error=server', process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'))
  }
}
