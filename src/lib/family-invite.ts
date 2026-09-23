import crypto from 'crypto'

/** Invite codes are Family.invite_code (cuid). The old FAM-{id-prefix} format is rejected. */

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
