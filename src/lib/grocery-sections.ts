/**
 * Store sections for grocery and shopping lists (#273).
 *
 * Pure and dependency-free, so the list page can group rows on the client
 * (offline ticks keep working, #162) and the server can resolve the `section`
 * it sends with each row.
 *
 * Resolution for one row (`resolveGrocerySection`), first match wins:
 *   1. the household's override for the row's normalized name
 *      (`GrocerySectionPreference`, set by "Move to…"),
 *   2. the linked ingredient's `section` (`Ingredient.section`),
 *   3. the built-in English keyword map below (`sectionForName`),
 *   4. `other`.
 */

export const GROCERY_SECTIONS = [
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
] as const

export type GrocerySectionId = (typeof GROCERY_SECTIONS)[number]

/**
 * Display labels. The list pages do not use `src/i18n` yet, so the labels live
 * here, keyed by the stable id the API stores and returns; a locale table can
 * replace this map without touching stored data.
 */
export const GROCERY_SECTION_LABELS: Record<GrocerySectionId, string> = {
  produce: 'Produce',
  bakery: 'Bakery',
  dairy_eggs: 'Dairy & eggs',
  meat_fish: 'Meat & fish',
  frozen: 'Frozen',
  pantry: 'Pantry',
  snacks_drinks: 'Snacks & drinks',
  household: 'Household',
  personal_care: 'Personal care',
  other: 'Other',
}

export function isGrocerySection(value: unknown): value is GrocerySectionId {
  return typeof value === 'string' && (GROCERY_SECTIONS as readonly string[]).includes(value)
}

export function grocerySectionLabel(section: GrocerySectionId): string {
  return GROCERY_SECTION_LABELS[section]
}

/**
 * The household key an override is stored under: NFC, trimmed, inner
 * whitespace collapsed, lower-cased. Same rule as `normalizeName`
 * (`src/lib/backfill/meals-groceries.ts`), repeated here so this module stays
 * import-free for the client bundle; a test keeps the two in step.
 */
