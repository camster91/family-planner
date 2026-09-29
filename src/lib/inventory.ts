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
 * - Date kind (#158): `date_kind` says what `expires_on` means. A
 *   `best_before` date is about quality: after it the item is "Best before was
 *   N days ago" (check it) and still listed under "Use soon". A `use_by` date
 *   is about safety: after it the item is "Past use-by — don't eat" and is
 *   never "use soon" again. Old rows are `best_before`.
 * - Status (#158): `active`, `consumed` or `discarded`. "Used it" and "Throw
 *   away" finish an item (or reduce its amount) and write an
 *   `InventoryAdjustment`; Undo puts it back (`src/lib/inventory-adjust.ts`).
 *   Finished items leave every active list, "use soon" and "what can I cook".
 * - Roles: parent and teen write; child reads. Paired shared devices are
 *   refused on writes and have no inventory route; the Today board DTO (person
 *   and device) carries `getUseSoonItems` fields only for its "Use soon" tile.
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

/**
 * What an item's date means (#158). `best_before`: quality, the food may
 * still be fine after it. `use_by`: safety, do not eat it after the day.
 */
export const DATE_KINDS = ['best_before', 'use_by'] as const
export type DateKind = (typeof DATE_KINDS)[number]
export const DATE_KIND_LABELS: Record<DateKind, string> = {
  best_before: 'Best before',
  use_by: 'Use by',
}
export function asDateKind(value: string | null | undefined): DateKind {
  return value === 'use_by' ? 'use_by' : 'best_before'
}

/**
 * Optional food category (#158/#121). Stable ids; labels are display only.
 * Kept separate from grocery store sections (#273): an inventory needs
 * "Leftovers" and does not need "Household" or "Personal care".
 */
export const INVENTORY_CATEGORIES = [
  'produce',
  'dairy_eggs',
  'meat_fish',
  'bakery',
  'leftovers',
  'dry_goods',
  'snacks_drinks',
  'condiments',
  'other',
] as const
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number]
export const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  produce: 'Produce',
  dairy_eggs: 'Dairy & eggs',
  meat_fish: 'Meat & fish',
  bakery: 'Bakery',
  leftovers: 'Leftovers',
  dry_goods: 'Dry goods',
  snacks_drinks: 'Snacks & drinks',
  condiments: 'Sauces & condiments',
  other: 'Other',
}
export function asCategory(value: string | null | undefined): InventoryCategory | null {
  return value != null && (INVENTORY_CATEGORIES as readonly string[]).includes(value) ? (value as InventoryCategory) : null
}

/** Item lifecycle (#158). Only `active` items appear in lists and "use soon". */
export const INVENTORY_STATUSES = ['active', 'consumed', 'discarded'] as const
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number]
export function asStatus(value: string | null | undefined): InventoryStatus {
  return value === 'consumed' || value === 'discarded' ? value : 'active'
}

/** "Use soon" window when the caller does not pass one. */
export const DEFAULT_USE_SOON_DAYS = 3
export const MAX_WINDOW_DAYS = 365
export const INVENTORY_DEFAULT_LIMIT = 200
export const INVENTORY_MAX_LIMIT = 500
export const USE_SOON_MAX_LIMIT = 100
export const COOK_DEFAULT_LIMIT = 20
export const COOK_MAX_LIMIT = 50
/**
 * Upper bounds on the inputs of "what can I cook". They are read in full up to
 * these caps (one row past the cap is fetched to detect the cut); when either
 * is hit the response says `inputsTruncated: true` and the UI says the list
 * may be incomplete instead of claiming nothing matches.
 */
export const COOK_RECIPE_SCAN_LIMIT = 1000
export const COOK_INVENTORY_SCAN_LIMIT = 5000

