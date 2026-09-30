import {
  GROCERY_SECTIONS,
  GROCERY_SECTION_LABELS,
  KEYWORD_COUNT,
  WALKING_ORDER_MIN_SESSIONS,
  isGrocerySection,
  resolveGrocerySection,
  sectionForName,
  sectionNameKey,
  sectionOrder,
  singularForms,
} from '@/lib/grocery-sections'
import { normalizeName } from '@/lib/backfill/meals-groceries'

describe('store sections (#273)', () => {
  it('has the fixed sections in store order, each with a label', () => {
    expect(GROCERY_SECTIONS).toEqual([
      'produce',
      'bakery',
      'dairy_eggs',
      'meat_fish',
      'frozen',
      'pantry',
      'snacks_drinks',
      'household',
      'personal_care',
      'other',
    ])
    expect(GROCERY_SECTIONS.map((s) => GROCERY_SECTION_LABELS[s])).toEqual([
      'Produce',
      'Bakery',
      'Dairy & eggs',
      'Meat & fish',
      'Frozen',
      'Pantry',
      'Snacks & drinks',
      'Household',
      'Personal care',
      'Other',
    ])
    expect(isGrocerySection('pantry')).toBe(true)
    expect(isGrocerySection('Pantry')).toBe(false)
    expect(isGrocerySection('aisle-9')).toBe(false)
    expect(isGrocerySection(null)).toBe(false)
  })

  it('carries a few hundred keywords', () => {
    expect(KEYWORD_COUNT).toBeGreaterThanOrEqual(300)
  })

  it('keys overrides exactly like normalizeName', () => {
    for (const raw of ['  Cheddar   CHEESE ', 'Crème fraîche', 'Café́', 'éclair', '', 'Milk\t2%']) {
      expect(sectionNameKey(raw)).toBe(normalizeName(raw))
    }
    expect(sectionNameKey(null)).toBe('')
  })
})

describe('sectionForName: keyword map', () => {
  it.each([
    ['Bananas', 'produce'],
    ['Tomatoes', 'produce'],
    ['Home Tomato', 'produce'],
    ['Cherry tomatoes', 'produce'],
    ['Strawberries', 'produce'],
    ['Brussels sprouts', 'produce'],
    ['Sweet potatoes', 'produce'],
    ['Mangoes', 'produce'],
    ['Peaches', 'produce'],
    ['Jalapeño', 'produce'],
    ['Sourdough loaf', 'bakery'],
    ['Loaves', 'bakery'],
    ['Hot dog buns', 'bakery'],
    ['Chocolate chip cookies', 'bakery'],
    ['Quiches', 'bakery'],
    ['Milk', 'dairy_eggs'],
    ['Milk × 2', 'dairy_eggs'],
    ['1 dozen eggs', 'dairy_eggs'],
    ['Cheddar cheese', 'dairy_eggs'],
    ['Crème fraîche', 'dairy_eggs'],
    ['Chocolate milk', 'dairy_eggs'],
    ['Greek yogurt', 'dairy_eggs'],
    ['Ground beef', 'meat_fish'],
    ['2 lb chicken thighs', 'meat_fish'],
    ['Chicken wings', 'meat_fish'],
    ['Hot dogs', 'meat_fish'],
    ['Salmon fillets', 'meat_fish'],
    ['Ice cream', 'frozen'],
    ['Frozen peas', 'frozen'],
    ['frozen strawberries', 'frozen'],
    ['Fish fingers', 'frozen'],
    ['French fries', 'frozen'],
    ['Olive oil', 'pantry'],
    ['Canned corn', 'pantry'],
    ['Tinned tomatoes', 'pantry'],
    ['Sun-dried tomatoes', 'pantry'],
    ['Chicken broth', 'pantry'],
    ['Tomato soup', 'pantry'],
    ['Peanut butter', 'pantry'],
    ['Coconut milk', 'pantry'],
    ['Coffee beans', 'pantry'],
    ['Bay leaves', 'pantry'],
    ['Tea bags', 'pantry'],
    ['Lasagna sheets', 'pantry'],
    ['Spaghetti', 'pantry'],
    ['500g flour', 'pantry'],
    ['Potato chips', 'snacks_drinks'],
    ['Crisps', 'snacks_drinks'],
    ['Orange juice', 'snacks_drinks'],
    ['Sparkling water', 'snacks_drinks'],
    ['Hummus', 'snacks_drinks'],
    ['Dish soap', 'household'],
    ['Light bulbs', 'household'],
    ['Paper towels', 'household'],
    ['Printer ink (Family B)', 'household'],
    ['Batteries', 'household'],
    ['Knives', 'household'],
    ['Toothpaste', 'personal_care'],
    ['Baby wipes', 'personal_care'],
    ['Hand soap', 'personal_care'],
    ['Shampoo', 'personal_care'],
  ])('%s → %s', (name, section) => {
    expect(sectionForName(name)).toBe(section)
  })

  it('ignores case, spacing, punctuation and digits', () => {
    expect(sectionForName('  BANANAS  ')).toBe('produce')
    expect(sectionForName('bananas!!')).toBe('produce')
    expect(sectionForName('3x   bananas')).toBe('produce')
    expect(sectionForName('E2E aisles bananas')).toBe('produce')
  })

  it('prefers the longer phrase over a single word inside it', () => {
    expect(sectionForName('Ice cream')).toBe('frozen') // not "cream"
    expect(sectionForName('Sour cream')).toBe('dairy_eggs')
    expect(sectionForName('Peanut butter')).toBe('pantry') // not "butter"
    expect(sectionForName('Toilet paper roll')).toBe('household') // not bakery "roll"
    expect(sectionForName('Green beans')).toBe('produce') // not pantry "bean"
    expect(sectionForName('Tortilla chips')).toBe('snacks_drinks') // not bakery "tortilla"
  })

  it('among equal-length matches takes the rightmost word (the head noun)', () => {
    expect(sectionForName('Banana bread')).toBe('bakery')
    expect(sectionForName('Strawberry jam')).toBe('pantry')
    expect(sectionForName('Apple pie')).toBe('bakery')
  })

  it('lets frozen/canned/tinned/dried decide first', () => {
    expect(sectionForName('Frozen pizza')).toBe('frozen')
    expect(sectionForName('frozen chicken breast')).toBe('frozen')
    expect(sectionForName('Dried apricots')).toBe('pantry')
  })

  it('returns null when nothing matches', () => {
    expect(sectionForName('Zzyzx widget')).toBeNull()
    expect(sectionForName('')).toBeNull()
    expect(sectionForName('   ')).toBeNull()
    expect(sectionForName(null)).toBeNull()
    expect(sectionForName('123')).toBeNull()
  })

  it('singularForms covers common English plurals', () => {
    expect(singularForms('cookies')).toEqual(expect.arrayContaining(['cookie']))
    expect(singularForms('berries')).toEqual(expect.arrayContaining(['berry']))
    expect(singularForms('tomatoes')).toEqual(expect.arrayContaining(['tomato']))
    expect(singularForms('loaves')).toEqual(expect.arrayContaining(['loaf']))
    expect(singularForms('knives')).toEqual(expect.arrayContaining(['knife']))
    expect(singularForms('peaches')).toEqual(expect.arrayContaining(['peach']))
    expect(singularForms('glass')).toEqual(['glass'])
    expect(singularForms('hummus')).toEqual(['hummus'])
    expect(singularForms('peas')).toEqual(['peas', 'pea'])
    expect(singularForms('gas')).toEqual(['gas'])
  })
})

