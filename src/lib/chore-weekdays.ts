/** UTC date-only weekdays; never local timezone/DST arithmetic. */
export const WEEKDAYS = [
  { day: 1, label: 'Monday' }, { day: 2, label: 'Tuesday' },
  { day: 3, label: 'Wednesday' }, { day: 4, label: 'Thursday' },
  { day: 5, label: 'Friday' }, { day: 6, label: 'Saturday' },
  { day: 0, label: 'Sunday' },
] as const

export function normalizedWeekdays(days: readonly number[] = []): number[] {
  return [...new Set(days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a,b) => a-b)
}

export function nextSelectedWeekday(from: Date, days: readonly number[], inclusive = false): Date | null {
  const selected = normalizedWeekdays(days)
  if (!selected.length) return null
  const date = new Date(from)
  date.setUTCHours(0,0,0,0)
  for (let offset = inclusive ? 0 : 1; offset <= 7; offset++) {
    const candidate = new Date(date)
    candidate.setUTCDate(date.getUTCDate() + offset)
    if (selected.includes(candidate.getUTCDay())) return candidate
  }
  return null
}
