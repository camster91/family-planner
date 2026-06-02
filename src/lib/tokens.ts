import crypto from 'crypto'
import { prisma } from './prisma'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'

// Generate a secure random token
export function generateToken(length = 32): string {
  return crypto.randomBytes(length).toString('hex')
}

// Store password-reset token (1 hour expiry, separate from verify token)
export async function createResetToken(userId: string): Promise<string> {
  const token = generateToken()
  const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  await prisma!.user.update({
    where: { id: userId },
    data: {
      reset_token: token,
      reset_token_expires: expires,
    },
  })

  return token
}

// Verify and consume password-reset token
export async function verifyResetToken(token: string): Promise<string | null> {
  const user = await prisma!.user.findFirst({
    where: {
      reset_token: token,
      reset_token_expires: { gt: new Date() },
    },
  })

  if (!user) return null
  return user.id
}

// Clear password-reset token after use
export async function clearResetToken(userId: string): Promise<void> {
  await prisma!.user.update({
    where: { id: userId },
    data: {
      reset_token: null,
      reset_token_expires: null,
    },
  })
}

// Create email verification token (24 hour expiry, separate from reset token)
// Stored in its own columns so a user can request both simultaneously without
// one overwriting the other.
export async function createVerificationToken(userId: string): Promise<string> {
  const token = generateToken()
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

  await prisma!.user.update({
    where: { id: userId },
    data: {
      verify_token: token,
      verify_token_expires: expires,
    },
  })

  return token
}

// Verify email token (does NOT consume — that's done by markEmailVerified)
export async function verifyEmailToken(token: string): Promise<string | null> {
  const user = await prisma!.user.findFirst({
    where: {
      verify_token: token,
      verify_token_expires: { gt: new Date() },
    },
  })

  if (!user) return null
  return user.id
}

// Mark email as verified and clear the verify token
export async function markEmailVerified(userId: string): Promise<void> {
  await prisma!.user.update({
    where: { id: userId },
    data: {
      email_verified: true,
      verify_token: null,
      verify_token_expires: null,
    },
  })
}
