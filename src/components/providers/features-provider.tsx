'use client'

import * as React from 'react'
import { FEATURES, normalizeFeatures, type FeatureKey, type FamilyFeatures } from '@/lib/features'

/**
 * useFeatures — client hook that returns the current family's feature flags.
 * Reads the initial set from a script tag rendered by the dashboard layout
 * (avoids an extra round-trip on every page load), and refreshes via the API
 * after the user toggles a flag.
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
    // SSR — fall back to defaults; client will hydrate with real values.
    return FEATURES.reduce((acc, f) => ({ ...acc, [f.key]: f.defaultEnabled }), {} as FamilyFeatures)
  }
  const tag = document.getElementById('family-features')
  if (!tag?.textContent) {
    return FEATURES.reduce((acc, f) => ({ ...acc, [f.key]: f.defaultEnabled }), {} as FamilyFeatures)
  }
  try {
    return normalizeFeatures(JSON.parse(tag.textContent))
  } catch {
    return FEATURES.reduce((acc, f) => ({ ...acc, [f.key]: f.defaultEnabled }), {} as FamilyFeatures)
  }
}

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const [features, setFeatures] = React.useState<FamilyFeatures>(() => readInitial())
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
    const defaults = FEATURES.reduce(
      (acc, f) => ({ ...acc, [f.key]: f.defaultEnabled }),
      {} as FamilyFeatures
    )
    return {
      features: defaults,
      setFeature: async () => undefined,
      refresh: async () => undefined,
      loading: false,
    }
  }
  return ctx
}

export function useFeatureEnabled(key: FeatureKey): boolean {
  const { features } = useFeatures()
  return features[key] === true
}
