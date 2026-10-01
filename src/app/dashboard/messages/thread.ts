// Pure helpers for the family chat thread (messages/page.tsx).

/** The fields the thread logic relies on; the page renders the rest. */
export interface ThreadMessage {
  id: string
  /** ISO date-time; also the `cursor` for GET /api/messages (older than this). */
  created_at: string
}

/**
 * Fold the newest page from a poll into what is on screen. Earlier messages
 * the reader loaded with "Load earlier messages" stay. Returns `prev` itself
 * when nothing changed (same count and same newest id), so a quiet poll does
 * not re-render the thread or move the reader.
 */
export function mergeLatest<T extends ThreadMessage>(prev: T[], latest: T[]): T[] {
  if (latest.length === 0) return prev.length === 0 ? prev : latest
  const windowStart = Date.parse(latest[0].created_at)
  const windowEnd = Date.parse(latest[latest.length - 1].created_at)
  const latestIds = new Set(latest.map(m => m.id))
  const earlier = prev.filter(m => Date.parse(m.created_at) < windowStart && !latestIds.has(m.id))
  // A message just sent can be newer than a poll that was already in flight;
  // keep it rather than letting it flicker out until the next poll.
  const later = prev.filter(m => Date.parse(m.created_at) > windowEnd && !latestIds.has(m.id))
  const next = [...earlier, ...latest, ...later]
  if (next.length === prev.length && next[next.length - 1]?.id === prev[prev.length - 1]?.id) return prev
  return next
}

/** Put an older page in front of the thread, skipping any already shown. */
export function prependEarlier<T extends ThreadMessage>(prev: T[], older: T[]): T[] {
  const have = new Set(prev.map(m => m.id))
  const fresh = older.filter(m => !have.has(m.id))
  return fresh.length === 0 ? prev : [...fresh, ...prev]
}
