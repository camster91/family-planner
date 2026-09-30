/**
 * Per-member colours for the Today board (#262).
 *
 * A member's colour is a key from a fixed palette, never a free hex value, so
 * every colour is a design token that has already been checked for contrast
 * (white initials on the fill; the fill as a non-text accent next to text on
 * the board surfaces). Colour is always decoration next to a visible name: it
 * never carries meaning on its own.
 *
 * `User.board_color` stores a parent's choice. When it is null (or holds a key
 * this build does not know), the member gets a deterministic fallback: the
 * first palette colour, in palette order, that no earlier member in household
 * order already uses. Household order is `created_at`, then `id`, the same
 * order the board lists people in, so a new member with no chosen colour never
 * changes anyone else's colour. Choosing a colour explicitly can move a member
 * whose colour was only a fallback; a parent can pin both.
 */

export const MEMBER_COLOR_KEYS = ['indigo', 'sky', 'green', 'orange', 'purple', 'pink', 'yellow', 'red'] as const

export type MemberColorKey = (typeof MEMBER_COLOR_KEYS)[number]

/** Human label for the colour picker (text, so the choice is not colour-only). */
export const MEMBER_COLOR_LABELS: Record<MemberColorKey, string> = {
  indigo: 'Indigo',
  sky: 'Sky',
  green: 'Green',
  orange: 'Orange',
  purple: 'Purple',
  pink: 'Pink',
  yellow: 'Gold',
  red: 'Red',
}

/**
 * CSS value for a key. Reuses the module tint tokens in src/app/globals.css,
 * which are AA for white text in light and dark mode.
 */
export const MEMBER_COLOR_CSS: Record<MemberColorKey, string> = {
  indigo: 'var(--tint-chore)',
  sky: 'var(--tint-projects)',
  green: 'var(--tint-lists)',
  orange: 'var(--tint-rewards)',
  purple: 'var(--tint-family)',
  pink: 'var(--tint-messages)',
  yellow: 'var(--tint-meals)',
  red: 'var(--tint-calendar)',
}

export function isMemberColorKey(value: unknown): value is MemberColorKey {
  return typeof value === 'string' && (MEMBER_COLOR_KEYS as readonly string[]).includes(value)
}

/**
 * Resolves every member's colour. `members` must already be in household
 * order. Explicit choices are honoured even when two members pick the same
 * colour (a parent's decision); fallbacks avoid every colour already taken.
 */
export function resolveMemberColors(
  members: ReadonlyArray<{ id: string; board_color?: string | null }>
): Map<string, MemberColorKey> {
  const out = new Map<string, MemberColorKey>()
  const taken = new Set<MemberColorKey>()
  for (const m of members) {
    if (isMemberColorKey(m.board_color)) {
      out.set(m.id, m.board_color)
      taken.add(m.board_color)
    }
  }
  let cursor = 0
  for (const m of members) {
    if (out.has(m.id)) continue
    const free = MEMBER_COLOR_KEYS.find((k) => !taken.has(k))
    // More members than colours: cycle the palette in order.
    const key = free ?? MEMBER_COLOR_KEYS[cursor++ % MEMBER_COLOR_KEYS.length]
    out.set(m.id, key)
    taken.add(key)
  }
  return out
}
