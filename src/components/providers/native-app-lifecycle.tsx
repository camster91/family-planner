'use client'

import { useEffect, useState } from 'react'
import { watchNativeApp } from '@/lib/native-app-lazy'
import type { NotificationDestination } from '@/lib/notification-destination'
import { useCoreTranslation } from '@/i18n/core'

import { nativeReminderMessages } from '@/i18n/native-reminder'

export function NativeAppLifecycle() {
  const [destination, setDestination] = useState<NotificationDestination | null>(null)
  const { t } = useCoreTranslation()
  useEffect(() => watchNativeApp(native => {
    const resume = native.watchNativeResume(() => window.dispatchEvent(new Event('focus')))
    const links = native.watchNativeNotificationLinks(target => setDestination(target))
    return () => { resume(); links() }
  }), [])
  if (!destination) return null
  // Never navigate as a side effect of an OS event: a form may be dirty or have
  // an unknown save outcome. A normal document link retains beforeunload guards
  // and goes through the canonical sign-in, household and role boundaries.
  return <aside className="border-b border-separator bg-surface-primary px-4 py-2 text-label-primary" aria-label={t('ready', undefined, nativeReminderMessages)}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <p role="status" className="text-sm">{t('ready', undefined, nativeReminderMessages)}</p>
      <a href={destination} className="inline-flex min-h-11 items-center font-semibold underline focus-visible:outline focus-visible:outline-2">{t('open', undefined, nativeReminderMessages)}</a>
      <button type="button" onClick={() => setDestination(null)} className="min-h-11 px-3 text-sm focus-visible:outline focus-visible:outline-2">{t('dismiss', undefined, nativeReminderMessages)}</button>
    </div>
  </aside>
}
