/**
 * Parent-initiated, confirmed pairing (SHARED_DEVICE.md §5, O-6, O-9).
 *
 * The household always comes from the pairing row (created by a parent's
 * session), never from anything the tablet sends. Codes, claim tokens and the
 * 4 confirmation digits are stored as sha256 only.
 */
import crypto from 'crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { hashToken } from '@/lib/tokens'
import { timingSafeEqualStr } from '@/lib/constant-time'
import {
  createDeviceSession,
  generateDeviceToken,
  revokeDeviceInTransaction,
  type IssuedDeviceTokens,
} from '@/lib/device-session'

type Db = PrismaClient
type Tx = Prisma.TransactionClient

export const PAIRING_TTL_MS = 10 * 60 * 1000
export const MAX_LIVE_CODES = 3
export const MAX_ACTIVE_DEVICES = 5
export const MAX_CONFIRM_ATTEMPTS = 3
/** Expired pairings older than this are pruned when a parent opens the device list. */
export const PAIRING_RETENTION_MS = 24 * 60 * 60 * 1000

// Crockford base32: 0-9 A-Z without I L O U.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/

export function generatePairingCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
  return code
}

export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/** Uppercase, strip spaces/hyphens, O→0, I/L→1. Null when it cannot be a code. */
export function normalisePairingCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 32) return null
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return CODE_PATTERN.test(s) ? s : null
}

export function generateConfirmDigits(): string {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0')
}

export function normaliseLabel(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const label = input.trim().replace(/\s+/g, ' ')
  return label.length >= 1 && label.length <= 40 ? label : null
}

