'use client'

import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton'
import { useTranslation } from '@/i18n'

/**
 * Route-level loading state for the server-rendered /dashboard tabs (route
 * inventory F-9), re-exported by each tab's `loading.tsx`. Shown inside the
 * dashboard layout, so the nav and tab bar stay put while a page's server data
 * loads. The shimmer is decorative; the polite status line is what assistive
 * technology announces. Reduced motion is handled globally (globals.css).
 *
 * Deliberately NOT at `src/app/dashboard/loading.tsx`: a loading boundary
 * streams the page, which turns a server `redirect()` into a client-side one
 * after the response and a `notFound()` into a 200. `/dashboard` redirects
 * parents to `/dashboard/today`, `/dashboard/projects/[id]` and
 * `/dashboard/settings/devices` call `notFound()`, so only segments whose
 * pages do neither get one.
 */
export default function RouteLoading() {
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
