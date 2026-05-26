'use client'

import { useAnalytics } from '@/lib/analytics'

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useAnalytics()
  return <>{children}</>
}
