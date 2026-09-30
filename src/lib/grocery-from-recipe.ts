/**
 * Recipe → grocery add (ADR-0007 child D, #253). Contract:
 * docs/architecture/MEALS_AND_GROCERIES.md §7.
 *
 * `POST /api/lists/items/from-recipe` wraps `addRecipeToGroceries` in
 * `withIdempotency` (key required); `POST /api/lists/items/undo-add` calls
 * `undoRecipeAdd`. `resolveDefaultGroceryList` is the one server rule for
 * "which grocery list" (O-4), shared with the capture flow.
 *
 * Duplicate rules (ADR-0007 "Duplicate and provenance rules"):
 * - Same `Idempotency-Key`: `withIdempotency` replays; this code never runs twice.
 * - Same ingredient, same source (`meal:<id>`, else `recipe:<id>`), still open
 *   on the same list: skipped by the partial unique index
 *   `ListItem_open_recipe_source_key` through `createMany({ skipDuplicates })`
 *   (`ON CONFLICT DO NOTHING`), so two different keys racing from two devices
 *   still leave one open row. Reported as `alreadyOnListCount`.
 * - Different source (another meal): its own row.
 * - Checked rows are outside the partial index, so they never block.
 * - Free-text lookalike (no `ingredient_id`, same normalized content): the row
 *   is still added and the pair is reported in `possibleDuplicates`; nothing is
 *   merged.
 *
 * Household ownership is nested: the recipe, meal and list are looked up with
 * the caller's `family_id`, so another household's id answers exactly like a
 * missing one. The ingredient ids come from the recipe itself, never from the
 * client unchecked.
 */
import { z } from 'zod'
import type { Prisma, PrismaClient } from '@prisma/client'
import { normalizeName } from '@/lib/backfill/meals-groceries'
import type { EffectResult } from '@/lib/idempotency'

/** Idempotency action name; part of the stored request hash. */
export const ADD_FROM_RECIPE_ACTION = 'grocery.add-from-recipe'
/** O-5: the original actor may undo their own add for this long. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000
export const FROM_RECIPE_MAX_INGREDIENTS = 100
export const POSSIBLE_DUPLICATES_LIMIT = 20
export const DEFAULT_GROCERY_LIST_NAME = 'Groceries'
/** Upper bound on free-text rows scanned for lookalikes (lists are small in practice). */
const LOOKALIKE_SCAN_LIMIT = 2000

const idString = z.string().trim().min(1).max(128)

export const addFromRecipeSchema = z
  .object({
    recipeId: idString,
    mealId: idString.optional(),
    listId: idString.optional(),
    servings: z.number().int().min(1).max(50).optional(),
    ingredientIds: z.array(idString).min(1).max(FROM_RECIPE_MAX_INGREDIENTS).optional(),
  })
  .strict()
  // Order and repeats in `ingredientIds` do not change the request, so they
  // must not change the idempotency hash either.
  .transform((v) => ({
    ...v,
    ingredientIds: v.ingredientIds ? [...new Set(v.ingredientIds)].sort() : undefined,
  }))

export type AddFromRecipeInput = z.infer<typeof addFromRecipeSchema>

export const undoAddSchema = z.object({ requestId: idString }).strict()

export interface PossibleDuplicate {
  ingredientId: string
  matchedItemId: string
}

/** Compact and bounded so it always fits the idempotency replay cap (8 KiB). */
export interface AddFromRecipeResponse {
  listId: string
  listName: string
  requestId: string
  createdCount: number
  alreadyOnListCount: number
  possibleDuplicates: PossibleDuplicate[]
  possibleDuplicatesTruncated: boolean
  /**
   * When undo stops being accepted (the request record's creation plus
   * `UNDO_WINDOW_MS`). Absolute, so a replay received minutes later does not
   * restart the window on the client.
   */
  undoExpiresAt: string
}

export interface UndoAddResponse {
  requestId: string
  removedCount: number
  /** Rows of that request someone already ticked; undo leaves them. */
  keptCheckedCount: number
}

