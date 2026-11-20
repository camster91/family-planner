import {
  FEATURES,
  defaultFeatures,
  effectiveFeatures,
  type FamilyFeatures,
} from '@/lib/features'
import {
  FEATURE_PAGE_GROUPS,
  FEATURE_PRESET_ORDER,
  SWITCHABLE_FEATURE_KEYS,
  matchingPreset,
  planPreset,
  presetFlags,
} from '@/lib/feature-presets'

const allOn = Object.fromEntries(
  FEATURES.map((feature) => [feature.key, true]),
) as FamilyFeatures

describe('feature presets', () => {
  it('keeps every core feature on and respects dependencies', () => {
    for (const preset of FEATURE_PRESET_ORDER) {
      const flags = presetFlags(preset)
      for (const feature of FEATURES.filter((f) => f.group === 'core'))
        expect(flags[feature.key]).toBe(true)
      // No preset stores a feature on while what it needs is off.
      expect(effectiveFeatures(flags)).toEqual(flags)
    }
  })

  it('Essentials matches a brand-new household; Everything is all on', () => {
    expect(matchingPreset(defaultFeatures())).toBe('essentials')
    expect(presetFlags('everything')).toEqual(allOn)
    expect(matchingPreset(allOn)).toBe('everything')
    expect(matchingPreset({ ...defaultFeatures(), budget: true })).toBeNull()
  })

  it('Busy school year is Essentials plus the school-run helpers', () => {
    const school = presetFlags('school')
    const essentials = presetFlags('essentials')
    for (const key of SWITCHABLE_FEATURE_KEYS)
      if (essentials[key]) expect(school[key]).toBe(true)
    for (const key of ['pickups', 'handoff', 'locations', 'sick-days', 'notes'] as const)
      expect(school[key]).toBe(true)
    expect(school.budget).toBe(false)
  })

  it('never changes a core feature and sends only raw flags that differ', () => {
    const current: FamilyFeatures = { ...allOn, budget: false }
    const plan = planPreset(current, 'everything')
    expect(plan.changes).toEqual({ budget: true })
    expect(plan.undo).toEqual({ budget: false })
    const off = planPreset(allOn, 'essentials')
    for (const feature of FEATURES.filter((f) => f.group === 'core'))
      expect(off.changes).not.toHaveProperty(feature.key)
  })

  it('reports effective changes: a dependent already hidden is not "turning off"', () => {
    const current: FamilyFeatures = {
      ...defaultFeatures(),
      gamification: false,
      rewards: true,
    }
    const plan = planPreset(current, 'essentials')
    // The stored flag is cleaned up…
    expect(plan.changes).toEqual({ rewards: false })
    // …but nothing a parent can see changes.
    expect(plan.turnOff).toEqual([])
    expect(plan.turnOn).toEqual([])
  })

  it('lists a dependent as turning on when Everything turns on what it needs', () => {
    const plan = planPreset(defaultFeatures(), 'everything')
    expect(plan.turnOn).toEqual(
      expect.arrayContaining(['gamification', 'rewards', 'analytics']),
    )
  })

  it('undo restores the exact previous raw flags', () => {
    const current: FamilyFeatures = { ...allOn, wishlist: false }
    const plan = planPreset(current, 'school')
    const applied = { ...current, ...plan.changes }
    expect({ ...applied, ...plan.undo }).toEqual(current)
  })

  it('page groups list every feature exactly once', () => {
    const listed = FEATURE_PAGE_GROUPS.flatMap((group) => group.features)
    expect([...listed].sort()).toEqual(FEATURES.map((f) => f.key).sort())
    expect(new Set(listed).size).toBe(listed.length)
    const core = FEATURE_PAGE_GROUPS.find((group) => group.key === 'core')!
    expect([...core.features].sort()).toEqual(
      FEATURES.filter((f) => f.group === 'core').map((f) => f.key).sort(),
    )
  })
})
