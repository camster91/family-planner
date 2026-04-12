import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { verifyResetToken, deleteResetToken } from '@/lib/password-reset'

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json()

    if (!token || !password) {
      return NextResponse.json({ error: 'Token and new password are required' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long' }, { status: 400 })
    }

    const userId = verifyResetToken(token)
    if (!userId) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 })
    }

    const user = await prisma!.user.findUnique({ where: { id: userId } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const hashedPassword = await hashPassword(password)
    await prisma!.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    })

    deleteResetToken(token)

    return NextResponse.json({ message: 'Password has been reset successfully' })
  } catch (error) {
    console.error('Reset password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}