export type FromRecipeErrorCode =
  | 'RECIPE_NOT_FOUND'
  | 'RECIPE_HAS_NO_INGREDIENTS'
  | 'INGREDIENT_NOT_IN_RECIPE'
  | 'MEAL_NOT_FOUND'
  | 'MEAL_RECIPE_MISMATCH'
  | 'LIST_NOT_FOUND'
  | 'LIST_NOT_GROCERY'
  | 'UNDO_NOT_FOUND'
  | 'UNDO_NOT_ALLOWED'
  | 'UNDO_WINDOW_EXPIRED'
  | 'UNDO_IN_PROGRESS'

const MESSAGES: Record<FromRecipeErrorCode, string> = {
  RECIPE_NOT_FOUND: 'Recipe not found.',
  RECIPE_HAS_NO_INGREDIENTS: 'This recipe has no ingredients to add.',
  INGREDIENT_NOT_IN_RECIPE: 'One of the chosen ingredients is not part of this recipe.',
  MEAL_NOT_FOUND: 'Meal not found.',
  MEAL_RECIPE_MISMATCH: 'That meal does not use this recipe.',
  LIST_NOT_FOUND: 'List not found.',
  LIST_NOT_GROCERY: 'Ingredients can only be added to a grocery or shopping list.',
  UNDO_NOT_FOUND: 'There is nothing to undo.',
  UNDO_NOT_ALLOWED: 'Only the person who added these items can undo it.',
  UNDO_WINDOW_EXPIRED: 'It is too late to undo this. Remove the items from the list instead.',
  UNDO_IN_PROGRESS: 'The add is still being saved. Try again in a moment.',
}

export interface ErrorBody {
  error: { code: FromRecipeErrorCode; message: string; retryable: boolean }
}

function fail(status: 400 | 403 | 404 | 409, code: FromRecipeErrorCode): { status: number; body: ErrorBody } {
  return { status, body: { error: { code, message: MESSAGES[code], retryable: code === 'UNDO_IN_PROGRESS' } } }
}

type Actor = { id: string; family_id: string }

// ---------------------------------------------------------------------------
// Default list (O-4)

export interface ResolvedList {
  id: string
  name: string
  type: string
  created: boolean
}

type TxDb = Pick<PrismaClient, '$transaction'>

const listSelect = { id: true, name: true, type: true } as const

/** Advisory-lock key: one per household, namespaced so it never meets another lock user. */
export function defaultGroceryListLockKey(familyId: string): string {
  return `default-grocery-list:${familyId}`
}

/**
 * The household's default grocery list: the most recently updated `grocery`
 * list, else the most recently updated `shopping` list (both are grocery lists,
 * ADR-0007 decision 3), else a new "Groceries" list. Runs under
 * `pg_advisory_xact_lock(hashtext(...))` per household, so concurrent first
 * adds from two devices create one list, not two.
 */
export async function resolveDefaultGroceryList(db: TxDb, familyId: string, userId: string): Promise<ResolvedList> {
  return db.$transaction((tx) => resolveDefaultGroceryListInTx(tx, familyId, userId))
}

