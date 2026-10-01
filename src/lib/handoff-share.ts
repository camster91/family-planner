// Sitter handoff share links are unauthenticated, so they must be unguessable
// and short-lived. A link lives for at least 6h, stretches to 6h after the
// planned departure so a handoff prepared in advance still works, and never
// beyond 7 days. Create and regenerate-token both use this rule so a re-shared
// link lasts as long as the original would.
export const SHARE_TOKEN_TTL_MS = 6 * 60 * 60 * 1000
export const SHARE_TOKEN_MAX_MS = 7 * 24 * 60 * 60 * 1000

export function shareExpiry(departure: Date | null, now: number = Date.now()): Date {
  const afterDeparture = departure && !isNaN(departure.getTime()) ? departure.getTime() + SHARE_TOKEN_TTL_MS : 0
  return new Date(Math.min(Math.max(now + SHARE_TOKEN_TTL_MS, afterDeparture), now + SHARE_TOKEN_MAX_MS))
}
