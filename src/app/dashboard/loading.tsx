'use client'

import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton'
import { useTranslation } from '@/i18n'

/**
 * Route-level loading state for the server-rendered /dashboard tabs (route
 * inventory F-9). Shown inside the layout, so the nav and tab bar stay put
 * while a page's server data loads. The shimmer is decorative; the polite
 * status line is what assistive technology announces. Reduced motion is
 * handled globally (globals.css).
 */
export default function DashboardLoading() {
  const { t } = useTranslation()

  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-6" data-testid="dashboard-loading">
      <span className="sr-only">{t('routeState.loading')}</span>
      <div aria-hidden="true" className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  )
}
