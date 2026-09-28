/**
 * Food inventory (#263): what the household has in the fridge, freezer and
 * pantry, what to use soon, and which saved recipes it covers ("what can I
 * cook"). Contract: docs/architecture/MEALS_AND_GROCERIES.md "Food inventory".
 *
 * - Household-scoped: every read and write is filtered by `family_id`, so
 *   another household's item id answers exactly like a missing one.
 * - Ingredient link (ADR-0007): an item may point at a canonical `Ingredient`
 *   of the SAME household. When the client does not send `ingredient_id`, the
 *   server links the item to an existing same-household ingredient whose name
 *   normalises equal (NFC, trimmed, inner whitespace collapsed,
 *   case-insensitive). It never creates an `Ingredient` from an inventory item:
 *   "leftover lasagne" or "ice pops" would otherwise fill the recipe
 *   ingredient catalogue. An unlinked item still counts for "what can I cook"
 *   through the same normalized-name comparison, so a recipe written later
 *   matches it without a relink.
 * - Dates: `expires_on` is date-only (`YYYY-MM-DD`, stored as a Postgres
 *   DATE). "Today" is the viewer's calendar day, sent as `today=YYYY-MM-DD`
 *   and accepted within one day of the server's UTC date (every real time
 *   zone is within that); without it the server's UTC day is used.
 * - Roles: parent and teen write; child reads. Paired shared devices are
 *   refused on writes and have no read route yet (a fridge-board tile can call
 *   `getUseSoonItems`, which returns only board-safe fields).
 */
import { z } from 'zod'
import type { Prisma, PrismaClient } from '@prisma/client'
import { normalizeName } from '@/lib/backfill/meals-groceries'
import { cleanIngredientName } from '@/lib/recipes'
import { DATE_ONLY_RE, addUTCDays, parseDateOnly, startOfTodayUTC, toDateOnlyUTC } from '@/lib/dates'

export const INVENTORY_LOCATIONS = ['fridge', 'freezer', 'pantry'] as const
export type InventoryLocation = (typeof INVENTORY_LOCATIONS)[number]

export const LOCATION_LABELS: Record<InventoryLocation, string> = {
  fridge: 'Fridge',
  freezer: 'Freezer',
  pantry: 'Pantry',
}

/** "Use soon" window when the caller does not pass one. */
export const DEFAULT_USE_SOON_DAYS = 3
export const MAX_WINDOW_DAYS = 365
export const INVENTORY_DEFAULT_LIMIT = 200
export const INVENTORY_MAX_LIMIT = 500
export const USE_SOON_MAX_LIMIT = 100
export const COOK_DEFAULT_LIMIT = 20
export const COOK_MAX_LIMIT = 50
/** Upper bound on recipes scanned for "what can I cook". */
export const COOK_RECIPE_SCAN_LIMIT = 500
/** Upper bound on inventory rows read for "what can I cook". */
export const COOK_INVENTORY_SCAN_LIMIT = 2000

export function canWriteInventory(role: string | undefined | null): boolean {
  return role === 'parent' || role === 'teen'
}

// ---------------------------------------------------------------------------
// Validation

const optionalText = (max: number) =>
  z
    .union([z.string().max(max).trim(), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v))

const dateOnly = z
  .union([z.string().regex(DATE_ONLY_RE, 'expires_on must be YYYY-MM-DD'), z.null()])
  .optional()
  .refine((v) => v == null || parseDateOnly(v) !== null, { message: 'expires_on is not a real date' })

const name = z.string().trim().min(1, 'Name is required').max(200)
const ingredientId = z.union([z.string().trim().min(1).max(128), z.null()]).optional()
const amount = z.union([z.number().finite().min(0).max(100000), z.null()]).optional()
const location = z.enum(INVENTORY_LOCATIONS)

export const createInventorySchema = z
  .object({
    name,
    /** Same-household ingredient; `null` = keep it free text; omitted = link by name when one exists. */
    ingredient_id: ingredientId,
    amount,
    unit: optionalText(32),
    location: location.optional(),
    expires_on: dateOnly,
  })
  .strict()

