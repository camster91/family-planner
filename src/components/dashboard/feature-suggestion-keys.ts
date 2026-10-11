import { isFeatureEnabled, type FamilyFeatures, type FeatureKey } from '@/lib/feature-flags'

/** Keep the lightweight eligibility check separate from the icon/card module. */
export const FEATURE_SUGGESTION_KEYS: readonly FeatureKey[] = ['rewards', 'budget', 'messages', 'notes']

export function pickFeatureSuggestionKeys(features: FamilyFeatures, limit = 3): FeatureKey[] {
  return FEATURE_SUGGESTION_KEYS.filter((key) => !isFeatureEnabled(features, key)).slice(0, limit)
}
