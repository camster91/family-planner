'use client'

/**
 * ThemeProvider — keeps the user's theme (light/dark/auto, src/lib/theme.ts)
 * applied to <html> on every page, not just Settings.
 *
 * With nothing saved the theme is Auto (O-43): it follows the device's
 * prefers-color-scheme and changes when the device does. The first paint is
 * already right: THEME_INIT_SCRIPT runs in <head> (root layout) before this
 * mounts. A saved explicit Light or Dark is respected and never rewritten.
 *
 * Also applies prefers-reduced-motion to <html> so CSS can opt animations
 * out at the root level.
 *
 * The Settings page writes the same localStorage key; changes from another
 * tab re-apply here through the `storage` event.
 */
import * as React from 'react'
import { THEME_STORAGE_KEY, applyThemePreference, readThemePreference } from '@/lib/theme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const applyTheme = () => applyThemePreference(readThemePreference())
    applyTheme()

    // Follow the device while the preference is Auto (saved or by default).
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemChange = () => {
      if (readThemePreference() === 'auto') applyTheme()
    }
    mql.addEventListener('change', onSystemChange)

    // Cross-tab sync
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) applyTheme()
    }
    window.addEventListener('storage', onStorage)

    // Apply reduced motion preference
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.documentElement.classList.toggle('reduce-motion', reduce)

    return () => {
      mql.removeEventListener('change', onSystemChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return <>{children}</>
}