/** Idempotency action for `POST /api/inventory` (#265); part of the request hash. */
export const INVENTORY_CREATE_ACTION = 'inventory-item.create'
/** Idempotency actions of the other inventory writes (#158); part of the request hash. */
export const INVENTORY_UPDATE_ACTION = 'inventory-item.update'
export const INVENTORY_DELETE_ACTION = 'inventory-item.delete'
export const INVENTORY_CONSUME_ACTION = 'inventory-item.consume'
export const INVENTORY_DISCARD_ACTION = 'inventory-item.discard'
export const INVENTORY_UNDO_ACTION = 'inventory-adjustment.undo'
/** Longest `q` search accepted by `GET /api/inventory`. */
export const INVENTORY_SEARCH_MAX = 100

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

const dateOnlyField = (field: string) =>
  z
    .union([z.string().regex(DATE_ONLY_RE, `${field} must be YYYY-MM-DD`), z.null()])
    .optional()
    .refine((v) => v == null || parseDateOnly(v) !== null, { message: `${field} is not a real date` })
const dateOnly = dateOnlyField('expires_on')
const dateKind = z.enum(DATE_KINDS, { message: `date_kind must be one of ${DATE_KINDS.join(', ')}` })
const category = z.union([z.enum(INVENTORY_CATEGORIES, { message: 'category is not a known category' }), z.null()]).optional()

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
    /** What `expires_on` means; default `best_before`. */
    date_kind: dateKind.optional(),
    category,
    purchased_on: dateOnlyField('purchased_on'),
    opened_on: dateOnlyField('opened_on'),
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
    date_kind: dateKind.optional(),
    category,
    purchased_on: dateOnlyField('purchased_on'),
    opened_on: dateOnlyField('opened_on'),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' })

/**
 * "Used it" (#158): `amount` is how much was used. Omitted or null uses the
 * whole item; a positive amount smaller than the item's amount leaves the rest.
 */
export const consumeInventorySchema = z
  .object({
    amount: z.union([z.number().finite().gt(0, 'amount must be more than 0').max(100000), z.null()]).optional(),
  })
  .strict()
/** "Throw away" (#158): the whole item. No fields. */
export const discardInventorySchema = z.object({}).strict()

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

/**
 * `expired`: a best-before day has passed (check it; it still counts as "use
 * soon"). `past_use_by`: a use-by day has passed (do not eat; never "use
 * soon"). `today` / `soon` (within `days`) / `later` / `none` (no date).
 */
export type ExpiryStatus = 'expired' | 'past_use_by' | 'today' | 'soon' | 'later' | 'none'

/**
 * Where an item's date sits relative to `today`. `soon` is within `days`
 * (tomorrow up to today + days). A passed use-by day is `past_use_by`, a
 * passed best-before day `expired`. Always shown with words, never colour alone.
 */
export function expiryStatus(
  expiresOn: Date | string | null | undefined,
  today: Date,
  days: number = DEFAULT_USE_SOON_DAYS,
  dateKind: DateKind | string | null = 'best_before'
): { status: ExpiryStatus; daysLeft: number | null } {
  if (!expiresOn) return { status: 'none', daysLeft: null }
  const day = parseDateOnly(toDateOnlyUTC(expiresOn))
  if (!day) return { status: 'none', daysLeft: null }
  const daysLeft = dayDiff(today, day)
  if (daysLeft < 0) return { status: asDateKind(dateKind) === 'use_by' ? 'past_use_by' : 'expired', daysLeft }
  if (daysLeft === 0) return { status: 'today', daysLeft }
  if (daysLeft <= days) return { status: 'soon', daysLeft }
  return { status: 'later', daysLeft }
}

/**
 * Words for an item's date; best-before and use-by are never conflated.
 * Best before: "Best before was 2 days ago", "Best before today",
 * "Best before tomorrow", "Best before in 3 days".
 * Use by: "Past use-by — don't eat", "Use by today", "Use by tomorrow",
 * "Use within 3 days".
 */
