/**
 * Whole local calendar days between the start of a sickness and now, never
 * negative. A sickness started minutes ago, or a phone clock slightly behind
 * the server, counts as day 0 ("Started today").
 */
export function sickDayDaysSince(startedAt: string | Date, now: Date = new Date()): number {
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) return 0
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((today - startDay) / 86_400_000))
}

export type SickDayDurationMessage = 'startedToday' | 'startedYesterday' | 'startedDaysAgo'

/** Which message describes the duration, and its {count}. */
export function sickDayDuration(startedAt: string | Date, now: Date = new Date()): {
  key: SickDayDurationMessage
  count: number
} {
  const count = sickDayDaysSince(startedAt, now)
  if (count === 0) return { key: 'startedToday', count }
  if (count === 1) return { key: 'startedYesterday', count }
  return { key: 'startedDaysAgo', count }
}
