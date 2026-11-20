import { useCallback } from 'react'
import { useTranslation } from '@/i18n'
import { sickDayDuration, type SickDayDurationMessage } from '@/lib/sick-day-duration'

/** How long a sickness has lasted, in plain words. Never a negative count. */
export const sickDayDurationEnglish: Record<SickDayDurationMessage, string> = {
  startedToday: 'Started today',
  startedYesterday: 'Started yesterday',
  startedDaysAgo: 'Started {count} days ago',
}

export const sickDayDurationSpanish: Record<SickDayDurationMessage, string> = {
  startedToday: 'Empezó hoy',
  startedYesterday: 'Empezó ayer',
  startedDaysAgo: 'Empezó hace {count} días',
}

export const sickDayDurationMessages = {
  en: sickDayDurationEnglish,
  es: sickDayDurationSpanish,
}

export function useSickDayDurationText() {
  const { t } = useTranslation()
  return useCallback(
    (startedAt: string | Date, now?: Date) => {
      const { key, count } = sickDayDuration(startedAt, now)
      return t(key, { count }, sickDayDurationMessages)
    },
    [t],
  )
}
