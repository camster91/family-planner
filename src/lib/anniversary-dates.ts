import { nextAnnualOccurrence } from '@/lib/dates'

export interface FamilyDate {
  id: string
  name: string
  type: 'birthday' | 'anniversary' | 'custom'
  date: string
  notes?: string | null
  person_id?: string | null
  days_until?: number
  role?: string
}

export interface ApiDateItem extends FamilyDate {
  days_until: number
  next_occurrence: string
}

export type DateItem = ApiDateItem & { daysUntil: number }

/**
 * Group dates by type, soonest first, counting days from the viewer's local
 * calendar day (`today`, `YYYY-MM-DD`) rather than the server's UTC day
 * (O-31). Custom dates get their own group so they stay visible and editable.
 */
export function buildDateItems(
  dates: ApiDateItem[],
  today: string
): {
  birthdays: DateItem[]
  anniversaries: DateItem[]
  others: DateItem[]
} {
  const withDays = dates
    .map((d) => ({ ...d, daysUntil: nextAnnualOccurrence(d.date, today)?.daysUntil ?? d.days_until }))
    .sort((a, b) => a.daysUntil - b.daysUntil)
  return {
    birthdays: withDays.filter((d) => d.type === 'birthday'),
    anniversaries: withDays.filter((d) => d.type === 'anniversary'),
    others: withDays.filter((d) => d.type === 'custom'),
  }
}
