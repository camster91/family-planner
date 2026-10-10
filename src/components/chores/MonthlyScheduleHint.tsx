"use client"
import { useTranslation } from '@/i18n'

export function MonthlyScheduleHint() {
  const { t } = useTranslation()
  return (
    <p className="text-footnote text-label-secondary mt-1.5">
      {t('choreSchedule.monthlyHint')}
    </p>
  )
}
