'use client'

import * as React from 'react'
import { defaultFeatures, isFeatureEnabled, normalizeFeatures, type FeatureKey, type FamilyFeatures } from '@/lib/features'

/**
 * useFeatures — client hook that returns the current family's feature flags.
 * The dashboard layout passes the initial set as a prop (so the server render
 * and hydration agree) and also renders it in a script tag; the API refreshes
 * it after the user toggles a flag.
 *
 * `features` are the RAW stored flags (what the Features settings toggles
 * show). To gate UI, use `useFeatureEnabled` / `isFeatureEnabled`, which also
 * apply dependencies (Rewards and Analytics need Points & streaks, #248).
 */
const Context = React.createContext<{
  features: FamilyFeatures
  setFeature: (key: FeatureKey, enabled: boolean) => Promise<void>
  refresh: () => Promise<void>
  loading: boolean
} | null>(null)

/** Read the feature blob from the inline <script id="family-features"> tag. */
function readInitial(): FamilyFeatures {
  if (typeof document === 'undefined') {
    // SSR without an `initial` prop — fall back to defaults.
    return defaultFeatures()
  }
  const tag = document.getElementById('family-features')
  if (!tag?.textContent) return defaultFeatures()
  try {
    // A stored blob — normalize it exactly like the server does.
    return normalizeFeatures(JSON.parse(tag.textContent))
  } catch {
    return defaultFeatures()
  }
}

export function FeaturesProvider({
  children,
  initial,
}: {
  children: React.ReactNode
  /** Normalized flags from the server; preferred over the script tag. */
  initial?: FamilyFeatures
}) {
  const [features, setFeatures] = React.useState<FamilyFeatures>(() => initial ?? readInitial())
  const [loading, setLoading] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/family/features', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setFeatures(normalizeFeatures(data.features))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const setFeature = React.useCallback(async (key: FeatureKey, enabled: boolean) => {
    // Optimistic update — UI flips immediately, we revert on error.
    setFeatures((prev) => ({ ...prev, [key]: enabled }))
    try {
      const res = await fetch('/api/family/features', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, enabled }),
      })
      if (!res.ok) throw new Error('Failed to update feature')
      const data = await res.json()
      setFeatures(normalizeFeatures(data.features))
    } catch (err) {
      // Revert
      setFeatures((prev) => ({ ...prev, [key]: !enabled }))
      throw err
    }
  }, [])

  return (
    <Context.Provider value={{ features, setFeature, refresh, loading }}>
      {children}
    </Context.Provider>
  )
}

export function useFeatures() {
  const ctx = React.useContext(Context)
  if (!ctx) {
    // No provider? Return safe defaults. Pages should not be rendered without
    // the provider, but a missing context shouldn't crash the whole tree.
    return {
      features: defaultFeatures(),
      setFeature: async () => undefined,
      refresh: async () => undefined,
      loading: false,
    }
  }
  return ctx
}

/** Whether a feature is effectively on (own flag AND any feature it requires). */
export function useFeatureEnabled(key: FeatureKey): boolean {
  const { features } = useFeatures()
  return isFeatureEnabled(features, key)
}
