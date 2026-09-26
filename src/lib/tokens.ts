import crypto from 'crypto'
import { prisma } from './prisma'
import { writeDeviceAudit } from './device-audit'

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

/**
 * Prisma filter matching a submitted token against a stored token column.
 *
 * New tokens are stored as `sha256(token)`. Rows written before that change
 * hold the PLAINTEXT token, and those have to keep working: registration is
 * email-unique and there is no resend-verification endpoint, so a user whose
 * `verify_token` predates the hashing change would be locked out permanently.
 * Matching both forms covers the rollout; the legacy arm closes itself because
 * verify tokens expire in 24h and reset tokens in 1h.
 *
 * Deliberately NOT a data migration: the two forms are indistinguishable by
 * shape (legacy plaintext is 64 hex chars, sha256 hex is also 64 hex chars),
 * so a rewrite of the column would double-hash on the next container start —
 * `scripts/migrate.js` runs on every boot, not just once.
 */
export function tokenMatch(token: string) {
  return { in: [hashToken(token), token] }
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
 * Cheap preflight: does this token match a live row at all?
 *
 * `hashPassword` is bcrypt at cost 12 — roughly a quarter-second of CPU. Doing
 * that before knowing whether the token is even valid let anyone burn a full
 * bcrypt round per request on the public, unauthenticated reset endpoint. This
 * costs one indexed lookup and rejects junk before the expensive hash.
 *
 * It is a fast path, NOT the authority: the atomic claim in
 * `consumeResetToken` still decides, so a token that expires or is consumed
 * between this check and the claim is still rejected.
 */
export async function resetTokenExists(token: string): Promise<boolean> {
  const row = await prisma!.user.findFirst({
    where: {
      reset_token: tokenMatch(token),
      reset_token_expires: { gt: new Date() },
    },
    select: { id: true },
  })
  return row !== null
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
  // A reset implies possible compromise, so it also removes the parent's
  // tablet elevation PIN (SHARED_DEVICE.md §6.1). The PIN row is deleted
  // BEFORE the claim: if the claim then loses a race, the winner is the same
  // account and would delete it anyway, so this can only fail safe.
  const target = await prisma!.user.findFirst({
    where: {
      reset_token: tokenMatch(token),
      reset_token_expires: { gt: new Date() },
    },
    select: { id: true, family_id: true },
  })
  const pinsCleared = target
    ? (await prisma!.parentElevationPin.deleteMany({ where: { user_id: target.id } })).count
    : 0

  const { count } = await prisma!.user.updateMany({
    where: {
      reset_token: tokenMatch(token),
      reset_token_expires: { gt: new Date() },
    },
    data: {
      password: hashedPassword,
      reset_token: null,
      reset_token_expires: null,
      token_version: { increment: 1 },
    },
  })

  if (count === 1 && pinsCleared > 0 && target?.family_id) {
    await writeDeviceAudit(prisma!, {
      familyId: target.family_id,
      actorUserId: target.id,
      type: 'parent_pin.cleared_by_reset',
      metadata: {},
    })
  }

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
      verify_token: tokenMatch(token),
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