export function expiryLabel(
  status: ExpiryStatus,
  daysLeft: number | null,
  dateKind: DateKind | string | null = 'best_before'
): string {
  if (status === 'none' || daysLeft === null) return 'No date'
  if (status === 'past_use_by') return 'Past use-by — don\'t eat'
  const useBy = asDateKind(dateKind) === 'use_by'
  if (status === 'expired') {
    const ago = -daysLeft
    return ago === 1 ? 'Best before was yesterday' : `Best before was ${ago} days ago`
  }
  if (status === 'today') return useBy ? 'Use by today' : 'Best before today'
  if (daysLeft === 1) return useBy ? 'Use by tomorrow' : 'Best before tomorrow'
  return useBy ? `Use within ${daysLeft} days` : `Best before in ${daysLeft} days`
}

/** Statuses that belong in "use soon": a passed best-before, today, or soon. */
export function isUseSoonStatus(status: ExpiryStatus): status is 'expired' | 'today' | 'soon' {
  return status === 'expired' || status === 'today' || status === 'soon'
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
  date_kind: true,
  category: true,
  purchased_on: true,
  opened_on: true,
  status: true,
  finished_at: true,
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
  /** Older rows and fixtures may omit the #158 columns; they read as defaults. */
  date_kind?: string | null
  category?: string | null
  purchased_on?: Date | string | null
  opened_on?: Date | string | null
  status?: string | null
  finished_at?: Date | string | null
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
  /** What `expires_on` means (#158). */
  date_kind: DateKind
  category: InventoryCategory | null
  /** `YYYY-MM-DD` or null. */
  purchased_on: string | null
  /** `YYYY-MM-DD` or null. */
  opened_on: string | null
  status: InventoryStatus
  /** ISO time the item was used up or thrown away, or null while active. */
  finished_at: string | null
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
    date_kind: asDateKind(row.date_kind),
    category: asCategory(row.category),
    purchased_on: row.purchased_on ? toDateOnlyUTC(row.purchased_on) : null,
    opened_on: row.opened_on ? toDateOnlyUTC(row.opened_on) : null,
    status: asStatus(row.status),
    finished_at: row.finished_at ? isoString(row.finished_at) : null,
    added_by: row.added_by ?? null,
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
    expiry: expiryStatus(row.expires_on, today, days, row.date_kind ?? 'best_before'),
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
  /** What the date means (#158). */
  dateKind: DateKind
  daysLeft: number
  /** `expired` (a passed best-before), `today` or `soon`. Never a passed use-by. */
  status: 'expired' | 'today' | 'soon'
  /** e.g. "Best before was yesterday", "Use by today", "Best before in 2 days". */
  label: string
}

type InventoryReader = Pick<PrismaClient, 'inventoryItem'> | Prisma.TransactionClient

/**
 * Active items of one household to use soon, deterministically ordered:
 * - included: a date on or before `today + days`, except a use-by day that has
 *   passed (that food is "don't eat", never "use soon"); a passed best-before
 *   day stays in (most overdue first, labelled "Best before was …");
 * - excluded: items without a date, consumed and discarded items;
 * - order: date ascending, use-by before best-before on the same day, then
 *   name, then id.
 *
 * `useByCutoff` (default `today`) is the first day a use-by item still counts.
 * The Today board anchors `today` one UTC day ahead so every zone's local day
 * is covered, and passes an earlier cutoff so a viewer behind UTC still sees
 * "Use by today"; the client then drops rows that are past for its own day.
 *
 * The data helper for the inventory page and the Today board "Use soon" tile
 * (#262): it returns only the fields a shared surface may show. The caller
 * must already have proven the household (a session's family_id or an
 * authenticated device's).
 */
