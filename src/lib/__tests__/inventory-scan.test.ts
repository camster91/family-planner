// Fridge photo scan helpers (#265): configuration, output parsing/cleaning.
// No network: the provider call is covered with a mocked fetch in
// src/app/api/inventory/__tests__/scan.test.ts.
import {
  INVENTORY_SCAN_DEFAULT_DAILY_LIMIT,
  INVENTORY_SCAN_DEFAULT_MODEL,
  INVENTORY_SCAN_MAX_ITEMS,
  SCAN_OUTPUT_JSON_SCHEMA,
  canScanInventory,
  cleanScanText,
  isInventoryScanConfigured,
  parseScanOutput,
  resolveInventoryScanConfig,
  scanSuggestionSchema,
} from '../inventory-scan'

describe('resolveInventoryScanConfig', () => {
  it('is off without a key (kill switch), including a blank key', () => {
    expect(resolveInventoryScanConfig({})).toBeNull()
    expect(resolveInventoryScanConfig({ INVENTORY_SCAN_ANTHROPIC_API_KEY: '   ' })).toBeNull()
    expect(isInventoryScanConfigured({})).toBe(false)
    // The text-capture key never turns scanning on.
    expect(isInventoryScanConfigured({ CAPTURE_AI_KEY: 'x' })).toBe(false)
  })

  it('defaults the model and daily cap', () => {
    expect(resolveInventoryScanConfig({ INVENTORY_SCAN_ANTHROPIC_API_KEY: 'k' })).toEqual({
      apiKey: 'k',
      model: INVENTORY_SCAN_DEFAULT_MODEL,
      dailyLimit: INVENTORY_SCAN_DEFAULT_DAILY_LIMIT,
    })
    expect(INVENTORY_SCAN_DEFAULT_MODEL).toBe('claude-sonnet-5')
  })

  it('accepts a model id override and a daily cap within 0..500; ignores junk', () => {
    const env = { INVENTORY_SCAN_ANTHROPIC_API_KEY: 'k', INVENTORY_SCAN_MODEL: 'claude-opus-5-5', INVENTORY_SCAN_DAILY_LIMIT: '0' }
    expect(resolveInventoryScanConfig(env)).toMatchObject({ model: 'claude-opus-5-5', dailyLimit: 0 })
    for (const model of ['https://evil.example/v1', 'Claude Sonnet', '../x', 'a'.repeat(80)]) {
      expect(resolveInventoryScanConfig({ ...env, INVENTORY_SCAN_MODEL: model })?.model).toBe(INVENTORY_SCAN_DEFAULT_MODEL)
    }
    for (const limit of ['-1', '501', '2.5', 'lots']) {
      expect(resolveInventoryScanConfig({ ...env, INVENTORY_SCAN_DAILY_LIMIT: limit })?.dailyLimit).toBe(
        INVENTORY_SCAN_DEFAULT_DAILY_LIMIT
      )
    }
  })
})

describe('canScanInventory', () => {
  it('is parent only', () => {
    expect(canScanInventory('parent')).toBe(true)
    for (const role of ['teen', 'child', '', null, undefined, 'admin']) expect(canScanInventory(role)).toBe(false)
  })
})

describe('cleanScanText', () => {
  it('removes controls, bidi overrides, zero-width characters and angle brackets and bounds the length', () => {
    expect(cleanScanText('  Milk\u0000\u202e\u200b  2%\n<b>x</b> ', 80)).toBe('Milk 2% b x /b')
    expect(cleanScanText('e\u0301clair', 80)).toBe('\u00e9clair')
    expect(cleanScanText('a'.repeat(200), 80)).toHaveLength(80)
  })
})

describe('parseScanOutput', () => {
  it('returns null unless the top level is { items: [] }', () => {
    for (const raw of [null, 'x', 42, [], {}, { items: 'milk' }, { items: null }]) {
      expect(parseScanOutput(raw)).toBeNull()
    }
    expect(parseScanOutput({ items: [] })).toEqual({ items: [], dropped: 0 })
  })

  it('cleans each item into the strict schema', () => {
    const out = parseScanOutput({
      items: [
        { name: ' Greek  yogurt ', amount: '2', unit: 'tubs', location: 'FRIDGE', confidence: '0.876' },
        { name: 'Ice cream', amount: 1e9, unit: '', location: 'freezer', confidence: -2 },
        { name: 'Rice', location: 'pantry' },
      ],
    })!
    expect(out.items).toEqual([
      { name: 'Greek yogurt', amount: 2, unit: 'tubs', location: 'fridge', confidence: 0.88 },
      { name: 'Ice cream', amount: null, unit: null, location: 'freezer', confidence: 0 },
      { name: 'Rice', amount: null, unit: null, location: 'pantry', confidence: 0.5 },
    ])
    for (const item of out.items) expect(scanSuggestionSchema.safeParse(item).success).toBe(true)
  })

  it('drops items without a usable name and counts them', () => {
    const out = parseScanOutput({ items: [{ name: '' }, { name: '42' }, { amount: 1 }, 'milk', null, { name: '!!' }] })!
    expect(out.items).toEqual([])
    expect(out.dropped).toBe(6)
  })

  it('merges duplicates by name and location, keeping the more confident one', () => {
    const out = parseScanOutput({
      items: [
        { name: 'Milk', location: 'fridge', confidence: 0.4 },
        { name: 'milk', location: 'fridge', confidence: 0.9 },
        { name: 'Milk', location: 'freezer', confidence: 0.6 },
      ],
    })!
    expect(out.items.map((i) => [i.name, i.location, i.confidence])).toEqual([
      ['milk', 'fridge', 0.9],
      ['Milk', 'freezer', 0.6],
    ])
    expect(out.dropped).toBe(1)
  })

  it('caps the list at 50 items', () => {
    const items = Array.from({ length: 300 }, (_, i) => ({ name: `Item ${i}`, confidence: 0.7 }))
    const out = parseScanOutput({ items })!
    expect(out.items).toHaveLength(INVENTORY_SCAN_MAX_ITEMS)
    expect(out.dropped).toBe(250)
  })
})

describe('SCAN_OUTPUT_JSON_SCHEMA', () => {
  it('requires every field and forbids extra properties (structured-output compatible)', () => {
    expect(SCAN_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false)
    const item = SCAN_OUTPUT_JSON_SCHEMA.properties.items.items
    expect(item.additionalProperties).toBe(false)
    expect([...item.required].sort()).toEqual(['amount', 'confidence', 'location', 'name', 'unit'])
    // No numeric or length constraints (unsupported by structured outputs; zod enforces them).
    expect(JSON.stringify(SCAN_OUTPUT_JSON_SCHEMA)).not.toMatch(/minimum|maximum|minLength|maxLength|maxItems/)
  })
})