/** Same as `resolveDefaultGroceryList`, inside a caller's transaction. */
export async function resolveDefaultGroceryListInTx(
  tx: Prisma.TransactionClient,
  familyId: string,
  userId: string
): Promise<ResolvedList> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${defaultGroceryListLockKey(familyId)}))`
  for (const type of ['grocery', 'shopping']) {
    const found = await tx.list.findFirst({
      where: { family_id: familyId, type },
      orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
      select: listSelect,
    })
    if (found) return { ...found, created: false }
  }
  const created = await tx.list.create({
    data: { family_id: familyId, name: DEFAULT_GROCERY_LIST_NAME, type: 'grocery', created_by: userId },
    select: listSelect,
  })
  return { ...created, created: true }
}

// ---------------------------------------------------------------------------
// Add

type AddDb = TxDb

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * The effect behind `POST /api/lists/items/from-recipe`. `requestId` is the
 * request's `IdempotencyRecord.id`, stamped on every created row as
 * `source_request_id` (undo and provenance).
 */
export async function addRecipeToGroceries(
  db: AddDb,
  input: AddFromRecipeInput,
  actor: Actor,
  requestId: string
): Promise<EffectResult> {
  // One transaction: the rows, their read-back and the lookalike scan commit
  // together. If anything after the insert throws, the rows roll back with
  // it, so withIdempotency releasing the record never strands rows whose
  // source_request_id points at a deleted request (they could not be undone).
  return db.$transaction((tx) => addInTx(tx, input, actor, requestId))
}

async function addInTx(
  db: Prisma.TransactionClient,
  input: AddFromRecipeInput,
  actor: Actor,
  requestId: string
): Promise<EffectResult> {
  const recipe = await db.recipe.findFirst({
    where: { id: input.recipeId, family_id: actor.family_id },
    select: {
      id: true,
      servings: true,
      ingredients: {
        select: {
          ingredient_id: true,
          amount: true,
          unit: true,
          ingredient: { select: { id: true, name: true, unit: true, family_id: true } },
        },
      },
    },
  })
  if (!recipe) return fail(404, 'RECIPE_NOT_FOUND')

  let mealServings: number | null = null
  if (input.mealId) {
    const meal = await db.familyMeal.findFirst({
      where: { id: input.mealId, family_id: actor.family_id },
      select: { id: true, recipe_id: true, servings: true },
    })
    if (!meal) return fail(404, 'MEAL_NOT_FOUND')
    if (meal.recipe_id !== recipe.id) return fail(400, 'MEAL_RECIPE_MISMATCH')
    mealServings = meal.servings ?? null
  }

  // Defensive: a recipe line whose ingredient is not in the household is never used.
  const lines = recipe.ingredients.filter((l) => l.ingredient && l.ingredient.family_id === actor.family_id)
  let selected = lines
  if (input.ingredientIds) {
    const byId = new Map(lines.map((l) => [l.ingredient_id, l]))
    if (input.ingredientIds.some((id) => !byId.has(id))) return fail(400, 'INGREDIENT_NOT_IN_RECIPE')
    selected = input.ingredientIds.map((id) => byId.get(id)!)
  }
  if (selected.length === 0) return fail(400, 'RECIPE_HAS_NO_INGREDIENTS')

  let list: { id: string; name: string }
  if (input.listId) {
    const found = await db.list.findFirst({
      where: { id: input.listId, family_id: actor.family_id },
      select: { id: true, name: true, type: true },
    })
    if (!found) return fail(404, 'LIST_NOT_FOUND')
    if (found.type !== 'grocery' && found.type !== 'shopping') return fail(400, 'LIST_NOT_GROCERY')
    list = found
  } else {
    list = await resolveDefaultGroceryListInTx(db, actor.family_id, actor.id)
  }

  const baseServings = recipe.servings > 0 ? recipe.servings : 1
  const targetServings = input.servings ?? mealServings ?? baseServings
  const factor = targetServings / baseServings
  const sourceKey = input.mealId ? `meal:${input.mealId}` : `recipe:${recipe.id}`

  const last = await db.listItem.findFirst({
    where: { list_id: list.id },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  const firstPosition = (last?.position ?? 0) + 1

  // One statement. The partial unique index turns an open duplicate of the
  // same (list, ingredient, source) into a skip, also under a concurrent race.
  await db.listItem.createMany({
    data: selected.map((line, i) => ({
      list_id: list.id,
      content: line.ingredient.name,
      checked: false,
      quantity: 1,
      amount: round2(line.amount * factor),
      unit: line.unit ?? line.ingredient.unit ?? null,
      ingredient_id: line.ingredient_id,
      recipe_id: recipe.id,
      meal_id: input.mealId ?? null,
      source: 'recipe',
      source_key: sourceKey,
      source_request_id: requestId,
      added_by: actor.id,
      position: firstPosition + i,
    })),
    skipDuplicates: true,
  })

  // Which of the selected ingredients this request now owns a row for. Read
  // back rather than trusting createMany's count, so a takeover after a crash
  // (same requestId) reports the rows the first attempt already wrote.
  const mine = await db.listItem.findMany({
    where: { list_id: list.id, source_request_id: requestId },
    select: { ingredient_id: true },
  })
  const createdIngredients = new Set(mine.map((r) => r.ingredient_id))
  const created = selected.filter((l) => createdIngredients.has(l.ingredient_id))

  const possibleDuplicates: PossibleDuplicate[] = []
  let possibleDuplicatesTruncated = false
  if (created.length > 0) {
    const freeText = await db.listItem.findMany({
      where: { list_id: list.id, checked: false, ingredient_id: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, content: true },
      take: LOOKALIKE_SCAN_LIMIT,
    })
    const byName = new Map<string, string>()
    for (const row of freeText) {
      const key = normalizeName(row.content)
      if (key && !byName.has(key)) byName.set(key, row.id)
    }
    for (const line of created) {
      const matchedItemId = byName.get(normalizeName(line.ingredient.name))
      if (!matchedItemId) continue
      if (possibleDuplicates.length >= POSSIBLE_DUPLICATES_LIMIT) {
        possibleDuplicatesTruncated = true
        break
      }
      possibleDuplicates.push({ ingredientId: line.ingredient_id, matchedItemId })
    }
  }

  const record = await db.idempotencyRecord.findUnique({ where: { id: requestId }, select: { created_at: true } })
  const undoFrom = record?.created_at ?? new Date()

  const body: AddFromRecipeResponse = {
    listId: list.id,
    listName: list.name,
    requestId,
    createdCount: created.length,
    alreadyOnListCount: selected.length - created.length,
    possibleDuplicates,
    possibleDuplicatesTruncated,
    undoExpiresAt: new Date(undoFrom.getTime() + UNDO_WINDOW_MS).toISOString(),
  }
  return { status: 201, body }
}

// ---------------------------------------------------------------------------
// Undo (O-5)

type UndoDb = Pick<PrismaClient, 'idempotencyRecord' | 'listItem'>

/**
 * Removes the still-unticked rows one from-recipe request created. Only the
 * person who made the request, only within `UNDO_WINDOW_MS` of it, only rows
 * that carry its `source_request_id`, were added by that person and sit on a
 * list of their household. Retrying an undo is harmless (it removes 0 rows).
 *
 * The idempotency record proves who made the request and when; the rows'
 * own provenance decides what is removed. The stored replay body is never read.
 */
export async function undoRecipeAdd(
  db: UndoDb,
  requestId: string,
  actor: Actor,
  now: Date = new Date()
): Promise<{ status: number; body: UndoAddResponse | ErrorBody }> {
  const record = await db.idempotencyRecord.findFirst({
    where: { id: requestId, family_id: actor.family_id, action: ADD_FROM_RECIPE_ACTION },
    select: { user_id: true, created_at: true, response_status: true },
  })
  if (!record) return fail(404, 'UNDO_NOT_FOUND')
  if (record.user_id !== actor.id) return fail(403, 'UNDO_NOT_ALLOWED')
  if (record.response_status == null) return fail(409, 'UNDO_IN_PROGRESS')
  const cutoff = new Date(now.getTime() - UNDO_WINDOW_MS)
  if (record.created_at.getTime() < cutoff.getTime()) return fail(409, 'UNDO_WINDOW_EXPIRED')

  const scope = {
    source_request_id: requestId,
    added_by: actor.id,
    list: { family_id: actor.family_id },
  }
  const removed = await db.listItem.deleteMany({
    where: { ...scope, checked: false, created_at: { gte: cutoff } },
  })
  const keptCheckedCount = await db.listItem.count({ where: { ...scope, checked: true } })
  return { status: 200, body: { requestId, removedCount: removed.count, keptCheckedCount } }
}