export async function getUseSoonItems(
  db: InventoryReader,
  familyId: string,
  opts: { today?: Date; days?: number; limit?: number; useByCutoff?: Date } = {}
): Promise<UseSoonItem[]> {
  const today = opts.today ?? startOfTodayUTC()
  const days = Math.min(Math.max(opts.days ?? DEFAULT_USE_SOON_DAYS, 0), MAX_WINDOW_DAYS)
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), USE_SOON_MAX_LIMIT)
  const useByCutoff = opts.useByCutoff ?? today
  const rows = await db.inventoryItem.findMany({
    where: {
      family_id: familyId,
      status: 'active',
      expires_on: { not: null, lte: addUTCDays(today, days) },
      OR: [{ date_kind: { not: 'use_by' } }, { expires_on: { gte: useByCutoff } }],
    },
    select: { id: true, name: true, location: true, expires_on: true, date_kind: true },
    orderBy: [{ expires_on: 'asc' }, { date_kind: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    take: limit,
  })
  return rows.flatMap((r) => {
    const kind = asDateKind(r.date_kind)
    // A use-by row the query kept only because the cutoff is earlier than
    // `today` (the board) is classified against the cutoff day; the board
    // client re-labels every row for the viewer's own day anyway.
    let { status, daysLeft } = expiryStatus(r.expires_on, today, days, kind)
    if (status === 'past_use_by') ({ status, daysLeft } = expiryStatus(r.expires_on, useByCutoff, days, kind))
    if (!isUseSoonStatus(status) || daysLeft === null) return []
    return [
      {
        id: r.id,
        name: r.name,
        location: asLocation(r.location),
        expiresOn: toDateOnlyUTC(r.expires_on!),
        dateKind: kind,
        daysLeft,
        status,
        label: expiryLabel(status, daysLeft, kind),
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
  date_kind?: string | null
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
    const { status } = expiryStatus(item.expires_on, today, days, item.date_kind ?? 'best_before')
    if (status === 'expired' || status === 'past_use_by') continue
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

export interface CookSuggestionsResult {
  suggestions: CookSuggestion[]
  /** Recipes read and ranked (at most the recipe cap). */
  recipesConsidered: number
  /** More ranked suggestions exist than `limit` returned. */
  truncated: boolean
  /**
   * The household has more recipes or non-expired items than the scan caps,
   * so some inputs were not considered and suggestions may be missing.
   */
  inputsTruncated: boolean
}

/**
 * Load one household's recipes and non-expired inventory and rank them (see
 * `rankCookableRecipes`). Expired items are filtered in the query, since they
 * never count. Inputs are capped (`COOK_*_SCAN_LIMIT`, overridable for tests);
 * hitting either cap sets `inputsTruncated`.
 */
export async function getCookSuggestions(
  db: CookReader,
  familyId: string,
  opts: { today?: Date; limit?: number; recipeCap?: number; inventoryCap?: number } = {}
): Promise<CookSuggestionsResult> {
  const today = opts.today ?? startOfTodayUTC()
  const limit = Math.min(Math.max(opts.limit ?? COOK_DEFAULT_LIMIT, 1), COOK_MAX_LIMIT)
  const recipeCap = Math.max(opts.recipeCap ?? COOK_RECIPE_SCAN_LIMIT, 1)
  const inventoryCap = Math.max(opts.inventoryCap ?? COOK_INVENTORY_SCAN_LIMIT, 1)

  const inventoryRows = await db.inventoryItem.findMany({
    where: { family_id: familyId, status: 'active', OR: [{ expires_on: null }, { expires_on: { gte: today } }] },
    select: { ingredient_id: true, name: true, expires_on: true, date_kind: true },
    orderBy: [{ id: 'asc' }],
    take: inventoryCap + 1,
  })
  const inventoryCut = inventoryRows.length > inventoryCap
  const inventory = inventoryCut ? inventoryRows.slice(0, inventoryCap) : inventoryRows
  if (inventory.length === 0) {
    return { suggestions: [], recipesConsidered: 0, truncated: false, inputsTruncated: false }
  }

  const recipeRows = await db.recipe.findMany({
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
    take: recipeCap + 1,
  })
  const recipesCut = recipeRows.length > recipeCap
  const recipes = recipesCut ? recipeRows.slice(0, recipeCap) : recipeRows

  const ranked = rankCookableRecipes(recipes, inventory, today)
  return {
    suggestions: ranked.slice(0, limit),
    recipesConsidered: recipes.length,
    truncated: ranked.length > limit,
    inputsTruncated: inventoryCut || recipesCut,
  }
}
