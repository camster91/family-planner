import crypto from 'crypto'
import { prisma } from './prisma'

// Tokens are stored as sha256(token). The plaintext is only ever held in the
// email link we send and in the caller's local variable — never in the database.
// A leaked DB dump therefore cannot be replayed against the reset/verify flows.
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// Generate a secure random token
export function generateToken(length = 32): string {
  return crypto.randomBytes(length).toString('hex')
}

// Store password-reset token (1 hour expiry, separate from verify token).
// Returns the PLAINTEXT token for the email link; only its hash is persisted.
export async function createResetToken(userId: string): Promise<string> {
  const token = generateToken()
  const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  await prisma!.user.update({
    where: { id: userId },
    data: {
      reset_token: hashToken(token),
      reset_token_expires: expires,
    },
  })

  return token
}

/**
 * Atomically consume the reset token and set the new password.
 *
 * The lookup, the expiry check, the single-use claim and the password write all
 * happen in ONE UPDATE, so two concurrent POSTs with the same token cannot both
 * succeed — the loser matches zero rows and gets `false`.
 *
 * Also increments `token_version`, which invalidates every JWT issued before
 * this reset (see `verifyToken`/`authenticateRequest` in `@/lib/api-auth`).
 */
export async function consumeResetToken(
  token: string,
  hashedPassword: string
): Promise<boolean> {
  const { count } = await prisma!.user.updateMany({
    where: {
      reset_token: hashToken(token),
      reset_token_expires: { gt: new Date() },
    },
    data: {
      password: hashedPassword,
      reset_token: null,
      reset_token_expires: null,
      token_version: { increment: 1 },
    },
  })

  return count === 1
}

// Create email verification token (24 hour expiry, separate from reset token)
// Stored in its own columns so a user can request both simultaneously without
// one overwriting the other. Returns the PLAINTEXT token for the email link.
export async function createVerificationToken(userId: string): Promise<string> {
  const token = generateToken()
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

  await prisma!.user.update({
    where: { id: userId },
    data: {
      verify_token: hashToken(token),
      verify_token_expires: expires,
    },
  })

  return token
}

/**
 * Atomically consume the email verification token and mark the email verified.
 * Single-use: the verify_token columns are cleared in the same UPDATE that
 * matches them, so a replayed link matches zero rows.
 */
export async function consumeEmailVerificationToken(token: string): Promise<boolean> {
  const { count } = await prisma!.user.updateMany({
    where: {
      verify_token: hashToken(token),
      verify_token_expires: { gt: new Date() },
    },
    data: {
      email_verified: true,
      verify_token: null,
      verify_token_expires: null,
    },
  })

  return count === 1
}
