/** Native D1 recipe -> grocery review, add and undo.
 *
 * This module deliberately keeps the recipe contract separate from generic
 * list-item writes. The recipe, meal, batch, ingredient and destination list
 * are all re-read through the household-scoped read facade; the effect then
 * commits the exact reviewed rows and receipt in one D1 batch.
 */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import type { PrismaClient } from "@prisma/client";
import {
  ADD_FROM_RECIPE_ACTION,
  DEFAULT_GROCERY_LIST_NAME,
  POSSIBLE_DUPLICATES_LIMIT,
  UNDO_WINDOW_MS,
  recipeGroceryAmount,
} from "@/lib/grocery-from-recipe-contract";
import type {
  AddFromRecipeInput,
  AddFromRecipeResponse,
  ErrorBody,
  FromRecipeErrorCode,
  PossibleDuplicate,
} from "@/lib/grocery-from-recipe";
import { normalizeName } from "@/lib/backfill/meals-groceries";
import {
  COOK_INVENTORY_SCAN_LIMIT,
  indexCookInventory,
  loadCookInventory,
  matchRecipeIngredients,
  resolveToday,
} from "@/lib/inventory";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/feature-flags";
import { isGroceryListType } from "@/lib/grocery-display";
import { D1PersonReceiptError, executeD1PersonEffect } from "./person-effect";
import { prepareD1ListItem } from "./list-write";
import type { NewListItem } from "@/lib/list-item-create";
import { authorizeD1Lists } from "./list-authority";
import { captureD1Reads } from "./read-witness";
import { d1WriteCheck } from "./write-check";
import { getD1Database, type D1Store } from "./database";
import {
  withD1ReadClient,
  type D1ReadClient,
  type NativeD1,
} from "./read-client";

const LOOKALIKE_SCAN_LIMIT = 2000;

const MESSAGES: Record<FromRecipeErrorCode, string> = {
  RECIPE_NOT_FOUND: "Recipe not found.",
  RECIPE_HAS_NO_INGREDIENTS: "This recipe has no ingredients to add.",
  INGREDIENT_NOT_IN_RECIPE:
    "One of the chosen ingredients is not part of this recipe.",
  BATCH_NOT_FOUND: "Bulk dish not found.",
  BATCH_SERVINGS_MISMATCH:
    "Review the whole dish’s portions before adding its ingredients.",
  BATCH_ALREADY_PREPARED:
    "This dish is already prepared. Plan the next prep to buy its ingredients again.",
  MEAL_NOT_FOUND: "Meal not found.",
  MEAL_RECIPE_MISMATCH: "That meal does not use this recipe.",
  LIST_NOT_FOUND: "List not found.",
  LIST_NOT_GROCERY:
    "Ingredients can only be added to a grocery or shopping list.",
  UNDO_NOT_FOUND: "There is nothing to undo.",
  UNDO_NOT_ALLOWED: "Only the person who added these items can undo it.",
  UNDO_WINDOW_EXPIRED:
    "It is too late to undo this. Remove the items from the list instead.",
  UNDO_IN_PROGRESS: "The add is still being saved. Try again in a moment.",
};

function fail(
  status: 400 | 403 | 404 | 409,
  code: FromRecipeErrorCode,
): { status: number; body: ErrorBody } {
  return {
    status,
    body: {
      error: {
        code,
        message: MESSAGES[code],
        retryable: code === "UNDO_IN_PROGRESS",
      },
    },
  };
}

type Actor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};

function asNative(database?: D1Store): NativeD1 | undefined {
  return database as unknown as NativeD1 | undefined;
}

async function authorizeD1RecipeGroceries(
  db: D1ReadClient,
  actor: Actor,
): Promise<EffectResult | null> {
  const lists = await authorizeD1Lists(db, actor);
  if (lists) return lists;
  const family = await db.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!isFeatureEnabled(normalizeFeatures(family?.features), "meals"))
    return {
      status: 403,
      body: { error: "This feature is turned off for your family" },
    };
  return null;
}

