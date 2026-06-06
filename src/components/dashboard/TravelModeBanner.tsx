'use client'

import * as React from 'react'
import { Plane } from 'lucide-react'
import { useTranslation } from '@/i18n'

interface TravelBannerProps {
  className?: string
}

export function TravelModeBanner({ className }: TravelBannerProps) {
  const { t } = useTranslation()
  const [travel, setTravel] = React.useState<{
    travel_mode_active: boolean
    travel_start_date: string | null
    travel_end_date: string | null
    travel_destination: string | null
  } | null>(null)

  React.useEffect(() => {
    fetch('/api/family/travel')
      .then(res => res.ok ? res.json() : null)
      .then(data => setTravel(data))
      .catch(() => {})
  }, [])

  if (!travel?.travel_mode_active) return null

  const endDate = travel.travel_end_date
    ? new Date(travel.travel_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <div className={`bg-[var(--accent-tint)] px-4 py-2 flex items-center gap-2 ${className ?? ''}`}>
      <Plane className="w-4 h-4 text-[var(--accent)]" />
      <span className="text-subhead text-[var(--accent)] font-medium">
        {t('travel.banner', {
          destination: travel.travel_destination ?? '',
          date: endDate ?? '',
        })}
      </span>
    </div>
  )
}