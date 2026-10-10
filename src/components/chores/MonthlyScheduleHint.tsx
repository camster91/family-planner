"use client"
import { useTranslation } from '@/i18n'
import { choreScheduleMessages } from '@/i18n/chore-schedule'

export function MonthlyScheduleHint() {
  const { t } = useTranslation()
  return (
    <p className="text-footnote text-label-secondary mt-1.5">
      {t('monthlyHint', undefined, choreScheduleMessages)}
    </p>
  )
}