async function readRecipeContext(
  db: D1ReadClient,
  actor: Actor,
  input: AddFromRecipeInput,
) {
  const recipe = await db.recipe.findFirst({
    where: { id: input.recipeId, family_id: actor.familyId },
    select: {
      id: true,
      servings: true,
      ingredients: {
        select: {
          ingredient_id: true,
          amount: true,
          unit: true,
          ingredient: {
            select: { id: true, name: true, unit: true, family_id: true },
          },
        },
      },
    },
  });
  if (!recipe) return fail(404, "RECIPE_NOT_FOUND");

  let batchId = input.batchId;
  let mealServings: number | null = null;
  if (input.mealId) {
    const meal = await db.familyMeal.findFirst({
      where: { id: input.mealId, family_id: actor.familyId },
      select: { id: true, recipe_id: true, servings: true, batch_id: true },
    });
    if (!meal) return fail(404, "MEAL_NOT_FOUND");
    if (meal.recipe_id !== recipe.id) return fail(400, "MEAL_RECIPE_MISMATCH");
    mealServings = meal.servings ?? null;
    batchId = meal.batch_id ?? undefined;
  }

  let batchServings: number | null = null;
  if (batchId) {
    const batch = await db.mealBatch.findFirst({
      where: { id: batchId, family_id: actor.familyId },
      select: {
        total_servings: true,
        recipe_id: true,
        prep_session: { select: { family_id: true, prepared_at: true } },
      },
    });
    if (!batch || batch.prep_session.family_id !== actor.familyId)
      return fail(404, "BATCH_NOT_FOUND");
    if (batch.recipe_id !== recipe.id) return fail(400, "MEAL_RECIPE_MISMATCH");
    if (batch.prep_session.prepared_at !== null)
      return fail(409, "BATCH_ALREADY_PREPARED");
    if (input.servings !== undefined && input.servings !== batch.total_servings)
      return fail(400, "BATCH_SERVINGS_MISMATCH");
    batchServings = batch.total_servings;
  }

  const lines = recipe.ingredients.filter(
    (line) => line.ingredient && line.ingredient.family_id === actor.familyId,
  );
  let selected = lines;
  if (input.ingredientIds) {
    const byId = new Map(lines.map((line) => [line.ingredient_id, line]));
    if (input.ingredientIds.some((id) => !byId.has(id)))
      return fail(400, "INGREDIENT_NOT_IN_RECIPE");
    selected = input.ingredientIds.map((id) => byId.get(id)!);
  }
  if (selected.length === 0) return fail(400, "RECIPE_HAS_NO_INGREDIENTS");

  const list = input.listId
    ? await db.list.findFirst({
        where: { id: input.listId, family_id: actor.familyId },
        select: { id: true, name: true, type: true },
      })
    : null;
  if (input.listId && !list) return fail(404, "LIST_NOT_FOUND");
  if (list && !isGroceryListType(list.type))
    return fail(400, "LIST_NOT_GROCERY");

  const resolved =
    list ??
    (await db.list.findFirst({
      where: { family_id: actor.familyId, type: "grocery" },
      orderBy: [{ updated_at: "desc" }, { id: "asc" }],
      select: { id: true, name: true, type: true },
    })) ??
    (await db.list.findFirst({
      where: { family_id: actor.familyId, type: "shopping" },
      orderBy: [{ updated_at: "desc" }, { id: "asc" }],
      select: { id: true, name: true, type: true },
    }));

  const targetServings =
    batchServings ??
    input.servings ??
    mealServings ??
    (recipe.servings > 0 ? recipe.servings : 1);
  const baseServings = recipe.servings > 0 ? recipe.servings : 1;
  const sourceKey = batchId
    ? `batch:${batchId}`
    : input.mealId
      ? `meal:${input.mealId}`
      : `recipe:${recipe.id}`;
  return {
    recipe,
    lines,
    selected,
    list: resolved,
    targetServings,
    baseServings,
    sourceKey,
    createDefault: !resolved,
    batchId,
  } as const;
}