export const updateInventorySchema = z
  .object({
    name: name.optional(),
    ingredient_id: ingredientId,
    amount,
    unit: optionalText(32),
    location: location.optional(),
    expires_on: dateOnly,
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' })

export type CreateInventoryInput = z.infer<typeof createInventorySchema>
export type UpdateInventoryInput = z.infer<typeof updateInventorySchema>

export class InventoryInputError extends Error {}

// ---------------------------------------------------------------------------
// Dates

/**
 * The viewer's "today" as UTC midnight. `raw` is the client's local calendar
 * day; it must be a real `YYYY-MM-DD` within one day of the server's UTC date.
 * Returns null when it is malformed or out of range (a 400).
 */
export function resolveToday(raw: string | null | undefined, now: Date = new Date()): Date | null {
  const serverDay = startOfTodayUTC(now)
  if (raw == null || raw === '') return serverDay
  const day = parseDateOnly(raw)
  if (!day) return null
  const diff = Math.abs(dayDiff(serverDay, day))
  return diff <= 1 ? day : null
}

/** Whole days from `from` to `to` (both UTC-midnight dates). */
export function dayDiff(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/** Parse a whole-day window (`days`) query value; null when invalid. */
export function parseDays(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= MAX_WINDOW_DAYS ? n : null
}

export type ExpiryStatus = 'expired' | 'today' | 'soon' | 'later' | 'none'

/**
 * Where an expiry day sits relative to `today`. `soon` is within `days`
 * (tomorrow up to today + days). Always shown with words, never colour alone.
 */
export function expiryStatus(
  expiresOn: Date | string | null | undefined,
  today: Date,
  days: number = DEFAULT_USE_SOON_DAYS
): { status: ExpiryStatus; daysLeft: number | null } {
  if (!expiresOn) return { status: 'none', daysLeft: null }
  const day = parseDateOnly(toDateOnlyUTC(expiresOn))
  if (!day) return { status: 'none', daysLeft: null }
  const daysLeft = dayDiff(today, day)
  if (daysLeft < 0) return { status: 'expired', daysLeft }
  if (daysLeft === 0) return { status: 'today', daysLeft }
  if (daysLeft <= days) return { status: 'soon', daysLeft }
  return { status: 'later', daysLeft }
}

/** Human label for an expiry, e.g. "Expired 2 days ago", "Use today", "Use in 3 days". */
export function expiryLabel(status: ExpiryStatus, daysLeft: number | null): string {
  if (status === 'none' || daysLeft === null) return 'No date'
  if (status === 'expired') {
    const ago = -daysLeft
    return ago === 1 ? 'Expired yesterday' : `Expired ${ago} days ago`
  }
  if (status === 'today') return 'Use today'
  if (daysLeft === 1) return 'Use by tomorrow'
  return `Use in ${daysLeft} days`
}

// ---------------------------------------------------------------------------
// Rows and DTOs

export const INVENTORY_ITEM_SELECT = {
  id: true,
  name: true,
  ingredient_id: true,
  amount: true,
  unit: true,
  location: true,
  expires_on: true,
  added_by: true,
  created_at: true,
  updated_at: true,
} as const

export interface InventoryRow {
  id: string
  name: string
  ingredient_id: string | null
  amount: number | null
  unit: string | null
  location: string
  expires_on: Date | string | null
  added_by: string | null
  created_at: Date | string
  updated_at: Date | string
}

export interface InventoryItemDto {
  id: string
  name: string
  ingredient_id: string | null
  amount: number | null
  unit: string | null
  location: InventoryLocation
  /** `YYYY-MM-DD` or null. */
  expires_on: string | null
  added_by: string | null
  created_at: string
  updated_at: string
  expiry: { status: ExpiryStatus; daysLeft: number | null }
}

function isoString(value: Date | string | null | undefined): string {
  if (!value) return ''
  return typeof value === 'string' ? value : value.toISOString()
}

export function asLocation(value: string): InventoryLocation {
  return (INVENTORY_LOCATIONS as readonly string[]).includes(value) ? (value as InventoryLocation) : 'fridge'
}

export function toInventoryDto(row: InventoryRow, today: Date, days = DEFAULT_USE_SOON_DAYS): InventoryItemDto {
  return {
    id: row.id,
    name: row.name,
    ingredient_id: row.ingredient_id ?? null,
    amount: row.amount ?? null,
    unit: row.unit ?? null,
    location: asLocation(row.location),
    expires_on: row.expires_on ? toDateOnlyUTC(row.expires_on) : null,
    added_by: row.added_by ?? null,
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
    expiry: expiryStatus(row.expires_on, today, days),
  }
}

// ---------------------------------------------------------------------------
// Ingredient link

type IngredientReader = Pick<PrismaClient, 'ingredient'> | Prisma.TransactionClient

/**
 * The ingredient id to store for an item:
 * - `explicit` is a string: it must be an ingredient of `familyId`, otherwise
 *   `InventoryInputError('Ingredient not found')` (foreign and missing alike);
 * - `explicit` is null: the item stays free text;
 * - `explicit` is undefined: an existing same-household ingredient with the
 *   same normalized name, or null. Nothing is created.
 */
export async function resolveInventoryIngredient(
  db: IngredientReader,
  familyId: string,
  itemName: string,
  explicit: string | null | undefined
): Promise<string | null> {
  if (explicit === null) return null
  if (typeof explicit === 'string') {
    const owned = await db.ingredient.findFirst({ where: { id: explicit, family_id: familyId }, select: { id: true } })
    if (!owned) throw new InventoryInputError('Ingredient not found')
    return owned.id
  }
  const key = normalizeName(itemName)
  if (!key) return null
  const candidates = await db.ingredient.findMany({
    where: { family_id: familyId },
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
  return candidates.find((c) => normalizeName(c.name) === key)?.id ?? null
}

/** Display form of an item name: NFC, trimmed, inner whitespace collapsed. */
export const cleanItemName = cleanIngredientName

// ---------------------------------------------------------------------------
// "Use soon"

/** Board-safe "use soon" entry: no author, no ids other than the item's own. */
export interface UseSoonItem {
  id: string
  name: string
  location: InventoryLocation
  /** `YYYY-MM-DD`. */
  expiresOn: string
  daysLeft: number
  /** `expired`, `today` or `soon`. */
  status: Exclude<ExpiryStatus, 'later' | 'none'>
  /** e.g. "Expired yesterday", "Use today", "Use in 2 days". */
  label: string
}

type InventoryReader = Pick<PrismaClient, 'inventoryItem'> | Prisma.TransactionClient

/**
 * Items of one household that are expired or expire within `days` of
 * `today`, soonest (most overdue) first, then by name. The data helper for
 * the inventory page and, later, a fridge-board tile (#262): it returns only
 * the fields a shared surface may show. The caller must already have proven
 * the household (a session's family_id or an authenticated device's).
 */
export async function getUseSoonItems(
  db: InventoryReader,
  familyId: string,
  opts: { today?: Date; days?: number; limit?: number } = {}
): Promise<UseSoonItem[]> {
  const today = opts.today ?? startOfTodayUTC()
  const days = Math.min(Math.max(opts.days ?? DEFAULT_USE_SOON_DAYS, 0), MAX_WINDOW_DAYS)
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), USE_SOON_MAX_LIMIT)
  const rows = await db.inventoryItem.findMany({
    where: { family_id: familyId, expires_on: { not: null, lte: addUTCDays(today, days) } },
    select: { id: true, name: true, location: true, expires_on: true },
    orderBy: [{ expires_on: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    take: limit,
  })
  return rows.flatMap((r) => {
    const { status, daysLeft } = expiryStatus(r.expires_on, today, days)
    if (status === 'none' || status === 'later' || daysLeft === null) return []
    return [
      {
        id: r.id,
        name: r.name,
        location: asLocation(r.location),
        expiresOn: toDateOnlyUTC(r.expires_on!),
        daysLeft,
        status,
        label: expiryLabel(status, daysLeft),
      },
    ]
  })
}

// ---------------------------------------------------------------------------
// "What can I cook"

export interface CookRecipeInput {
  id: string
  title: string
  prep_time: number | null
  cook_time: number | null
  servings: number
  ingredients: Array<{ ingredient: { id: string; name: string } }>
}

export interface CookInventoryInput {
  ingredient_id: string | null
  name: string
  expires_on: Date | string | null
}

export interface CookIngredient {
  ingredientId: string
  name: string
}

export interface CookSuggestion {
  recipeId: string
  title: string
  prep_time: number | null
  cook_time: number | null
  servings: number
  totalCount: number
  haveCount: number
  missingCount: number
  /** haveCount / totalCount, 0–1, two decimals. */
  coverage: number
  /** In-stock ingredients that expire within the use-soon window (or today). */
  useSoonCount: number
  have: CookIngredient[]
  missing: CookIngredient[]
}

/**
 * Rank recipes by how much of them is in stock. Pure: no database access.
 *
 * - An ingredient is "in stock" when a non-expired inventory item links to it
 *   (`ingredient_id`), or when an UNLINKED non-expired item's normalized name
 *   equals the ingredient's normalized name. Expired items never count.
 * - Presence only: amounts and units are not compared (ADR-0007 O-3, no
 *   cross-unit arithmetic).
 * - Recipes without ingredients, or with nothing in stock, are left out.
 * - Order: coverage (desc), in-stock count (desc), use-soon count (desc),
 *   missing count (asc), title, id.
 */
export function rankCookableRecipes(
  recipes: readonly CookRecipeInput[],
  inventory: readonly CookInventoryInput[],
  today: Date,
  days: number = DEFAULT_USE_SOON_DAYS
): CookSuggestion[] {
  const haveIds = new Map<string, boolean>() // ingredient id -> expiring soon
  const haveNames = new Map<string, boolean>() // normalized name -> expiring soon (unlinked items only)
  for (const item of inventory) {
    const { status } = expiryStatus(item.expires_on, today, days)
    if (status === 'expired') continue
    const soon = status === 'today' || status === 'soon'
    if (item.ingredient_id) {
      haveIds.set(item.ingredient_id, (haveIds.get(item.ingredient_id) ?? false) || soon)
    } else {
      const key = normalizeName(item.name)
      if (key) haveNames.set(key, (haveNames.get(key) ?? false) || soon)
    }
  }

  const out: CookSuggestion[] = []
  for (const recipe of recipes) {
    const seen = new Set<string>()
    const have: CookIngredient[] = []
    const missing: CookIngredient[] = []
    let useSoonCount = 0
    for (const line of recipe.ingredients) {
      const ing = line.ingredient
      if (!ing || seen.has(ing.id)) continue
      seen.add(ing.id)
      const byId = haveIds.get(ing.id)
      const byName = haveNames.get(normalizeName(ing.name))
      const entry = { ingredientId: ing.id, name: ing.name }
      if (byId !== undefined || byName !== undefined) {
        have.push(entry)
        if (byId || byName) useSoonCount += 1
      } else {
        missing.push(entry)
      }
    }
    const totalCount = have.length + missing.length
    if (totalCount === 0 || have.length === 0) continue
    const byName = (a: CookIngredient, b: CookIngredient) => a.name.localeCompare(b.name) || a.ingredientId.localeCompare(b.ingredientId)
    out.push({
      recipeId: recipe.id,
      title: recipe.title,
      prep_time: recipe.prep_time,
      cook_time: recipe.cook_time,
      servings: recipe.servings,
      totalCount,
      haveCount: have.length,
      missingCount: missing.length,
      coverage: Math.round((have.length / totalCount) * 100) / 100,
      useSoonCount,
      have: have.sort(byName),
      missing: missing.sort(byName),
    })
  }

  return out.sort(
    (a, b) =>
      b.haveCount / b.totalCount - a.haveCount / a.totalCount ||
      b.haveCount - a.haveCount ||
      b.useSoonCount - a.useSoonCount ||
      a.missingCount - b.missingCount ||
      a.title.localeCompare(b.title) ||
      a.recipeId.localeCompare(b.recipeId)
  )
}

type CookReader = Pick<PrismaClient, 'inventoryItem' | 'recipe'> | Prisma.TransactionClient

/** Load one household's recipes and inventory and rank them (see `rankCookableRecipes`). */
export async function getCookSuggestions(
  db: CookReader,
  familyId: string,
  opts: { today?: Date; limit?: number } = {}
): Promise<{ suggestions: CookSuggestion[]; recipesConsidered: number; truncated: boolean }> {
  const today = opts.today ?? startOfTodayUTC()
  const limit = Math.min(Math.max(opts.limit ?? COOK_DEFAULT_LIMIT, 1), COOK_MAX_LIMIT)
  const inventory = await db.inventoryItem.findMany({
    where: { family_id: familyId },
    select: { ingredient_id: true, name: true, expires_on: true },
    orderBy: [{ id: 'asc' }],
    take: COOK_INVENTORY_SCAN_LIMIT,
  })
  if (inventory.length === 0) return { suggestions: [], recipesConsidered: 0, truncated: false }
  const recipes = await db.recipe.findMany({
    where: { family_id: familyId },
    select: {
      id: true,
      title: true,
      prep_time: true,
      cook_time: true,
      servings: true,
      // Owned through the recipe; the ingredient rows are the recipe's own.
      ingredients: { select: { ingredient: { select: { id: true, name: true } } } },
    },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
    take: COOK_RECIPE_SCAN_LIMIT,
  })
  const ranked = rankCookableRecipes(recipes, inventory, today)
  return {
    suggestions: ranked.slice(0, limit),
    recipesConsidered: recipes.length,
    truncated: ranked.length > limit,
  }
}