export function sectionNameKey(raw: string | null | undefined): string {
  return (raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

// ---------------------------------------------------------------------------
// Keyword map: singular, lower-case, ASCII (accents are folded before lookup).
// Multi-word entries are matched as phrases and beat single words.

const WORDS: Record<Exclude<GrocerySectionId, 'other'>, readonly string[]> = {
  produce: [
    'apple', 'apricot', 'artichoke', 'arugula', 'asparagus', 'avocado', 'banana', 'basil', 'bean sprout',
    'beet', 'beetroot', 'bell pepper', 'berry', 'blackberry', 'blueberry', 'bok choy', 'broccoli',
    'broccolini', 'brussels sprout', 'butternut', 'cabbage', 'cantaloupe', 'carrot', 'cauliflower',
    'celery', 'celeriac', 'chard', 'cherry', 'cherry tomato', 'chili', 'chilli', 'chive', 'cilantro',
    'clementine', 'collard', 'coriander', 'corn', 'corn on the cob', 'sweetcorn', 'courgette',
    'cranberry', 'cucumber', 'date', 'dill', 'eggplant', 'aubergine', 'endive', 'fennel', 'fig',
    'fresh herb', 'garlic', 'ginger', 'grape', 'grapefruit', 'green bean', 'green onion', 'guava', 'herb',
    'honeydew', 'jalapeno', 'kale', 'kiwi', 'kohlrabi', 'leek', 'lemon', 'lemongrass', 'lettuce', 'lime',
    'lychee', 'mandarin', 'mango', 'melon', 'microgreen', 'mint', 'mixed green', 'mushroom', 'nectarine',
    'okra', 'onion', 'orange', 'oregano', 'papaya', 'parsley', 'parsnip', 'passion fruit', 'pea',
    'pea pod', 'peach', 'pear', 'pepper', 'persimmon', 'pineapple', 'plantain', 'plum', 'pomegranate',
    'potato', 'pumpkin', 'radish', 'raspberry', 'rhubarb', 'romaine', 'rosemary', 'rutabaga', 'sage',
    'salad', 'salad mix', 'scallion', 'shallot', 'snap pea', 'snow pea', 'spinach', 'baby spinach',
    'spring onion', 'sprout', 'squash', 'strawberry', 'sweet potato', 'swede', 'tangerine', 'thyme',
    'tomato', 'turnip', 'watercress', 'watermelon', 'yam', 'zucchini', 'fruit', 'vegetable', 'veg',
    'veggie', 'tofu', 'tempeh', 'kiwifruit', 'blood orange', 'baby carrot', 'red onion', 'white onion',
  ],
  bakery: [
    'bagel', 'baguette', 'bread', 'brioche', 'bun', 'cake', 'ciabatta', 'cookie', 'croissant', 'crumpet',
    'cupcake', 'danish', 'donut', 'doughnut', 'english muffin', 'focaccia', 'hot dog bun', 'hamburger bun',
    'burger bun', 'loaf', 'muffin', 'naan', 'pastry', 'pita', 'pitta', 'roll', 'rye bread', 'scone',
    'sourdough', 'tortilla', 'wrap', 'flatbread', 'pie', 'tart', 'challah', 'dinner roll',
    'sandwich bread', 'garlic bread', 'breadstick', 'chocolate chip cookie', 'brownie', 'quiche',
    'cinnamon roll', 'pretzel roll', 'birthday cake',
  ],
  dairy_eggs: [
    'butter', 'buttermilk', 'cheddar', 'cheese', 'cottage cheese', 'cream', 'cream cheese', 'creme fraiche',
    'egg', 'feta', 'ghee', 'gouda', 'half and half', 'halloumi', 'kefir', 'margarine', 'mascarpone', 'milk',
    'mozzarella', 'parmesan', 'ricotta', 'sour cream', 'whipping cream', 'heavy cream', 'double cream',
    'single cream', 'yogurt', 'yoghurt', 'brie', 'camembert', 'swiss cheese', 'string cheese', 'oat milk',
    'almond milk', 'soy milk', 'soya milk', 'custard', 'quark', 'paneer', 'egg white', 'pudding',
    'coffee creamer', 'creamer', 'skyr', 'goat cheese', 'blue cheese', 'grated cheese', 'dozen egg',
  ],
  meat_fish: [
    'bacon', 'beef', 'brisket', 'burger', 'hamburger', 'chicken', 'chicken breast', 'chicken thigh',
    'chorizo', 'cod', 'crab', 'deli meat', 'duck', 'fish', 'ground beef', 'ground turkey', 'ground pork',
    'ham', 'hot dog', 'lamb', 'lobster', 'meat', 'meatball', 'mince', 'mussel', 'pork', 'pork chop',
    'prawn', 'prosciutto', 'rib', 'salami', 'salmon', 'sausage', 'scallop', 'shrimp', 'steak', 'tilapia',
    'trout', 'tuna steak', 'turkey', 'veal', 'venison', 'wing', 'drumstick', 'pepperoni', 'pastrami',
    'haddock', 'halibut', 'mackerel', 'sardine', 'seafood', 'rotisserie chicken', 'sirloin',
    'tenderloin', 'roast', 'pulled pork', 'smoked salmon', 'frankfurter', 'bratwurst', 'kielbasa',
    'lunch meat', 'cold cut', 'fillet', 'oyster', 'clam', 'squid', 'calamari',
  ],
  frozen: [
    'frozen', 'ice cream', 'ice', 'ice pop', 'ice lolly', 'popsicle', 'fish finger', 'fish stick',
    'waffle', 'sorbet', 'gelato', 'hash brown', 'fries', 'french fries', 'oven chip', 'tater tot',
    'chicken nugget', 'nugget', 'tv dinner', 'ice cube', 'spring roll', 'frozen pizza', 'pizza',
    'ice cream cone', 'freezer meal',
  ],
  pantry: [
    'baking powder', 'baking soda', 'bean', 'black bean', 'broth', 'brown sugar', 'bulgur', 'chickpea',
    'cinnamon', 'cocoa', 'coconut milk', 'cornflake', 'corn flake', 'cornmeal', 'cornstarch', 'couscous',
    'cumin', 'curry paste', 'flour', 'granola', 'gravy', 'honey', 'hot sauce', 'jam', 'jelly', 'ketchup',
    'kidney bean', 'lasagna', 'lasagne', 'lasagna sheet', 'lasagne sheet', 'lentil', 'macaroni',
    'mac and cheese', 'macaroni cheese', 'maple syrup', 'mayo', 'mayonnaise', 'mustard', 'noodle',
    'egg noodle', 'nutella', 'oat', 'oatmeal', 'oil', 'olive oil', 'olive', 'paprika', 'pasta',
    'pasta sauce', 'peanut butter', 'almond butter', 'pesto', 'pickle', 'polenta', 'quinoa', 'rice',
    'salsa', 'salt', 'sauce', 'soup', 'soy sauce', 'spaghetti', 'spice', 'stock', 'stock cube', 'sugar',
    'syrup', 'tahini', 'tomato paste', 'tomato sauce', 'passata', 'tuna', 'vanilla', 'vinegar', 'yeast',
    'cereal', 'muesli', 'breadcrumb', 'bread crumb', 'panko', 'chocolate chip', 'coconut', 'almond',
    'walnut', 'cashew', 'pecan', 'pine nut', 'peanut', 'raisin', 'seed', 'chia seed', 'flaxseed',
    'sesame seed', 'black pepper', 'peppercorn', 'pepper flake', 'chili flake', 'bay leaf',
    'chili powder', 'curry powder', 'garlic powder', 'onion powder', 'ground ginger', 'nutmeg',
    'turmeric', 'bouillon', 'ramen', 'instant noodle', 'tortellini', 'penne', 'fusilli', 'rigatoni',
    'linguine', 'fettuccine', 'baked bean', 'refried bean', 'coffee', 'coffee bean', 'tea', 'tea bag',
    'green tea', 'herbal tea', 'cake mix', 'pancake mix', 'icing sugar', 'powdered sugar',
    'condensed milk', 'evaporated milk', 'worcestershire', 'sriracha', 'barbecue sauce', 'bbq sauce',
    'relish', 'caper', 'anchovy', 'spread', 'marmalade', 'molasses', 'agave', 'food coloring',
    'sprinkles', 'gelatin', 'jello', 'rice cake', 'dressing', 'salad dressing', 'baby food', 'formula',
    'dog food', 'cat food', 'pet food', 'dog treat', 'cat treat',
  ],
  snacks_drinks: [
    'beer', 'biscuit', 'candy', 'chip', 'potato chip', 'tortilla chip', 'chocolate', 'cider', 'cola',
    'cracker', 'crisp', 'drink', 'energy drink', 'granola bar', 'gum', 'juice', 'kombucha', 'lemonade',
    'nut', 'popcorn', 'pop', 'pop tart', 'pretzel', 'protein bar', 'snack', 'soda', 'sparkling water',
    'sweets', 'trail mix', 'water', 'wine', 'spirits', 'vodka', 'whisky', 'whiskey', 'gin', 'rum',
    'seltzer', 'tonic', 'iced tea', 'sports drink', 'gatorade', 'fruit snack', 'jerky', 'cereal bar',
    'mineral water', 'orange juice', 'apple juice', 'hot chocolate', 'squash drink', 'cordial',
    'rice cracker', 'dip', 'hummus', 'guacamole', 'marshmallow', 'licorice', 'lollipop', 'nacho',
    'jelly bean', 'ginger ale', 'root beer', 'milkshake', 'smoothie', 'coconut water',
  ],
  household: [
    'aluminum foil', 'aluminium foil', 'foil', 'battery', 'bin bag', 'bin liner', 'bleach', 'candle',
    'cleaner', 'cling film', 'cling wrap', 'plastic wrap', 'bubble wrap', 'detergent', 'dish soap',
    'dishwasher tablet', 'dishwasher pod', 'dishwashing liquid', 'washing up liquid', 'fabric softener',
    'garbage bag', 'kitchen roll', 'light bulb', 'lightbulb', 'laundry', 'laundry detergent', 'napkin',
    'paper plate', 'paper towel', 'parchment paper', 'baking paper', 'sandwich bag', 'freezer bag',
    'sponge', 'scouring pad', 'toilet paper', 'toilet roll', 'trash bag', 'wax paper', 'zip bag',
    'ziploc', 'air freshener', 'disinfectant', 'wipe', 'cleaning wipe', 'glass cleaner', 'scrubber',
    'rubber glove', 'mop', 'broom', 'dustpan', 'fly spray', 'match', 'lighter', 'charcoal', 'printer ink',
    'ink', 'tape', 'glue', 'straw', 'cup', 'plate', 'fork', 'spoon', 'knife', 'cutlery', 'bag',
    'storage bag', 'kitty litter', 'cat litter', 'descaler', 'stain remover', 'dryer sheet',
    'washing powder', 'washing liquid', 'bin', 'bucket', 'lint roller', 'hanger',
  ],
  personal_care: [
    'body wash', 'conditioner', 'contact lens solution', 'cotton bud', 'cotton pad', 'cotton swab',
    'deodorant', 'diaper', 'nappy', 'floss', 'dental floss', 'face wash', 'face cream', 'hand soap',
    'hand cream', 'sun cream', 'lip balm', 'lotion', 'moisturizer', 'moisturiser', 'mouthwash',
    'nail polish', 'pad', 'painkiller', 'paracetamol', 'ibuprofen', 'plaster', 'band aid', 'bandage',
    'razor', 'sanitary pad', 'shampoo', 'shaving cream', 'shower gel', 'soap', 'sunscreen', 'sunblock',
    'tampon', 'tissue', 'toothbrush', 'toothpaste', 'vitamin', 'baby wipe', 'baby oil', 'bath salt',
    'makeup', 'mascara', 'hair gel', 'hairspray', 'hair tie', 'medicine', 'cough syrup', 'allergy tablet',
    'antacid', 'q tip', 'dry shampoo', 'hand sanitizer', 'sanitizer', 'bubble bath', 'body lotion',
    'cold medicine', 'thermometer', 'nail file', 'comb', 'hairbrush',
  ],
}

/** Words that decide the section whatever else the name says ("frozen peas", "canned corn"). */
const MODIFIERS: Record<string, GrocerySectionId> = {
  frozen: 'frozen',
  canned: 'pantry',
  tinned: 'pantry',
  dried: 'pantry',
}

/** Lower-case ASCII words: accents folded, punctuation and digits dropped. */
function tokenize(raw: string): string[] {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

const LOOKUP: Map<string, GrocerySectionId> = (() => {
  const map = new Map<string, GrocerySectionId>()
  for (const [section, words] of Object.entries(WORDS) as Array<[GrocerySectionId, readonly string[]]>) {
    for (const word of words) {
      const key = tokenize(word).join(' ')
      // First listing wins, so an accidental duplicate never flips a section.
      if (key && !map.has(key)) map.set(key, section)
    }
  }
  return map
})()

const MAX_PHRASE = Math.max(...[...LOOKUP.keys()].map((k) => k.split(' ').length))

/** Number of phrases in the built-in map (the tests keep it at a few hundred). */
export const KEYWORD_COUNT = LOOKUP.size

/**
 * The word itself, then the singular forms an English plural may have, most
 * likely first: "cookies" → cookie, "berries" → berry, "tomatoes" → tomato,
 * "loaves" → loaf, "knives" → knife, "peaches" → peach. Words ending in
 * "ss", "us" or "is" (glass, hummus, tennis) are not plurals.
 */
export function singularForms(word: string): string[] {
  const forms = [word]
  if (word.length <= 3 || !word.endsWith('s') || /(ss|us|is)$/.test(word)) return forms
  forms.push(word.slice(0, -1))
  if (word.endsWith('es')) forms.push(word.slice(0, -2))
  if (word.endsWith('ies')) forms.push(word.slice(0, -3) + 'y')
  if (word.endsWith('ves')) forms.push(word.slice(0, -3) + 'f', word.slice(0, -3) + 'fe')
  return forms
}

/** A phrase's section; only its last word is tried in singular forms ("hot dog buns"). */
function lookup(words: string[]): GrocerySectionId | undefined {
  const head = words.slice(0, -1)
  for (const last of singularForms(words[words.length - 1])) {
    const section = LOOKUP.get([...head, last].join(' '))
    if (section) return section
  }
  return undefined
}

/**
 * The built-in section for a free-text name, or null when no keyword matches.
 * A modifier ("frozen", "canned", "tinned", "dried") decides first; otherwise
 * the longest matching phrase wins, and among equally long matches the one
 * furthest right (the head noun in English: "chocolate milk" is milk,
 * "chicken broth" is broth).
 */
export function sectionForName(name: string | null | undefined): GrocerySectionId | null {
  const words = tokenize(name ?? '')
  if (words.length === 0) return null
  for (const word of words) {
    const modifier = MODIFIERS[word]
    if (modifier) return modifier
  }
  for (let length = Math.min(MAX_PHRASE, words.length); length >= 1; length--) {
    // Rightmost first, so the first hit at this length is the head noun.
    for (let start = words.length - length; start >= 0; start--) {
      const section = lookup(words.slice(start, start + length))
      if (section) return section
    }
  }
  return null
}

export interface SectionInputs {
  /** The household override for this row's normalized name, if any. */
  override?: string | null
  /** `Ingredient.section` of the linked ingredient, if any. */
  ingredientSection?: string | null
  /** The row's text (`ListItem.content`). */
  name: string | null | undefined
  /** The linked ingredient's name, tried after the row's text. */
  ingredientName?: string | null
}

/** Override → ingredient section → keyword map (row text, then ingredient name) → `other`. */
export function resolveGrocerySection(input: SectionInputs): GrocerySectionId {
  if (isGrocerySection(input.override)) return input.override
  if (isGrocerySection(input.ingredientSection)) return input.ingredientSection
  return sectionForName(input.name) ?? sectionForName(input.ingredientName) ?? 'other'
}

// ---------------------------------------------------------------------------
// Walking order (#273): sections sorted by where the household usually ticks
// them in a shopping session.

/** Sessions needed (each with at least two sections) before a learned order is used. */
export const WALKING_ORDER_MIN_SESSIONS = 3

/**
 * The order sections are shown in. `sessions` are the sections in the order
 * they were first ticked in each recent shopping session. With fewer than
 * `WALKING_ORDER_MIN_SESSIONS` usable sessions the fixed order is returned.
 * Otherwise each section scores its mean relative position (0 = first ticked,
 * 1 = last) over the sessions it appears in; a section never ticked keeps its
 * fixed relative position. Ties fall back to the fixed order; `other` is
 * always last.
 */
export function sectionOrder(sessions: ReadonlyArray<ReadonlyArray<string>> = []): {
  order: GrocerySectionId[]
  learned: boolean
} {
  const fixed = [...GROCERY_SECTIONS]
  const usable = sessions
    .map((s) => [...new Set(s.filter((x): x is GrocerySectionId => isGrocerySection(x) && x !== 'other'))])
    .filter((s) => s.length >= 2)
  if (usable.length < WALKING_ORDER_MIN_SESSIONS) return { order: fixed, learned: false }

  const sums = new Map<GrocerySectionId, { total: number; count: number }>()
  for (const session of usable) {
    session.forEach((section, i) => {
      const entry = sums.get(section) ?? { total: 0, count: 0 }
      entry.total += i / (session.length - 1)
      entry.count += 1
      sums.set(section, entry)
    })
  }
  const movable: GrocerySectionId[] = fixed.filter((s) => s !== 'other')
  const score = (section: GrocerySectionId) => {
    const entry = sums.get(section)
    return entry ? entry.total / entry.count : movable.indexOf(section) / (movable.length - 1)
  }
  const order = [...movable].sort((a, b) => score(a) - score(b) || movable.indexOf(a) - movable.indexOf(b))
  return { order: [...order, 'other'], learned: true }
}