/** Read-only review; it never creates the default list or any other row. */
export async function readD1RecipeGroceryReview(
  actor: Actor,
  input: { recipeId: string; mealId?: string | null; batchId?: string | null },
  database?: D1Store,
): Promise<EffectResult> {
  return withD1ReadClient(async (db) => {
    const denied = await authorizeD1RecipeGroceries(db, actor);
    if (denied) return denied;
    const recipe = await db.recipe.findFirst({
      where: { id: input.recipeId, family_id: actor.familyId },
      select: {
        id: true,
        title: true,
        servings: true,
        ingredients: {
          select: {
            amount: true,
            unit: true,
            ingredient: {
              select: { id: true, name: true, unit: true, family_id: true },
            },
          },
        },
      },
    });
    if (!recipe) return { status: 404, body: { error: "Recipe not found" } };

    let targetServings = recipe.servings > 0 ? recipe.servings : 1;
    let batchId = input.batchId ?? null;
    if (input.mealId && batchId)
      return { status: 400, body: { error: "Choose a meal or a batch" } };
    if (input.mealId) {
      const meal = await db.familyMeal.findFirst({
        where: { id: input.mealId, family_id: actor.familyId },
        select: { recipe_id: true, servings: true, batch_id: true },
      });
      if (!meal) return { status: 404, body: { error: "Meal not found" } };
      if (meal.recipe_id !== recipe.id)
        return {
          status: 400,
          body: { error: "That meal does not use this recipe" },
        };
      targetServings = meal.servings ?? targetServings;
      batchId = meal.batch_id ?? null;
    }
    let batchPrepared: boolean | undefined;
    if (batchId) {
      const batch = await db.mealBatch.findFirst({
        where: { id: batchId, family_id: actor.familyId },
        select: {
          total_servings: true,
          recipe_id: true,
          prep_session: { select: { family_id: true, prepared_at: true } },
        },
      });
      if (!batch || batch.prep_session.family_id !== actor.familyId)
        return { status: 404, body: { error: "Bulk dish not found" } };
      if (batch.recipe_id !== recipe.id)
        return {
          status: 400,
          body: { error: "That dish does not use this recipe" },
        };
      targetServings = batch.total_servings;
      batchPrepared = batch.prep_session.prepared_at !== null;
    }
    const listRows = await db.list.findMany({
      where: {
        family_id: actor.familyId,
        type: { in: ["grocery", "shopping"] },
      },
      select: { id: true, name: true, type: true },
      orderBy: [{ type: "asc" }, { updated_at: "desc" }, { id: "asc" }],
      take: 101,
    });
    const ownedLines = recipe.ingredients.filter(
      (line) => line.ingredient?.family_id === actor.familyId,
    );
    let inventory:
      | { state: "unavailable" }
      | {
          state: "available";
          haveIngredientIds: string[];
          truncated: boolean;
          matching: "presence_only";
          matches: Array<{ ingredientId: string; kind: "linked" | "name" }>;
        } = { state: "unavailable" };
    try {
      const family = await db.family.findUnique({
        where: { id: actor.familyId },
        select: { features: true },
      });
      if (isFeatureEnabled(normalizeFeatures(family?.features), "inventory")) {
        const today = resolveToday(null)!;
        const loaded = await loadCookInventory(
          db as unknown as Pick<PrismaClient, "inventoryItem">,
          actor.familyId,
          {
            from: today,
            cap: COOK_INVENTORY_SCAN_LIMIT,
          },
        );
        const { have } = matchRecipeIngredients(
          ownedLines,
          indexCookInventory(loaded.items, today),
        );
        inventory = {
          state: "available",
          haveIngredientIds: have.map((item) => item.ingredientId),
          truncated: loaded.truncated,
          matching: "presence_only",
          matches: have.flatMap((item) =>
            item.match
              ? [{ ingredientId: item.ingredientId, kind: item.match }]
              : [],
          ),
        };
      }
    } catch {
      // Review remains usable when the optional inventory comparison is not.
    }
    return {
      status: 200,
      body: {
        recipeId: recipe.id,
        title: recipe.title,
        baseServings: recipe.servings > 0 ? recipe.servings : 1,
        targetServings,
        ...(batchId ? { batchPrepared } : {}),
        ingredients: ownedLines.map((line) => ({
          ingredientId: line.ingredient.id,
          name: line.ingredient.name,
          amount: line.amount,
          unit: line.unit ?? line.ingredient.unit ?? null,
        })),
        lists: listRows.slice(0, 100),
        listsTruncated: listRows.length > 100,
        defaultListId:
          (listRows.find((row) => row.type === "grocery") ?? listRows[0])?.id ??
          null,
        inventory,
      },
    };
  }, asNative(database));
}

