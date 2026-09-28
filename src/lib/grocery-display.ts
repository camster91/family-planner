/**
 * Display rules for grocery list rows (ADR-0007, #252).
 *
 * - O-6: show `amount unit` when `amount` is set; otherwise fall back to the
 *   integer `quantity` ("× 3") when it is more than one.
 * - Provenance: a row that came from a recipe says "from <recipe title>".
 * - O-3: rows for the same ingredient from different sources stay separate
 *   rows (no quantity arithmetic across units) but are shown together: open
 *   rows are grouped by `ingredient_id`. Checked rows are never grouped.
 */
import { SHOPPING_LIST_TYPES } from '@/lib/shopping-snapshot'
import { isGrocerySection, resolveGrocerySection, sectionNameKey, type GrocerySectionId } from '@/lib/grocery-sections'

export interface GroceryRowFields {
  id: string
  content: string
  quantity?: number | null
  amount?: number | null
  unit?: string | null
  ingredient_id?: string | null
  ingredient_name?: string | null
  recipe_title?: string | null
  category?: string | null
  /** Resolved store section from the server (#273); grocery/shopping lists only. */
  section?: string | null
}

/** "1.5 kg", "6", "400 g"; trims float noise (0.1 + 0.2) to at most 2 decimals. */
export function formatAmount(amount: number | null | undefined, unit: string | null | undefined): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null
  const rounded = Math.round(amount * 100) / 100
  const text = String(rounded)
  const u = unit?.trim()
  return u ? `${text} ${u}` : text
}

/** Amount text for a row: `amount unit` when present (O-6), else "× n" for n > 1. */
export function rowAmountText(item: Pick<GroceryRowFields, 'amount' | 'unit' | 'quantity'>): string | null {
  const amount = formatAmount(item.amount, item.unit)
  if (amount) return amount
  if (typeof item.quantity === 'number' && item.quantity > 1) return `× ${item.quantity}`
  return null
}

/** "from Veggie lasagna" for rows linked to a recipe; null otherwise. */
export function provenanceText(item: Pick<GroceryRowFields, 'recipe_title'>): string | null {
  const title = item.recipe_title?.trim()
  return title ? `from ${title}` : null
}

/** One line of secondary text: amount and provenance joined, e.g. "6 · from Veggie lasagna". */
export function groceryDetailText(item: Pick<GroceryRowFields, 'amount' | 'unit' | 'quantity' | 'recipe_title'>): string | null {
  const parts = [rowAmountText(item), provenanceText(item)].filter((p): p is string => Boolean(p))
  return parts.length > 0 ? parts.join(' · ') : null
}

export type GroceryEntry<T> =
  | { kind: 'item'; item: T }
  | { kind: 'group'; ingredientId: string; name: string; items: T[] }

export interface GrocerySection<T> {
  /** Grouping key: the category text, or a store-section id (#273). */
  key: string
  /** Header text. */
  category: string
  entries: GroceryEntry<T>[]
}

const OTHER = 'Other'

export interface SectionOptions<T> {
  /** Grouping key for a row. Default: its category ("Other" when unset). */
  sectionOf?: (item: T) => string
  /** Keys in display order; keys not listed follow, by name. Default: by name. */
  order?: readonly string[]
  /** Header text for a key. Default: the key. */
  label?: (key: string) => string
}

/**
 * Sections (by category and sorted by name, as the list page always did, or
 * by store section in a given order, #273), with open rows sharing an
 * `ingredient_id` shown as one group at the position of the first such row.
 * A group sits in the section of its first open row, so one ingredient is
 * never split across two sections. A single open row for an ingredient stays a
 * plain row. Checked rows are never grouped; they stay in their own section at
 * their list position.
 */
export function buildGrocerySections<T extends GroceryRowFields>(
  items: readonly T[],
  isChecked: (item: T) => boolean,
  options: SectionOptions<T> = {}
): GrocerySection<T>[] {
  const sectionOf = options.sectionOf ?? ((item: T) => item.category || OTHER)
  const label = options.label ?? ((key: string) => key)
  const openByIngredient = new Map<string, T[]>()
  for (const item of items) {
    if (item.ingredient_id && !isChecked(item)) {
      const rows = openByIngredient.get(item.ingredient_id) ?? []
      rows.push(item)
      openByIngredient.set(item.ingredient_id, rows)
    }
  }

  const sections = new Map<string, GroceryEntry<T>[]>()
  const placed = new Set<string>()
  const push = (category: string, entry: GroceryEntry<T>) => {
    const list = sections.get(category) ?? []
    list.push(entry)
    sections.set(category, list)
  }

  for (const item of items) {
    const grouped = item.ingredient_id && !isChecked(item) ? openByIngredient.get(item.ingredient_id) : undefined
    if (grouped && grouped.length > 1) {
      if (placed.has(item.ingredient_id!)) continue
      placed.add(item.ingredient_id!)
      const first = grouped[0]
      push(sectionOf(first), {
        kind: 'group',
        ingredientId: item.ingredient_id!,
        name: first.ingredient_name?.trim() || first.content,
        items: grouped,
      })
      continue
    }
    push(sectionOf(item), { kind: 'item', item })
  }

  const order = options.order ?? []
  const rank = (key: string) => {
    const i = order.indexOf(key)
    return i < 0 ? order.length : i
  }
  return [...sections.keys()]
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => ({ key, category: label(key), entries: sections.get(key)! }))
}

/**
 * A row's store section (#273): the server-resolved `section` when present,
 * otherwise resolved here from the household overrides delivered with the
 * list and the built-in keyword map (a row added on this page before a
 * refresh). Works offline: no request is made.
 */
export function storeSectionOf(
  item: Pick<GroceryRowFields, 'content' | 'ingredient_name' | 'section'>,
  overrides: Readonly<Record<string, string>> = {}
): GrocerySectionId {
  if (isGrocerySection(item.section)) return item.section
  // A section id from a newer server that this client does not know is
  // `other` (API_CONTRACTS "Grocery store sections"), never re-guessed here.
  if (typeof item.section === 'string' && item.section !== '') return 'other'
  return resolveGrocerySection({
    override: overrides[sectionNameKey(item.content)],
    name: item.content,
    ingredientName: item.ingredient_name ?? null,
  })
}

/** Whether a list type is a grocery list (`SHOPPING_LIST_TYPES`). */
export function isGroceryListType(type: string | null | undefined): boolean {
  return (SHOPPING_LIST_TYPES as readonly string[]).includes(type ?? '')
}
