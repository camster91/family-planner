// Feature defaults and normalisation, with the Points & streaks flag (#248):
// new households default OFF, existing households (a stored blob that predates
// the key) stay ON, and Rewards/Analytics depend on it.

import fs from 'fs'
import path from 'path'
import {
  FEATURES,
  defaultFeatures,
  effectiveFeatures,
  isFeatureEnabled,
  normalizeFeatures,
} from '@/lib/features'

const ROOT = path.join(__dirname, '..', '..', '..')

describe('gamification feature flag (#248)', () => {
  it('is a toggleable (non-core) feature', () => {
    const meta = FEATURES.find((f) => f.key === 'gamification')
    expect(meta).toBeDefined()
    expect(meta!.group).not.toBe('core')
  })

  it('is OFF for a brand-new household', () => {
    expect(defaultFeatures().gamification).toBe(false)
    expect(normalizeFeatures(null).gamification).toBe(false)
    expect(normalizeFeatures(undefined).gamification).toBe(false)
    expect(normalizeFeatures(defaultFeatures()).gamification).toBe(false)
  })

  it('is ON for an existing household whose stored blob predates the key', () => {
    // The 20-key blob every family had before #248.
    const legacy = {
      chores: true, calendar: true, lists: true, family: true, meals: true, notes: true,
      anniversaries: true, rewards: true, budget: true, projects: true, messages: true,
      analytics: true, wishlist: false, emergency: true, locations: false, pickups: false,
      allowance: false, travel: false, handoff: false, 'sick-days': false,
    }
    expect(normalizeFeatures(legacy).gamification).toBe(true)
    expect(normalizeFeatures({}).gamification).toBe(true)
    expect(normalizeFeatures({ meals: false }).gamification).toBe(true)
  })

  it('keeps an explicit stored value either way', () => {
    expect(normalizeFeatures({ gamification: false }).gamification).toBe(false)
    expect(normalizeFeatures({ gamification: true }).gamification).toBe(true)
    // A non-boolean value is ignored like any other malformed key.
    expect(normalizeFeatures({ gamification: 'no' }).gamification).toBe(true)
  })

  it('leaves every other default unchanged', () => {
    const d = defaultFeatures()
    for (const f of FEATURES) {
      if (f.key === 'gamification') continue
      expect(normalizeFeatures({})[f.key]).toBe(d[f.key])
    }
  })

  it('drops unknown keys and ignores non-object blobs', () => {
    expect(normalizeFeatures({ bogus: true })).not.toHaveProperty('bogus')
    expect(normalizeFeatures([true])).toEqual(defaultFeatures())
    expect(normalizeFeatures('x')).toEqual(defaultFeatures())
  })
})

describe('isFeatureEnabled / effectiveFeatures', () => {
  it('Rewards and Analytics need Points & streaks', () => {
    const off = normalizeFeatures({ gamification: false, rewards: true, analytics: true })
    expect(off.rewards).toBe(true) // the raw flag is kept for the settings toggle
    expect(isFeatureEnabled(off, 'rewards')).toBe(false)
    expect(isFeatureEnabled(off, 'analytics')).toBe(false)
    expect(isFeatureEnabled(off, 'gamification')).toBe(false)
    expect(isFeatureEnabled(off, 'meals')).toBe(true)
    expect(effectiveFeatures(off)).toMatchObject({ rewards: false, analytics: false, meals: true })

    const on = normalizeFeatures({ gamification: true })
    expect(isFeatureEnabled(on, 'rewards')).toBe(true)
    expect(isFeatureEnabled(on, 'analytics')).toBe(true)
    expect(isFeatureEnabled({ ...on, rewards: false }, 'rewards')).toBe(false)
  })

  it('a brand-new household has Rewards and Analytics effectively off', () => {
    const d = defaultFeatures()
    expect(isFeatureEnabled(d, 'rewards')).toBe(false)
    expect(isFeatureEnabled(d, 'analytics')).toBe(false)
  })
})

describe('stored defaults stay in sync with defaultFeatures()', () => {
  it('prisma/schema.prisma Family.features default', () => {
    const schema = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8')
    const m = schema.match(/features\s+Json\?\s+@default\("((?:[^"\\]|\\.)*)"\)/)
    expect(m).not.toBeNull()
    expect(JSON.parse(m![1].replace(/\\"/g, '"'))).toEqual(defaultFeatures())
  })

  it('database/migration-features.sql: new-row default has the key, the ADD COLUMN backfill does not', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'database', 'migration-features.sql'), 'utf8')
    const setDefault = sql.match(/SET DEFAULT '([^']+)'::jsonb/)
    expect(setDefault).not.toBeNull()
    expect(JSON.parse(setDefault![1])).toEqual(defaultFeatures())
    // ADD COLUMN writes its default into every EXISTING row: it must not stamp
    // gamification=false on households that predate the flag.
    const addColumn = sql.match(/ADD COLUMN IF NOT EXISTS "features" JSONB\s+DEFAULT '([^']+)'::jsonb/)
    expect(addColumn).not.toBeNull()
    expect(JSON.parse(addColumn![1])).not.toHaveProperty('gamification')
  })

  it('scripts/migrate.js stamps gamification=true only where the key is absent', () => {
    const js = fs.readFileSync(path.join(ROOT, 'scripts', 'migrate.js'), 'utf8')
    expect(js).toMatch(/'\{"gamification":true\}'::jsonb/)
    expect(js).toMatch(/NOT \("features" \? 'gamification'\)/)
  })
})

describe('inventory feature flag (#263)', () => {
  it('is a toggleable planning feature that links to the inventory page', () => {
    const meta = FEATURES.find((f) => f.key === 'inventory')
    expect(meta).toMatchObject({ group: 'planning', href: '/dashboard/inventory', defaultEnabled: false })
    expect(meta!.legacyDefault).toBeUndefined()
    expect(meta!.requires).toBeUndefined()
  })

  it('is OFF for new households and for existing ones whose blob predates the key', () => {
    expect(defaultFeatures().inventory).toBe(false)
    expect(normalizeFeatures(null).inventory).toBe(false)
    expect(normalizeFeatures({}).inventory).toBe(false)
    expect(normalizeFeatures({ meals: true, gamification: true }).inventory).toBe(false)
    expect(isFeatureEnabled(normalizeFeatures({ inventory: true }), 'inventory')).toBe(true)
  })

  it('scripts/migrate.js stamps nothing for it (a missing key already reads as off)', () => {
    const js = fs.readFileSync(path.join(ROOT, 'scripts', 'migrate.js'), 'utf8')
    expect(js).not.toMatch(/"inventory":/)
  })
})