/** Add recipe ingredients under the same receipt/provenance contract as PG. */
export function addD1RecipeToGroceries(
  actor: Actor,
  input: AddFromRecipeInput,
  key: string,
  database?: D1Store,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action: ADD_FROM_RECIPE_ACTION,
    input,
    key,
    database,
    now,
    authorize: (db) => authorizeD1RecipeGroceries(db, actor),
    plan: async (db, receiptId) => {
      const context = await readRecipeContext(db, actor, input);
      if ("status" in context) return context;
      const requestId = receiptId ?? randomUUID();
      let list = context.list;
      const createList = !list;
      if (!list)
        list = {
          id: randomUUID(),
          name: DEFAULT_GROCERY_LIST_NAME,
          type: "grocery",
        };

      const existing = await db.listItem.findMany({
        where: {
          list_id: list.id,
          checked: false,
          ingredient_id: {
            in: context.selected.map((line) => line.ingredient_id),
          },
          source_key: context.sourceKey,
        },
        select: { ingredient_id: true },
      });
      const already = new Set(existing.map((row) => row.ingredient_id));
      const created = context.selected.filter(
        (line) => !already.has(line.ingredient_id),
      );
      const last = await db.listItem.findFirst({
        where: { list_id: list.id },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const firstPosition = (last?.position ?? 0) + 1;

      const possibleDuplicates: PossibleDuplicate[] = [];
      let possibleDuplicatesTruncated = false;
      if (created.length > 0) {
        const freeText = await db.listItem.findMany({
          where: { list_id: list.id, checked: false, ingredient_id: null },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { id: true, content: true },
          take: LOOKALIKE_SCAN_LIMIT,
        });
        const byName = new Map<string, string>();
        for (const row of freeText) {
          const name = normalizeName(row.content);
          if (name && !byName.has(name)) byName.set(name, row.id);
        }
        for (const line of created) {
          const matchedItemId = byName.get(normalizeName(line.ingredient.name));
          if (!matchedItemId) continue;
          if (possibleDuplicates.length >= POSSIBLE_DUPLICATES_LIMIT) {
            possibleDuplicatesTruncated = true;
            break;
          }
          possibleDuplicates.push({
            ingredientId: line.ingredient_id,
            matchedItemId,
          });
        }
      }

      const body: AddFromRecipeResponse = {
        listId: list.id,
        listName: list.name,
        requestId,
        createdCount: created.length,
        alreadyOnListCount: context.selected.length - created.length,
        possibleDuplicates,
        possibleDuplicatesTruncated,
        undoExpiresAt: new Date(now.getTime() + UNDO_WINDOW_MS).toISOString(),
      };
      return {
        status: 201,
        body,
        effects: (session) => {
          const effects = [];
          if (createList)
            effects.push(
              d1WriteCheck(
                session,
                "NOT EXISTS (SELECT 1 FROM List WHERE family_id=?1 AND type IN ('grocery','shopping'))",
                [actor.familyId],
              ),
            );
          if (createList)
            effects.push(
              session
                .prepare(
                  "INSERT INTO List(id,family_id,name,type,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)",
                )
                .bind(
                  list.id,
                  actor.familyId,
                  list.name,
                  list.type,
                  actor.userId,
                  now.getTime(),
                ),
            );
          for (const [index, line] of created.entries()) {
            effects.push(
              d1WriteCheck(
                session,
                "NOT EXISTS (SELECT 1 FROM ListItem WHERE list_id=?1 AND ingredient_id=?2 AND source_key=?3 AND checked=0)",
                [list.id, line.ingredient_id, context.sourceKey],
              ),
              session
                .prepare(
                  "INSERT INTO ListItem(id,list_id,content,checked,quantity,added_by,position,created_at,updated_at,ingredient_id,recipe_id,meal_id,amount,unit,source,source_key,source_request_id) VALUES (?1,?2,?3,0,1,?4,?5,?6,?6,?7,?8,?9,?10,?11,'recipe',?12,?13)",
                )
                .bind(
                  randomUUID(),
                  list.id,
                  line.ingredient.name,
                  actor.userId,
                  firstPosition + index,
                  now.getTime(),
                  line.ingredient_id,
                  context.recipe.id,
                  input.mealId ?? null,
                  recipeGroceryAmount(
                    line.amount,
                    context.baseServings,
                    context.targetServings,
                  ),
                  line.unit ?? line.ingredient.unit ?? null,
                  context.sourceKey,
                  requestId,
                ),
            );
          }
          return effects;
        },
      };
    },
  });
}

