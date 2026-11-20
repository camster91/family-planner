// Feature setups ("presets") for the Features page (UI review item 11).
// A preset is a whole answer for every switchable feature: the keys it lists
// are on and every other switchable key is off. Core features are always on
// and are never part of a preset change (PATCH /api/family/features refuses
// to turn them off anyway). Applying one sends a single bulk PATCH with only
// the raw flags that differ, so a second parent's concurrent change to an
// unrelated key survives, and Undo sends the previous raw values back.

import {
  FEATURES,
  isFeatureEnabled,
  type FamilyFeatures,
  type FeatureKey,
} from '@/lib/features'

export type FeaturePresetKey = 'essentials' | 'school' | 'everything'

export const FEATURE_PRESET_ORDER: readonly FeaturePresetKey[] = [
  'essentials',
  'school',
  'everything',
]

/** Switchable features (not core) — the only keys a preset ever changes. */
export const SWITCHABLE_FEATURE_KEYS: readonly FeatureKey[] = FEATURES.filter(
  (feature) => feature.group !== 'core',
).map((feature) => feature.key)

const ESSENTIALS: readonly FeatureKey[] = ['meals']

const PRESET_ON: Record<FeaturePresetKey, readonly FeatureKey[]> = {
  // Calendar, chores, lists and the family page are core; meals is the one
  // switchable piece of a calm start.
  essentials: ESSENTIALS,
  // Essentials plus the school-run, sitter, notes and sick-day helpers.
  school: [
    ...ESSENTIALS,
    'notes',
    'pickups',
    'locations',
    'handoff',
    'sick-days',
  ],
  everything: SWITCHABLE_FEATURE_KEYS,
}

/** The full raw flag map a preset asks for (core always on). */
export function presetFlags(preset: FeaturePresetKey): FamilyFeatures {
  const on = new Set<FeatureKey>(PRESET_ON[preset])
  const out = {} as FamilyFeatures
  for (const feature of FEATURES) {
    out[feature.key] = feature.group === 'core' || on.has(feature.key)
  }
  return out
}

export interface PresetPlan {
  preset: FeaturePresetKey
  /** Raw flags to send in one PATCH `{ features }`. Empty = nothing to do. */
  changes: Partial<FamilyFeatures>
  /** Raw flags to send back for Undo (the values before `changes`). */
  undo: Partial<FamilyFeatures>
  /** Features a parent will see go from off to on, in catalog order. */
  turnOn: FeatureKey[]
  /** Features a parent will see go from on to off, in catalog order. */
  turnOff: FeatureKey[]
}

/**
 * What applying `preset` to `current` (raw stored flags) does. On/off lists
 * use the effective state (dependencies applied), so Rewards stored "on"
 * under a switched-off Points & streaks is not reported as "turning off".
 */
export function planPreset(
  current: FamilyFeatures,
  preset: FeaturePresetKey,
): PresetPlan {
  const target = presetFlags(preset)
  const changes: Partial<FamilyFeatures> = {}
  const undo: Partial<FamilyFeatures> = {}
  for (const key of SWITCHABLE_FEATURE_KEYS) {
    if (current[key] !== target[key]) {
      changes[key] = target[key]
      undo[key] = current[key]
    }
  }
  const turnOn: FeatureKey[] = []
  const turnOff: FeatureKey[] = []
  for (const key of SWITCHABLE_FEATURE_KEYS) {
    const before = isFeatureEnabled(current, key)
    const after = isFeatureEnabled(target, key)
    if (!before && after) turnOn.push(key)
    if (before && !after) turnOff.push(key)
  }
  return { preset, changes, undo, turnOn, turnOff }
}

/** The preset the household's effective features match exactly, or null (Custom). */
export function matchingPreset(
  current: FamilyFeatures,
): FeaturePresetKey | null {
  for (const preset of FEATURE_PRESET_ORDER) {
    const target = presetFlags(preset)
    if (
      SWITCHABLE_FEATURE_KEYS.every(
        (key) => isFeatureEnabled(current, key) === isFeatureEnabled(target, key),
      )
    )
      return preset
  }
  return null
}

/** Plain groups for the Features page list. Every feature is in exactly one. */
export type FeaturePageGroup = 'home' | 'school' | 'kids' | 'core'

export const FEATURE_PAGE_GROUPS: ReadonlyArray<{
  key: FeaturePageGroup
  features: readonly FeatureKey[]
}> = [
  {
    key: 'home',
    features: [
      'meals',
      'inventory',
      'notes',
      'anniversaries',
      'projects',
      'messages',
      'budget',
    ],
  },
  {
    key: 'school',
    features: ['pickups', 'locations', 'handoff', 'sick-days', 'travel'],
  },
  {
    key: 'kids',
    features: ['gamification', 'rewards', 'analytics', 'allowance', 'wishlist'],
  },
  {
    key: 'core',
    features: FEATURES.filter((feature) => feature.group === 'core').map(
      (feature) => feature.key,
    ),
  },
]
