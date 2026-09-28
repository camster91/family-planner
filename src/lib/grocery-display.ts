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
  category: string
  entries: GroceryEntry<T>[]
}

const OTHER = 'Other'

/**
 * Sections by category (sorted by name, as the list page always did), with
 * open rows sharing an `ingredient_id` shown as one group at the position of
 * the first such row. A group sits in the category of its first open row, so
 * one ingredient is never split across two sections. A single open row for an
 * ingredient stays a plain row.
 */
export function buildGrocerySections<T extends GroceryRowFields>(
  items: readonly T[],
  isChecked: (item: T) => boolean
): GrocerySection<T>[] {
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
      push(first.category || OTHER, {
        kind: 'group',
        ingredientId: item.ingredient_id!,
        name: first.ingredient_name?.trim() || first.content,
        items: grouped,
      })
      continue
    }
    push(item.category || OTHER, { kind: 'item', item })
  }

  return [...sections.keys()].sort().map((category) => ({ category, entries: sections.get(category)! }))
}

/** Whether a list type is a grocery list (`SHOPPING_LIST_TYPES`). */
export function isGroceryListType(type: string | null | undefined): boolean {
  return (SHOPPING_LIST_TYPES as readonly string[]).includes(type ?? '')
}
