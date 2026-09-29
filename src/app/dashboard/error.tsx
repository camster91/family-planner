'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useTranslation } from '@/i18n'

/**
 * Route-level error state for every /dashboard page (route inventory F-9).
 * A server-page exception lands here instead of the framework error page.
 *
 * It never renders `error.message`, `error.stack` or `error.digest`: in
 * production Next.js already replaces server messages, and in development they
 * can carry query text or ids. The nav and tab bar (the layout) stay usable.
 */
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useTranslation()
  const headingRef = React.useRef<HTMLHeadingElement>(null)

  // Move focus to the message so keyboard and screen-reader users land on it.
  React.useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div role="alert" className="max-w-md mx-auto py-12 text-center" data-testid="dashboard-error">
      <div className="empty-state-icon mx-auto">
        <AlertTriangle className="w-9 h-9 text-white" aria-hidden="true" />
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="text-title-2 mb-2 outline-none">
        {t('routeState.errorTitle')}
      </h2>
      <p className="text-body text-label-secondary mb-6">{t('routeState.errorBody')}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={() => reset()} className="btn-filled min-h-[44px]">
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          {t('routeState.tryAgain')}
        </button>
        <Link href="/dashboard" className="btn-tinted min-h-[44px]">
          {t('routeState.backToToday')}
        </Link>
      </div>
    </div>
  )
}
