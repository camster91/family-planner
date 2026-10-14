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

/**
 * Resolve a route-owned message with the same safe fallback as the shared
 * translator: unknown, inherited, and non-string values stay as the raw key.
 * Pseudo-localization happens before household values are interpolated.
 */
export function resolveScopedMessage(
  source: unknown,
  key: string,
  params?: Record<string, string | number>,
  pseudolocalize = false,
): string {
  let value = source
  for (const part of key.split('.')) {
    if (
      value &&
      typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, part)
    ) {
      value = (value as Record<string, unknown>)[part]
    } else {
      return key
    }
  }
  if (typeof value !== 'string') return key
  const template = pseudolocalize ? pseudolocalizeTemplate(value) : value
  return interpolate(template, params)
}

/** Resolve a small route-owned dictionary without importing the global catalog. */
export function useScopedMessages<K extends string>(
  messages: Readonly<Record<Locale, Readonly<Record<K, string>>>>,
): (key: K, params?: Record<string, string | number>) => string {
  const { locale, pseudolocalize } = useAppLocale()
  return React.useCallback(
    (key, params) => resolveScopedMessage(messages[locale], key, params, pseudolocalize),
    [locale, messages, pseudolocalize],
  )
}
