/**
 * Family code shape, normalization and display. No Node imports, so client
 * components can use it; `src/lib/family-invite.ts` re-exports it and owns the
 * generator.
 *
 * Invite codes are Family.invite_code. Three shapes are stored, all lowercase
 * letters and digits with no separators:
 * - before O-34: a cuid (the schema default, 25 chars, may contain 0/o/1/l);
 * - O-34: 24 chars from the old 32-symbol alphabet;
 * - now: FAMILY_CODE_LENGTH (12) chars from FAMILY_CODE_ALPHABET, shown as
 *   XXXX-XXXX-XXXX by `formatFamilyCode`.
 * Existing codes are never rewritten; all three pass `normalizeInviteCode`.
 * The old FAM-{id-prefix} format is rejected.
 */

/** Bounds on the canonical (separator-free) code. */
const MIN_LEN = 8
const MAX_LEN = 64

/**
 * Lowercase letters and digits without the look-alikes 0/o, 1/l/i: 31 symbols.
 * Codes are shown uppercase, so I/1 and O/0 would be the confusable pairs, and
 * l is dropped too for anyone who writes the code down in lowercase.
 */
export const FAMILY_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const FAMILY_CODE_LENGTH = 12

/**
 * The canonical stored form of a typed or pasted family code: lowercase, with
 * spaces and dashes removed, so `K7QM-4XPD-2HNA`, `k7qm 4xpd 2hna` and
 * `k7qm4xpd2hna` are the same code. Look-alike characters are deliberately
 * NOT remapped (0->o, 1->l): pre-O-34 cuid codes contain them and must keep
 * matching exactly. Lowercasing is safe because every stored code is
 * lowercase (cuid and both generators). `_` stays allowed for compatibility;
 * no generator emits it.
 */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length > MAX_LEN) return null
  if (/^FAM-/i.test(trimmed)) return null
  const code = trimmed.replace(/[\s-]+/g, '').toLowerCase()
  if (code.length < MIN_LEN || code.length > MAX_LEN) return null
  if (!/^[a-z0-9_]+$/.test(code)) return null
  return code
}

/**
 * How a stored family code is shown and copied.
 * - New 12-char codes: uppercase in three groups, `K7QM-4XPD-2HNA`.
 * - Older codes (24-char O-34, 25-char cuid): unchanged characters, grouped in
 *   4s with spaces for reading aloud. They stay lowercase because a cuid can
 *   contain both 0 and o, which uppercase would make look the same.
 * Both forms go straight back through `normalizeInviteCode`.
 */
export function formatFamilyCode(code: string): string {
  const canonical = normalizeInviteCode(code)
  if (!canonical) return code
  if (canonical.length === FAMILY_CODE_LENGTH) {
    return canonical.toUpperCase().match(/.{4}/g)!.join('-')
  }
  return canonical.match(/.{1,4}/g)!.join(' ')
}
