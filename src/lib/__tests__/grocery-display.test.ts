import {
  buildGrocerySections,
  formatAmount,
  groceryDetailText,
  isGroceryListType,
  provenanceText,
  rowAmountText,
  type GroceryRowFields,
} from '@/lib/grocery-display'

type Row = GroceryRowFields & { checked?: boolean }

const row = (id: string, over: Partial<Row> = {}): Row => ({ id, content: id, quantity: 1, checked: false, ...over })
const isChecked = (r: Row) => r.checked === true

describe('grocery amount and provenance text (O-6)', () => {
  it('formats amount with an optional unit and trims float noise', () => {
    expect(formatAmount(400, 'g')).toBe('400 g')
    expect(formatAmount(6, null)).toBe('6')
    expect(formatAmount(0.1 + 0.2, ' kg ')).toBe('0.3 kg')
    expect(formatAmount(null, 'g')).toBeNull()
  })

  it('prefers amount+unit, else "× n" for quantity above one', () => {
    expect(rowAmountText({ amount: 2, unit: 'cans', quantity: 5 })).toBe('2 cans')
    expect(rowAmountText({ amount: null, unit: null, quantity: 3 })).toBe('× 3')
    expect(rowAmountText({ amount: null, unit: null, quantity: 1 })).toBeNull()
  })

  it('says where a recipe row came from', () => {
    expect(provenanceText({ recipe_title: 'Veggie lasagna' })).toBe('from Veggie lasagna')
    expect(provenanceText({ recipe_title: null })).toBeNull()
    expect(groceryDetailText({ amount: 6, unit: null, quantity: 1, recipe_title: 'Veggie lasagna' })).toBe('6 · from Veggie lasagna')
    expect(groceryDetailText({ amount: null, unit: null, quantity: 1, recipe_title: null })).toBeNull()
  })

  it('knows the grocery list types', () => {
    expect(isGroceryListType('grocery')).toBe(true)
    expect(isGroceryListType('shopping')).toBe(true)
    expect(isGroceryListType('todo')).toBe(false)
    expect(isGroceryListType('meal_plan')).toBe(false)
  })
})

describe('buildGrocerySections (O-3: group open rows by ingredient)', () => {
  it('keeps generic lists as sorted category sections of plain rows', () => {
    const sections = buildGrocerySections([row('b', { category: 'Zoo' }), row('a'), row('c', { category: 'Bakery' })], isChecked)
    expect(sections.map((s) => s.category)).toEqual(['Bakery', 'Other', 'Zoo'])
    expect(sections.every((s) => s.entries.every((e) => e.kind === 'item'))).toBe(true)
  })

  it('groups open rows sharing an ingredient_id at the first row, one row per source', () => {
    const rows = [
      row('tom-lasagna', { ingredient_id: 'ing_tom', ingredient_name: 'Tomatoes', recipe_title: 'Lasagna' }),
      row('milk'),
      row('tom-soup', { ingredient_id: 'ing_tom', content: 'tomatoes', recipe_title: 'Soup' }),
    ]
    const [other] = buildGrocerySections(rows, isChecked)
    expect(other.entries).toHaveLength(2)
    const group = other.entries[0]
    expect(group.kind).toBe('group')
    if (group.kind !== 'group') throw new Error('expected group')
    expect(group.name).toBe('Tomatoes')
    expect(group.items.map((r) => r.id)).toEqual(['tom-lasagna', 'tom-soup'])
    expect(other.entries[1]).toEqual({ kind: 'item', item: rows[1] })
  })

  it('never groups checked rows and leaves a single open row plain', () => {
    const rows = [
      row('open', { ingredient_id: 'ing_tofu' }),
      row('bought', { ingredient_id: 'ing_tofu', checked: true }),
    ]
    const [section] = buildGrocerySections(rows, isChecked)
    expect(section.entries.map((e) => e.kind)).toEqual(['item', 'item'])
  })

  it('puts a group in the category of its first open row', () => {
    const rows = [
      row('a', { ingredient_id: 'ing_x', category: 'Produce' }),
      row('b', { ingredient_id: 'ing_x', category: 'Pantry' }),
    ]
    const sections = buildGrocerySections(rows, isChecked)
    expect(sections.map((s) => s.category)).toEqual(['Produce'])
  })
})
