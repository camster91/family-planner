'use client'

import * as React from 'react'
import { pseudolocalizeTemplate } from './pseudo'
import type { Locale } from './types'

export type ScopedMessages = Record<Locale, Record<string, string>>

export type LocaleContextValue = {
  locale: Locale
  pseudolocalize: boolean
}

/**
 * The small locale surface used by route-owned dictionaries. Keeping this
 * separate from the shared message registry prevents a focused route from
 * importing every app dictionary just to choose English or Spanish.
 */
export const LocaleContext = React.createContext<LocaleContextValue>({
  locale: 'en',
  pseudolocalize: false,
})

export function useAppLocale(): LocaleContextValue {
  return React.useContext(LocaleContext)
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(params[key] ?? `{${key}}`),
  )
}

/** Resolve a small route-owned dictionary without importing the global catalog. */
export function useScopedMessages<K extends string>(
  messages: Readonly<Record<Locale, Readonly<Record<K, string>>>>,
): (key: K, params?: Record<string, string | number>) => string {
  const { locale, pseudolocalize } = useAppLocale()
  return React.useCallback(
    (key, params) => {
      const template = messages[locale][key] ?? messages.en[key]
      const localized = pseudolocalize ? pseudolocalizeTemplate(template) : template
      return interpolate(localized, params)
    },
    [locale, messages, pseudolocalize],
  )
}
