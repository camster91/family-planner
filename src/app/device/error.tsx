'use client'

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { primaryButtonClass, screenCardClass } from '@/components/device/styles'

/**
 * Route-level error state for the shared tablet (route inventory F-9).
 *
 * Shown on a shared surface, so it carries no household name, record, error
 * message, stack or digest. It does not unpair or wipe the tablet: a render
 * failure is not a removal. "Try again" re-renders the segment in place.
 */
export default function DeviceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useTranslation()

  return (
    <main
      data-testid="device-error"
      className="flex min-h-screen items-center justify-center bg-[var(--surface-grouped)] px-4 py-10"
    >
      <div role="alert" className={screenCardClass}>
        <h1 className="font-display text-[32px] font-bold leading-tight text-label-primary md:text-[40px]">
          {t('routeState.errorTitle')}
        </h1>
        <p className="mt-3 text-[19px] leading-snug text-label-secondary md:text-[21px]">
          {t('routeState.tabletErrorBody')}
        </p>
        <div className="mt-8">
          <button type="button" onClick={() => reset()} className={primaryButtonClass}>
            <RefreshCw className="h-5 w-5" aria-hidden="true" />
            {t('routeState.tryAgain')}
          </button>
        </div>
      </div>
    </main>
  )
}
