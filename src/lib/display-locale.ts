/**
 * Locale for showing dates and times (not for storing them, and not for URL
 * params, which stay YYYY-MM-DD / year+month numbers).
 *
 * The app language (Settings → Language, src/i18n: 'en' | 'es') decides the
 * language; the device's own language list adds the region when it is the
 * same language. So English on a Canadian or British phone shows that
 * country's date order, Spanish on a Mexican phone shows es-MX, and a phone
 * set to another language still shows the app's language.
 */

function primary(tag: string): string {
  return tag.toLowerCase().split('-')[0]
}

function isSupported(tag: string): boolean {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0
  } catch {
    return false
  }
}

/**
 * The first device language that matches `appLocale` (e.g. 'en-CA' for 'en'),
 * else `appLocale` itself.
 */
export function pickDisplayLocale(appLocale: string, deviceLanguages: readonly string[] | null | undefined): string {
  const want = primary(appLocale)
  for (const tag of deviceLanguages ?? []) {
    if (typeof tag === 'string' && tag && primary(tag) === want && isSupported(tag)) return tag
  }
  return appLocale
}

/** The device's preferred languages, or [] where there is no navigator (server). */
export function deviceLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) return navigator.languages
  return navigator.language ? [navigator.language] : []
}

/** "October 2026" / "octubre de 2026". */
export function formatMonthYear(year: number, month: number, locale: string): string {
  return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}
