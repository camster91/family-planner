import type { FamilyFeatures, FeatureKey } from './features'

export type { FamilyFeatures, FeatureKey } from './features'

/**
 * The dashboard shell only needs flag behaviour. Keep its dependency graph
 * separate from the full feature catalog (copy, grouping and Lucide icons),
 * which belongs to feature settings and feature pages.
 */
type FeatureFlagMeta = {
  key: FeatureKey
  defaultEnabled: boolean
  legacyDefault?: boolean
  requires?: FeatureKey
}

export const FEATURE_FLAG_META: readonly FeatureFlagMeta[] = [
  { key: 'chores', defaultEnabled: true },
  { key: 'calendar', defaultEnabled: true },
  { key: 'lists', defaultEnabled: true },
  { key: 'family', defaultEnabled: true },
  { key: 'meals', defaultEnabled: true },
  { key: 'inventory', defaultEnabled: false },
  { key: 'notes', defaultEnabled: false, legacyDefault: true },
  { key: 'anniversaries', defaultEnabled: false, legacyDefault: true },
  { key: 'gamification', defaultEnabled: false, legacyDefault: true },
  {
    key: 'rewards',
    defaultEnabled: false,
    legacyDefault: true,
    requires: 'gamification',
  },
  { key: 'budget', defaultEnabled: false, legacyDefault: true },
  { key: 'projects', defaultEnabled: false, legacyDefault: true },
  { key: 'messages', defaultEnabled: false, legacyDefault: true },
  {
    key: 'analytics',
    defaultEnabled: false,
    legacyDefault: true,
    requires: 'gamification',
  },
  { key: 'wishlist', defaultEnabled: false },
  { key: 'emergency', defaultEnabled: true },
  { key: 'locations', defaultEnabled: false },
  { key: 'pickups', defaultEnabled: false },
  { key: 'allowance', defaultEnabled: false },
  { key: 'travel', defaultEnabled: false },
  { key: 'handoff', defaultEnabled: false },
  { key: 'sick-days', defaultEnabled: false },
]

export function defaultFeatures(): FamilyFeatures {
  const out = {} as FamilyFeatures
  for (const feature of FEATURE_FLAG_META) {
    out[feature.key] = feature.defaultEnabled
  }
  return out
}

export function normalizeFeatures(raw: unknown): FamilyFeatures {
  const defaults = defaultFeatures()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults
  const object = raw as Record<string, unknown>
  for (const feature of FEATURE_FLAG_META) {
    if (typeof object[feature.key] === 'boolean') {
      defaults[feature.key] = object[feature.key] as boolean
    } else if (feature.legacyDefault !== undefined) {
      defaults[feature.key] = feature.legacyDefault
    }
  }
  return defaults
}

export function isFeatureEnabled(
  features: FamilyFeatures,
  key: FeatureKey,
): boolean {
  if (features[key] !== true) return false
  const feature = FEATURE_FLAG_META.find((candidate) => candidate.key === key)
  return feature?.requires
    ? isFeatureEnabled(features, feature.requires)
    : true
}

export function effectiveFeatures(features: FamilyFeatures): FamilyFeatures {
  const out = { ...features }
  for (const feature of FEATURE_FLAG_META) {
    out[feature.key] = isFeatureEnabled(features, feature.key)
  }
  return out
}
