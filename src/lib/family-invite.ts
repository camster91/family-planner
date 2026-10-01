import crypto from 'crypto'

/**
 * Invite codes are Family.invite_code. Households created before O-34 have a
 * cuid (the schema default); new households and every "Get a new family code"
 * get `createFamilyInviteCode()`. Both pass `normalizeInviteCode`. The old
 * FAM-{id-prefix} format is rejected.
 */

const MIN_LEN = 8
const MAX_LEN = 64

export const INVITE_ROLES = ['parent', 'teen', 'child'] as const
export type InviteRole = (typeof INVITE_ROLES)[number]
export const INVITE_TTL_MS = 48 * 60 * 60 * 1000

export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim()
  if (code.length < MIN_LEN || code.length > MAX_LEN) return null
  if (/^FAM-/i.test(code)) return null
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return null
  return code
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (!email || email.length > 255 || !email.includes('@')) return null
  return email
}

export function isInviteRole(value: unknown): value is InviteRole {
  return typeof value === 'string' && (INVITE_ROLES as readonly string[]).includes(value)
}

/** Lowercase letters and digits without the look-alikes 0/o and 1/l (32 symbols, 5 bits each). */
const FAMILY_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
export const FAMILY_CODE_LENGTH = 24

/**
 * A new family code (O-34): 24 symbols from a 32-symbol alphabet, 120 bits from
 * the CSPRNG. Unlike a cuid it carries no timestamp or counter, so it cannot be
 * narrowed down from when the household was created. Used at household
 * creation (`POST /api/family`) and by `POST /api/family/invite-code`.
 */
export function createFamilyInviteCode(): string {
  const bytes = crypto.randomBytes(FAMILY_CODE_LENGTH)
  let code = ''
  // 256 is a multiple of 32, so `byte % 32` is unbiased.
  for (const byte of bytes) code += FAMILY_CODE_ALPHABET[byte % FAMILY_CODE_ALPHABET.length]
  return code
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
