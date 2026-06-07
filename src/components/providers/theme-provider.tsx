'use client'

/**
 * ThemeProvider — applies the user's saved theme preference (light/dark/auto)
 * to <html> at app boot, and runs on every page (not just settings).
 *
 * Reads from localStorage on mount, defaults to 'light' (the original
 * design), and respects prefers-color-scheme: dark when set to 'auto'.
 *
 * Also applies prefers-reduced-motion to <html> so CSS can opt animations
 * out at the root level.
 *
 * The settings page still works the same way — it writes the same
 * localStorage key, and any change triggers a re-application here.
 */
import * as React from 'react'

type Theme = 'light' | 'dark' | 'auto'
const STORAGE_KEY = 'familyPlanner_theme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    // 1. Apply theme
    const applyTheme = () => {
      const saved = (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY)) as Theme | null
      const theme: Theme = saved === 'dark' || saved === 'light' || saved === 'auto' ? saved : 'light'
      let isDark: boolean
      if (theme === 'dark') {
        isDark = true
      } else if (theme === 'light') {
        isDark = false
      } else {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      }
      document.documentElement.classList.toggle('dark', isDark)
    }
    applyTheme()

    // Listen for system theme changes when in 'auto' mode
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemChange = () => {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'auto' || !saved) applyTheme()
    }
    mql.addEventListener('change', onSystemChange)

    // Cross-tab sync
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) applyTheme()
    }
    window.addEventListener('storage', onStorage)

    // 2. Apply reduced motion preference
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.documentElement.classList.toggle('reduce-motion', reduce)

    return () => {
      mql.removeEventListener('change', onSystemChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return <>{children}</>
}
