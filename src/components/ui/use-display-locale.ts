'use client'

import * as React from 'react'
import { useTranslation } from '@/i18n'
import { deviceLanguages, pickDisplayLocale } from '@/lib/display-locale'

function subscribe(onChange: () => void) {
  window.addEventListener('languagechange', onChange)
  return () => window.removeEventListener('languagechange', onChange)
}

// A string snapshot, so useSyncExternalStore sees a stable value between renders.
const clientSnapshot = () => deviceLanguages().join(',')
const serverSnapshot = () => ''

/**
 * The locale to format dates and times with (src/lib/display-locale.ts): the
 * app language plus the device's region once hydrated. On the server and
 * during hydration it is the bare app language, so server HTML and the first
 * client render match; the device region applies right after.
 */
export function useDisplayLocale(): string {
  const { locale } = useTranslation()
  const languages = React.useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)
  return React.useMemo(() => pickDisplayLocale(locale, languages ? languages.split(',') : []), [locale, languages])
}