/** Native counterpart of the strict person-only manual grocery add route. */
export function addD1GroceryItem(
  actor: Actor,
  input: NewListItem,
  key: string,
  database?: D1Store,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action: "list-item.grocery-add",
    input,
    key,
    database,
    now,
    authorize: async (db) => {
      const denied = await authorizeD1Lists(db, actor);
      if (denied) return denied;
      const list = await db.list.findFirst({
        where: { id: input.listId, family_id: actor.familyId },
        select: { type: true },
      });
      return !list || !isGroceryListType(list.type)
        ? { status: 404, body: { error: "Grocery list not found" } }
        : null;
    },
    plan: (db, receiptId) =>
      prepareD1ListItem(db, actor, input, receiptId, now, true),
  });
}

/** Undo only this actor's recent unchecked rows, retaining checked rows. */
export async function undoD1RecipeAdd(
  actor: Actor,
  requestId: string,
  now = new Date(),
  database?: D1Store,
): Promise<{ status: number; body: unknown }> {
  const store = database ?? (await getD1Database());
  const captured = await captureD1Reads(
    async (db) => {
      const denied = await authorizeD1Lists(db, actor);
      if (denied) return { kind: "reply" as const, reply: denied };
      const record = await db.idempotencyRecord.findFirst({
        where: {
          id: requestId,
          family_id: actor.familyId,
          action: ADD_FROM_RECIPE_ACTION,
        },
        select: { user_id: true, created_at: true, response_status: true },
      });
      if (!record)
        return { kind: "reply" as const, reply: fail(404, "UNDO_NOT_FOUND") };
      if (record.user_id !== actor.userId)
        return { kind: "reply" as const, reply: fail(403, "UNDO_NOT_ALLOWED") };
      if (record.response_status == null)
        return { kind: "reply" as const, reply: fail(409, "UNDO_IN_PROGRESS") };
      const cutoff = new Date(now.getTime() - UNDO_WINDOW_MS);
      if (record.created_at.getTime() < cutoff.getTime())
        return {
          kind: "reply" as const,
          reply: fail(409, "UNDO_WINDOW_EXPIRED"),
        };
      return {
        kind: "plan" as const,
        cutoff: cutoff.getTime(),
        createdAt: record.created_at.getTime(),
      };
    },
    store as unknown as NativeD1,
  );
  if (captured.value.kind === "reply") {
    await store
      .withSession("first-primary")
      .batch(captured.checks(store.withSession("first-primary")));
    return captured.value.reply;
  }
  const session = store.withSession("first-primary");
  const result = await session.batch([
    ...captured.checks(session),
    d1WriteCheck(
      session,
      "EXISTS (SELECT 1 FROM IdempotencyRecord WHERE id=?1 AND family_id=?2 AND user_id=?3 AND action=?4 AND response_status IS NOT NULL AND created_at=?5)",
      [
        requestId,
        actor.familyId,
        actor.userId,
        ADD_FROM_RECIPE_ACTION,
        captured.value.createdAt,
      ],
    ),
    session
      .prepare(
        "DELETE FROM ListItem WHERE source_request_id=?1 AND added_by=?2 AND checked=0 AND created_at>=?3 AND list_id IN (SELECT id FROM List WHERE family_id=?4)",
      )
      .bind(requestId, actor.userId, captured.value.cutoff, actor.familyId),
    session
      .prepare(
        "SELECT COUNT(*) AS total FROM ListItem WHERE source_request_id=?1 AND added_by=?2 AND checked=1 AND list_id IN (SELECT id FROM List WHERE family_id=?3)",
      )
      .bind(requestId, actor.userId, actor.familyId),
  ]);
  const checked = Number(
    (result.at(-1)?.results?.[0] as { total?: number } | undefined)?.total ?? 0,
  );
  return {
    status: 200,
    body: {
      requestId,
      removedCount: Number(result.at(-2)?.meta?.changes ?? 0),
      keptCheckedCount: checked,
    },
  };
}

export { D1PersonReceiptError };