/** Serialise concurrent capacity decisions for one household (§5.3). */
async function lockFamily(tx: Tx, familyId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${familyId} FOR UPDATE`
}

class DeviceLimitError extends Error {}
class ReplaceTargetError extends Error {
  constructor(readonly reason: 'not_found' | 'removed') {
    super(reason)
  }
}
class IssueRaceError extends Error {}
class IssueLimitError extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

// ---------------------------------------------------------------------------
// Create (parent)

export type CreatePairingResult =
  | { ok: true; pairingId: string; code: string; expiresAt: Date; superseded: string[] }
  | { ok: false; code: 'DEVICE_LIMIT_REACHED' | 'REPLACE_NOT_FOUND' | 'REPLACE_REMOVED' }

/**
 * Create a pairing code. A fourth live, unclaimed code cancels the oldest.
 * Capacity counts active devices plus pending (unexpired, uncancelled,
 * not-yet-issued) pairings, so pending pairings reserve a slot.
 *
 * `replacesDeviceId` ("Replace", §7): an active tablet of the same household
 * that the new one replaces. It is revoked when the new tablet is issued, so
 * it does not count toward capacity while a pending pairing replaces it; a
 * household at the limit can still replace a tablet.
 */
export async function createPairing(
  db: Db,
  args: { familyId: string; userId: string; label: string; now: Date; replacesDeviceId?: string | null }
): Promise<CreatePairingResult> {
  const { familyId, userId, label, now } = args
  const replacesDeviceId = args.replacesDeviceId ?? null
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS)

  for (let attempt = 0; ; attempt++) {
    const code = generatePairingCode()
    try {
      return await db.$transaction(async (tx) => {
        await lockFamily(tx, familyId)

        // Validated before any write: foreign and missing ids look the same.
        if (replacesDeviceId) {
          const target = await tx.householdDevice.findFirst({
            where: { id: replacesDeviceId, family_id: familyId },
            select: { revoked_at: true },
          })
          if (!target) throw new ReplaceTargetError('not_found')
          if (target.revoked_at) throw new ReplaceTargetError('removed')
        }

        const unclaimed = await tx.devicePairing.findMany({
          where: { family_id: familyId, expires_at: { gt: now }, claimed_at: null, cancelled_at: null, device_id: null },
          select: { id: true },
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        })
        const superseded = unclaimed.slice(0, Math.max(0, unclaimed.length - (MAX_LIVE_CODES - 1))).map((p) => p.id)
        if (superseded.length > 0) {
          await tx.devicePairing.updateMany({
            where: { id: { in: superseded }, cancelled_at: null },
            data: { cancelled_at: now },
          })
        }

        const pendingWhere = { family_id: familyId, expires_at: { gt: now }, cancelled_at: null, device_id: null }
        const [active, pending, replacing] = await Promise.all([
          tx.householdDevice.count({ where: { family_id: familyId, revoked_at: null } }),
          tx.devicePairing.count({ where: pendingWhere }),
          tx.devicePairing.findMany({
            where: { ...pendingWhere, replaces_device_id: { not: null } },
            select: { replaces_device_id: true },
          }),
        ])
        // Active tablets that a pending pairing (or this one) will revoke at
        // issue free their slot; each tablet counts once.
        const targets = new Set(replacing.map((p) => p.replaces_device_id as string))
        if (replacesDeviceId) targets.add(replacesDeviceId)
        const freed = targets.size
          ? await tx.householdDevice.count({
              where: { id: { in: Array.from(targets) }, family_id: familyId, revoked_at: null },
            })
          : 0
        // Throwing rolls back the superseding cancel too.
        if (active - freed + pending >= MAX_ACTIVE_DEVICES) throw new DeviceLimitError()

        const created = await tx.devicePairing.create({
          data: {
            family_id: familyId,
            code_hash: hashToken(code),
            label,
            created_by: userId,
            expires_at: expiresAt,
            claimed_at: null,
            claim_token_hash: null,
            confirm_digits_hash: null,
            confirm_attempts: 0,
            confirmed_at: null,
            cancelled_at: null,
            device_id: null,
            replaces_device_id: replacesDeviceId,
            created_at: now,
          },
          select: { id: true },
        })
        return { ok: true as const, pairingId: created.id, code, expiresAt, superseded }
      })
    } catch (error) {
      if (error instanceof DeviceLimitError) return { ok: false, code: 'DEVICE_LIMIT_REACHED' }
      if (error instanceof ReplaceTargetError) {
        return { ok: false, code: error.reason === 'removed' ? 'REPLACE_REMOVED' : 'REPLACE_NOT_FOUND' }
      }
      // A code_hash collision (≈1 in 10^12) is retried with a fresh code.
      if (isUniqueViolation(error) && attempt < 2) continue
      throw error
    }
  }
}

// ---------------------------------------------------------------------------
// Claim (tablet, no session)

export type ClaimResult =
  | { ok: true; pairingId: string; familyId: string; claimToken: string; confirmDigits: string; expiresAt: Date }
  | { ok: false }

/**
 * One atomic `updateMany` claims the code. Unknown, expired, used and
 * cancelled codes all fail the same way (uniform error at the route).
 */
export async function claimPairing(
  db: Db,
  args: { code: unknown; platform: 'android' | 'web'; appVersion: string | null; now: Date }
): Promise<ClaimResult> {
  const normalised = normalisePairingCode(args.code)
  if (!normalised) return { ok: false }
  const claimToken = generateDeviceToken('p')
  const confirmDigits = generateConfirmDigits()
  const claimHash = hashToken(claimToken)

  const { count } = await db.devicePairing.updateMany({
    where: {
      code_hash: hashToken(normalised),
      expires_at: { gt: args.now },
      claimed_at: null,
      cancelled_at: null,
      device_id: null,
    },
    data: {
      claimed_at: args.now,
      claim_token_hash: claimHash,
      confirm_digits_hash: hashToken(confirmDigits),
      claim_platform: args.platform,
      claim_app_version: args.appVersion,
    },
  })
  if (count !== 1) return { ok: false }

  const row = await db.devicePairing.findUnique({
    where: { claim_token_hash: claimHash },
    select: { id: true, family_id: true, expires_at: true },
  })
  if (!row) return { ok: false }
  return { ok: true, pairingId: row.id, familyId: row.family_id, claimToken, confirmDigits, expiresAt: row.expires_at }
}

// ---------------------------------------------------------------------------
// Parent view, confirm, cancel

export type ParentPairingStatus = 'waiting' | 'claimed' | 'confirmed' | 'paired' | 'expired' | 'cancelled'

interface PairingStatusRow {
  expires_at: Date
  claimed_at: Date | null
  confirmed_at: Date | null
  cancelled_at: Date | null
  device_id: string | null
}

export function parentPairingStatus(row: PairingStatusRow, now: Date): ParentPairingStatus {
  if (row.device_id) return 'paired'
  if (row.cancelled_at) return 'cancelled'
  if (row.expires_at.getTime() <= now.getTime()) return 'expired'
  if (row.confirmed_at) return 'confirmed'
  if (row.claimed_at) return 'claimed'
  return 'waiting'
}

export const PARENT_PAIRING_SELECT = {
  id: true,
  family_id: true,
  expires_at: true,
  claimed_at: true,
  confirmed_at: true,
  cancelled_at: true,
  device_id: true,
  claim_platform: true,
  claim_app_version: true,
  replaces_device_id: true,
} as const

export type ConfirmResult =
  | { kind: 'not_found' }
  | { kind: 'confirmed'; newly: boolean }
  | { kind: 'cancelled' }
  | { kind: 'expired' }
  | { kind: 'not_claimed' }
  | { kind: 'mismatch'; attemptsLeft: number; cancelledNow: boolean }

export async function confirmPairing(
  db: Db,
  args: { pairingId: string; familyId: string; userId: string; digits: string; now: Date }
): Promise<ConfirmResult> {
  const { pairingId, familyId, userId, digits, now } = args
  const row = await db.devicePairing.findFirst({
    where: { id: pairingId, family_id: familyId },
    select: { ...PARENT_PAIRING_SELECT, confirm_digits_hash: true, confirm_attempts: true },
  })
  if (!row) return { kind: 'not_found' }
  if (row.device_id || row.confirmed_at) return { kind: 'confirmed', newly: false }
  if (row.cancelled_at) return { kind: 'cancelled' }
  if (row.expires_at.getTime() <= now.getTime()) return { kind: 'expired' }
  if (!row.claimed_at || !row.confirm_digits_hash) return { kind: 'not_claimed' }

  if (timingSafeEqualStr(hashToken(digits), row.confirm_digits_hash)) {
    const { count } = await db.devicePairing.updateMany({
      where: { id: pairingId, family_id: familyId, confirmed_at: null, cancelled_at: null, expires_at: { gt: now } },
      data: { confirmed_at: now, confirmed_by: userId },
    })
    return count === 1 ? { kind: 'confirmed', newly: true } : { kind: 'cancelled' }
  }

  const bumped = await db.devicePairing.updateMany({
    where: {
      id: pairingId,
      family_id: familyId,
      confirmed_at: null,
      cancelled_at: null,
      confirm_attempts: { lt: MAX_CONFIRM_ATTEMPTS },
    },
    data: { confirm_attempts: { increment: 1 } },
  })
  if (bumped.count !== 1) return { kind: 'cancelled' }
  const after = await db.devicePairing.findUnique({ where: { id: pairingId }, select: { confirm_attempts: true } })
  const attempts = after?.confirm_attempts ?? MAX_CONFIRM_ATTEMPTS
  if (attempts >= MAX_CONFIRM_ATTEMPTS) {
    const cancelled = await db.devicePairing.updateMany({
      where: { id: pairingId, cancelled_at: null, confirmed_at: null },
      data: { cancelled_at: now },
    })
    return { kind: 'mismatch', attemptsLeft: 0, cancelledNow: cancelled.count === 1 }
  }
  return { kind: 'mismatch', attemptsLeft: MAX_CONFIRM_ATTEMPTS - attempts, cancelledNow: false }
}

export async function cancelPairing(
  db: Db,
  args: { pairingId: string; familyId: string; now: Date }
): Promise<{ found: boolean; cancelledNow: boolean }> {
  const row = await db.devicePairing.findFirst({
    where: { id: args.pairingId, family_id: args.familyId },
    select: { id: true },
  })
  if (!row) return { found: false, cancelledNow: false }
  const { count } = await db.devicePairing.updateMany({
    where: { id: args.pairingId, family_id: args.familyId, cancelled_at: null, device_id: null },
    data: { cancelled_at: args.now },
  })
  return { found: true, cancelledNow: count === 1 }
}

// ---------------------------------------------------------------------------
// Status and issue (tablet)

export const TABLET_PAIRING_SELECT = {
  id: true,
  family_id: true,
  label: true,
  created_by: true,
  expires_at: true,
  confirmed_at: true,
  confirmed_by: true,
  cancelled_at: true,
  device_id: true,
  claim_platform: true,
  claim_app_version: true,
  replaces_device_id: true,
} as const

export async function findPairingByClaimToken(db: Db, claimToken: unknown) {
  if (typeof claimToken !== 'string' || !claimToken.startsWith('fpd1_p_') || claimToken.length > 100) return null
  return db.devicePairing.findUnique({
    where: { claim_token_hash: hashToken(claimToken) },
    select: TABLET_PAIRING_SELECT,
  })
}

type TabletPairingRow = NonNullable<Awaited<ReturnType<typeof findPairingByClaimToken>>>

export type IssueResult =
  | { kind: 'pending' }
  | { kind: 'expired' }
  | { kind: 'cancelled' }
  | { kind: 'limit' }
  | {
      kind: 'paired'
      device: { id: string; label: string }
      tokens: IssuedDeviceTokens
      /** The tablet this pairing replaced, revoked in the same transaction (audit it). */
      replacedDeviceId: string | null
    }

/**
 * The first status call after confirmation creates the device and its first
 * session. The 5-device limit is re-checked under `SELECT … FOR UPDATE` on the
 * Family row so concurrent issues in one household serialise; `device_id` is
 * set once, so a second call cannot mint a second device. A replacing
 * pairing revokes the old tablet (reason 'replaced') inside the same
 * transaction, before the capacity check, so the household never holds more
 * than 5 active tablets and never loses the old one without gaining the new.
 */
export async function issuePairedDevice(db: Db, row: TabletPairingRow, now: Date): Promise<IssueResult> {
  if (row.device_id) return { kind: 'expired' }
  if (row.cancelled_at) return { kind: 'cancelled' }
  if (row.expires_at.getTime() <= now.getTime()) return { kind: 'expired' }
  if (!row.confirmed_at) return { kind: 'pending' }

  try {
    return await db.$transaction(async (tx): Promise<IssueResult> => {
      await lockFamily(tx, row.family_id)
      const fresh = await tx.devicePairing.findUnique({
        where: { id: row.id },
        select: { device_id: true, cancelled_at: true, expires_at: true, confirmed_at: true, replaces_device_id: true },
      })
      if (!fresh || fresh.device_id) return { kind: 'expired' }
      if (fresh.cancelled_at) return { kind: 'cancelled' }
      if (fresh.expires_at.getTime() <= now.getTime() || !fresh.confirmed_at) return { kind: 'expired' }

      // Scoped by household: a foreign or already-removed id revokes nothing.
      const replacedDeviceId =
        fresh.replaces_device_id &&
        (await revokeDeviceInTransaction(tx, {
          deviceId: fresh.replaces_device_id,
          familyId: row.family_id,
          revokedBy: row.confirmed_by,
          reason: 'replaced',
          now,
        }))
          ? fresh.replaces_device_id
          : null

      const active = await tx.householdDevice.count({ where: { family_id: row.family_id, revoked_at: null } })
      // Throw (roll back) rather than return, so a replaced tablet is never
      // revoked without its replacement; the pairing is cancelled below.
      if (active >= MAX_ACTIVE_DEVICES) throw new IssueLimitError()

      const device = await tx.householdDevice.create({
        data: {
          family_id: row.family_id,
          label: row.label,
          platform: row.claim_platform === 'android' ? 'android' : 'web',
          created_by: row.created_by,
          confirmed_by: row.confirmed_by,
          paired_at: now,
          last_seen_at: now,
          last_seen_app_version: row.claim_app_version,
          revoked_at: null,
          revoked_by: null,
          revoke_reason: null,
          elevation_token_hash: null,
          elevated_user_id: null,
          created_at: now,
        },
        select: { id: true, label: true },
      })
      const claimed = await tx.devicePairing.updateMany({
        where: { id: row.id, device_id: null, cancelled_at: null },
        data: { device_id: device.id },
      })
      if (claimed.count !== 1) throw new IssueRaceError()
      const tokens = await createDeviceSession(tx, device.id, row.family_id, now)
      return { kind: 'paired', device, tokens, replacedDeviceId }
    })
  } catch (error) {
    if (error instanceof IssueLimitError) {
      await db.devicePairing.updateMany({
        where: { id: row.id, cancelled_at: null, device_id: null },
        data: { cancelled_at: now },
      })
      return { kind: 'limit' }
    }
    if (error instanceof IssueRaceError || isUniqueViolation(error)) return { kind: 'expired' }
    throw error
  }
}
