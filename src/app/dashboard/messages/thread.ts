// Pure helpers for the family chat thread (messages/page.tsx).

/** The fields the thread logic relies on; the page renders the rest. */
export interface ThreadMessage {
  id: string
  /** ISO date-time; modern continuation is a separate opaque timestamp/ID position. */
  created_at: string
}

/**
 * Fold the newest page from a poll into what is on screen. Earlier messages
 * the reader loaded with "Load earlier messages" stay. Returns `prev` itself
 * when nothing changed (same count and same newest id), so a quiet poll does
 * not re-render the thread or move the reader.
 */
export function mergeLatest<T extends ThreadMessage>(prev: T[], latest: T[], stableTies = false): T[] {
  if (latest.length === 0) return prev.length === 0 ? prev : latest
  const windowStart = Date.parse(latest[0].created_at)
  const windowEnd = Date.parse(latest[latest.length - 1].created_at)
  const latestIds = new Set(latest.map(m => m.id))
  // The new API selects timestamp DESC/id ASC, then reverses its page.
  // Canonical message IDs are ASCII; reverse ID order breaks chronological ties.
  const compare = (a: T, b: T) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1)
  const earlier = prev.filter(m => (stableTies ? compare(m, latest[0]) < 0 : Date.parse(m.created_at) < windowStart) && !latestIds.has(m.id))
  // A message just sent can be newer than a poll that was already in flight;
  // keep it rather than letting it flicker out until the next poll.
  const later = prev.filter(m => (stableTies ? compare(m, latest[latest.length - 1]) > 0 : Date.parse(m.created_at) > windowEnd) && !latestIds.has(m.id))
  const next = [...earlier, ...latest, ...later]
  if (next.length === prev.length && (stableTies
    ? next.every((row, i) => row === prev[i] || JSON.stringify(row) === JSON.stringify(prev[i]))
    : next[next.length - 1]?.id === prev[prev.length - 1]?.id)) return prev
  return next
}

/** Put an older page in front of the thread, skipping any already shown. */
export function prependEarlier<T extends ThreadMessage>(prev: T[], older: T[]): T[] {
  const have = new Set(prev.map(m => m.id))
  const fresh = older.filter(m => !have.has(m.id))
  return fresh.length === 0 ? prev : [...fresh, ...prev]
}