describe('resolveGrocerySection: override → ingredient → keyword → other', () => {
  it('uses the household override first', () => {
    expect(resolveGrocerySection({ override: 'household', ingredientSection: 'pantry', name: 'Milk' })).toBe('household')
  })

  it('then the linked ingredient section', () => {
    expect(resolveGrocerySection({ override: null, ingredientSection: 'frozen', name: 'Milk' })).toBe('frozen')
  })

  it('then the keyword map on the row text, then on the ingredient name', () => {
    expect(resolveGrocerySection({ name: 'Milk' })).toBe('dairy_eggs')
    expect(resolveGrocerySection({ name: 'Nana’s special', ingredientName: 'Bananas' })).toBe('produce')
  })

  it('falls back to other, and ignores unknown stored values', () => {
    expect(resolveGrocerySection({ name: 'Zzyzx widget' })).toBe('other')
    expect(resolveGrocerySection({ override: 'aisle-9', ingredientSection: 'nope', name: 'Milk' })).toBe('dairy_eggs')
  })
})

describe('sectionOrder: learned walking order', () => {
  const fixed = [...GROCERY_SECTIONS]

  it('keeps the fixed order without enough trips', () => {
    expect(sectionOrder()).toEqual({ order: fixed, learned: false })
    const two = [
      ['dairy_eggs', 'produce'],
      ['dairy_eggs', 'produce'],
    ]
    expect(sectionOrder(two)).toEqual({ order: fixed, learned: false })
  })

  it('ignores trips with fewer than two sections and unknown ids', () => {
    const sessions = [['dairy_eggs'], ['aisle-9', 'produce'], ['other', 'produce'], ['dairy_eggs', 'produce']]
    expect(sectionOrder(sessions).learned).toBe(false)
  })

  it(`learns from ${WALKING_ORDER_MIN_SESSIONS} trips and keeps other last`, () => {
    const sessions = [
      ['household', 'dairy_eggs', 'produce'],
      ['household', 'dairy_eggs', 'produce', 'other'],
      ['dairy_eggs', 'household', 'produce'],
    ]
    const { order, learned } = sectionOrder(sessions)
    expect(learned).toBe(true)
    expect(order).toHaveLength(GROCERY_SECTIONS.length)
    expect(new Set(order)).toEqual(new Set(GROCERY_SECTIONS))
    expect(order[order.length - 1]).toBe('other')
    // household and dairy come before produce; produce (always last ticked) after them.
    expect(order.indexOf('household')).toBeLessThan(order.indexOf('produce'))
    expect(order.indexOf('dairy_eggs')).toBeLessThan(order.indexOf('produce'))
    expect(order.indexOf('household')).toBeLessThan(order.indexOf('dairy_eggs'))
  })

  it('counts a section once per trip (its first tick)', () => {
    const sessions = Array.from({ length: 3 }, () => ['frozen', 'bakery', 'frozen'])
    const { order } = sectionOrder(sessions)
    expect(order.indexOf('frozen')).toBeLessThan(order.indexOf('bakery'))
  })
})
