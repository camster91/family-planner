import crypto from 'crypto'
import { FAMILY_CODE_ALPHABET, FAMILY_CODE_LENGTH } from '@/lib/family-code'

export {
  FAMILY_CODE_ALPHABET,
  FAMILY_CODE_LENGTH,
  formatFamilyCode,
  normalizeInviteCode,
} from '@/lib/family-code'

export const INVITE_ROLES = ['parent', 'teen', 'child'] as const
export type InviteRole = (typeof INVITE_ROLES)[number]
export const INVITE_TTL_MS = 48 * 60 * 60 * 1000

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (!email || email.length > 255 || !email.includes('@')) return null
  return email
}

export function isInviteRole(value: unknown): value is InviteRole {
  return typeof value === 'string' && (INVITE_ROLES as readonly string[]).includes(value)
}

/**
 * Largest multiple of the alphabet size that fits in a byte (31 * 8 = 248);
 * bytes at or above it are discarded so `byte % 31` stays unbiased.
 */
const UNBIASED_BYTE_LIMIT = 256 - (256 % FAMILY_CODE_ALPHABET.length)

/**
 * A new family code: 12 symbols from a 31-symbol alphabet drawn from the
 * CSPRNG (31^12 ≈ 7.9e17 codes, about 59 bits). It carries no timestamp or
 * counter, so it cannot be narrowed down from when the household was created.
 * Used at household creation (`POST /api/family`) and by
 * `POST /api/family/invite-code`; both retry on a unique collision
 * (`isInviteCodeCollision`), which at these sizes is vanishingly rare.
 *
 * Why 12 characters is enough to guess against (every guess goes through an
 * authenticated, rate-limited route; the limits live in the routes):
 * - `POST /api/family/join`: 10/hour per account, 30/hour per IP
 *   (plus 10/hour per account+IP).
 * - `GET /api/family/lookup`: 30/hour per account, 60/hour per IP.
 * So one IP gets at most 90 guesses an hour, one account at most 40.
 * With 100,000 households the chance a single guess hits any of them is
 * 1e5 / 7.9e17 ≈ 1.3e-13, so about 7.9e12 guesses are expected per hit.
 * From one IP that is ~8.8e10 hours (about 10 million years); even 100,000
 * IPs each at the cap need about 100 years. Account sign-ups are themselves
 * limited (20/hour per IP), so accounts do not multiply the IP budget.
 * Old 24-char (32^24 ≈ 6e36) and cuid codes are far stronger still.
 */
export function createFamilyInviteCode(): string {
  let code = ''
  while (code.length < FAMILY_CODE_LENGTH) {
    for (const byte of crypto.randomBytes(FAMILY_CODE_LENGTH * 2)) {
      if (byte >= UNBIASED_BYTE_LIMIT) continue
      code += FAMILY_CODE_ALPHABET[byte % FAMILY_CODE_ALPHABET.length]
      if (code.length === FAMILY_CODE_LENGTH) break
    }
  }
  return code
}

/** How many fresh codes to try before giving up on a unique collision. */
export const INVITE_CODE_ATTEMPTS = 5

/**
 * True for a Prisma unique-constraint error (P2002). Only used around writes
 * whose sole unique column is `Family.invite_code`, so any P2002 there is a
 * code collision.
 */
export function isInviteCodeCollision(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002')
}

export function createInviteToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function normalizeInviteToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const token = raw.trim()
  if (!/^[a-f0-9]{64}$/i.test(token)) return null
  return token.toLowerCase()
}
