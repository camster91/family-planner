/** Invite codes are Family.invite_code (cuid). The old FAM-{id-prefix} format is rejected. */

const MIN_LEN = 8
const MAX_LEN = 64

export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim()
  if (code.length < MIN_LEN || code.length > MAX_LEN) return null
  if (/^FAM-/i.test(code)) return null
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return null
  return code
}
