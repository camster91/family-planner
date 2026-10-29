/** Native D1 meal-prep sessions, batches, allocations and consumption. */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import type { CreateMealPrepInput, MealPrepAction } from "@/lib/meal-batches";
import { batchPortionCounts } from "@/lib/meal-batches";
import { parseDateOnly, toDateOnlyUTC } from "@/lib/dates";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { mealRecipeSnapshot, RECIPE_SNAPSHOT_MAX_BYTES } from "@/lib/meal-recipe-history";
import { canonicalRecipeSource, legacyRecipeSource } from "@/lib/recipe-curation-contract";
import { executeD1PersonEffect, type NativePersonPlan, type NativePersonResult } from "./person-effect";
import { d1WriteCheck } from "./write-check";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { withD1ReadClient, type D1ReadClient } from "./read-client";

export type D1MealPrepActor = { userId: string; familyId: string; role: string; generation: number };
const failure = (status: number, code: string, message?: string): EffectResult => ({ status, body: { error: { code, message: message ?? "This prep action is unavailable. Check your plan and try again." } } });
const actorForEffect = (actor: D1MealPrepActor) => ({ userId: actor.userId, familyId: actor.familyId, role: actor.role, generation: actor.generation });

export async function authorizeD1MealPrep(db: D1ReadClient, actor: D1MealPrepActor): Promise<EffectResult | null> {
  const [user, family] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true, email_verified: true } }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ]);
  if (!user || user.family_id !== actor.familyId || user.token_version !== actor.generation || !user.email_verified) return failure(401, "UNAUTHORIZED", "Sign in again to manage prep sessions.");
  if (!['parent', 'teen'].includes(user.role) || user.role !== actor.role) return failure(403, "PLANNER_FORBIDDEN", "Only parents and teens can manage prep sessions.");
  if (!family) return failure(404, "HOUSEHOLD_UNAVAILABLE");
  if (!isFeatureEnabled(normalizeFeatures(family.features), "meals")) return failure(403, "MEALS_DISABLED");
  return null;
}

function plannedServings(meals: readonly { servings: number | null }[]) { return meals.reduce((n, meal) => n + (meal.servings ?? 0), 0); }

async function validCook(db: D1ReadClient, familyId: string, id: string | null | undefined) {
  return !id || Boolean(await db.user.findFirst({ where: { id, family_id: familyId }, select: { id: true } }));
}

async function createPlan(db: D1ReadClient, actor: D1MealPrepActor, input: CreateMealPrepInput, receiptId: string | null, now: Date): Promise<NativePersonPlan> {
  for (const dish of input.dishes) {
    if (dish.recipe_id && !(await db.recipe.findFirst({ where: { id: dish.recipe_id, family_id: actor.familyId }, select: { id: true } }))) return failure(404, "RECIPE_UNAVAILABLE");
    if (!(await validCook(db, actor.familyId, dish.cook_id))) return failure(400, "COOK_UNAVAILABLE");
    for (const meal of dish.meals) if (!(await validCook(db, actor.familyId, meal.cook_id))) return failure(400, "COOK_UNAVAILABLE");
  }
  const sessionId = randomUUID(), batchIds: string[] = [], mealIds: string[] = [];
  const nowMs = now.getTime();
  const prepInsert = (session: Pick<D1Store, "prepare">) => {
    const out: D1Statement[] = [session.prepare(`INSERT INTO "MealPrepSession"(id,family_id,prepared_on,next_prep_on,created_by,source_request_id,created_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(sessionId, actor.familyId, parseDateOnly(input.prepared_on)!.getTime(), input.next_prep_on ? parseDateOnly(input.next_prep_on)!.getTime() : null, actor.userId, receiptId, nowMs)];
    for (const [position, dish] of input.dishes.entries()) {
      const batchId = randomUUID(); batchIds.push(batchId);
      out.push(session.prepare(`INSERT INTO "MealBatch"(id,family_id,prep_session_id,position,name,total_servings,reserve_storage,recipe_id,cook_id,created_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`).bind(batchId, actor.familyId, sessionId, position, dish.name, dish.total_servings, dish.reserve_storage, dish.recipe_id ?? null, dish.cook_id ?? null, nowMs));
      for (const meal of dish.meals) { const id = randomUUID(); mealIds.push(id); const key = `${actor.familyId}:${randomUUID()}`; out.push(session.prepare(`INSERT INTO "FamilyMeal"(id,family_id,date,meal_type,recipe_name,notes,cook_id,created_by,created_at,recipe_id,batch_id,batch_allocation_key,servings,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?9)`).bind(id, actor.familyId, parseDateOnly(meal.date)!.getTime(), meal.meal_type, meal.recipe_name ?? dish.name, meal.notes ?? null, meal.cook_id !== undefined ? meal.cook_id : dish.cook_id ?? null, actor.userId, nowMs, dish.recipe_id ?? null, batchId, key, meal.servings)); }
    }
    return out;
  };
  return { status: 201, body: { sessionId, batchIds, mealIds }, effects: prepInsert };
}

async function recipeSnapshot(db: D1ReadClient, familyId: string, recipeId: string) {
  const recipe = await db.recipe.findFirst({ where: { id: recipeId, family_id: familyId }, select: { id: true, title: true, description: true, instructions: true, source_url: true, revision: true, servings: true, prep_time: true, cook_time: true, ingredients: { take: 101, orderBy: [{ ingredient: { name: "asc" } }, { ingredient_id: "asc" }, { id: "asc" }], select: { id: true, amount: true, unit: true, note: true, ingredient_id: true, ingredient: { select: { id: true, name: true, unit: true, family_id: true } } } } } });
  if (!recipe || recipe.ingredients.length > 100) return null;
  // RecipeIngredient has no household composite foreign key. Prove every
  // nested ingredient belongs to this family before recording its snapshot.
  if (recipe.ingredients.some((line) => line.ingredient.family_id !== familyId)) return null;
  const snapshot = mealRecipeSnapshot.safeParse({ v: 1, recipe: { id: recipe.id, title: recipe.title, description: recipe.description, instructions: recipe.instructions, source_url: recipe.source_url ? canonicalRecipeSource(recipe.source_url) : legacyRecipeSource(recipe.description), revision: recipe.revision, servings: recipe.servings, prep_time: recipe.prep_time, cook_time: recipe.cook_time, ingredients: recipe.ingredients.map(({ ingredient_id: _ingredientId, ingredient, ...line }) => ({ ...line, ingredient: { id: ingredient.id, name: ingredient.name, unit: ingredient.unit } })) } });
  if (!snapshot.success || new TextEncoder().encode(JSON.stringify(snapshot.data)).byteLength > RECIPE_SNAPSHOT_MAX_BYTES) return null;
  return snapshot.data;
}

async function actionPlan(db: D1ReadClient, actor: D1MealPrepActor, input: MealPrepAction, receiptId: string | null, now: Date): Promise<NativePersonPlan> {
  const action = input.action;
  if (action === "prepared" || action === "next-prep") {
    const session = await db.mealPrepSession.findFirst({ where: { id: input.session_id, family_id: actor.familyId }, select: { id: true, prepared_on: true, prepared_at: true, next_prep_on: true, batches: { orderBy: [{ position: "asc" }, { id: "asc" }], take: 9, select: { id: true, recipe_id: true, recipe_snapshot: true, recipe_snapshot_at: true } } } });
    if (!session) return failure(404, "SESSION_UNAVAILABLE");
    if (action === "next-prep") {
      const current = session.next_prep_on ? toDateOnlyUTC(session.next_prep_on) : null;
      if (current !== input.expected_next_prep_on) return failure(409, "STATE_CHANGED", "This plan changed elsewhere. Reload the latest prep session.");
      if (input.next_prep_on && parseDateOnly(input.next_prep_on)! < session.prepared_on) return failure(400, "BEFORE_PREPARATION", "Meal dates must be on or after preparation.");
      return { status: 200, body: { sessionId: session.id }, effects: (sql) => [d1WriteCheck(sql, `EXISTS(SELECT 1 FROM "MealPrepSession" WHERE id=?1 AND family_id=?2 AND next_prep_on IS ?3)`, [session.id, actor.familyId, session.next_prep_on ? session.next_prep_on.getTime() : null]), sql.prepare(`UPDATE "MealPrepSession" SET next_prep_on=?1 WHERE id=?2 AND family_id=?3`).bind(input.next_prep_on ? parseDateOnly(input.next_prep_on)!.getTime() : null, session.id, actor.familyId), d1WriteCheck(sql, "changes()=1")] };
    }
    if (session.prepared_at) return { status: 200, body: { sessionId: session.id }, effects: () => [] };
    if (!session.batches.length || session.batches.length > 8) return failure(409, "RECIPE_HISTORY_UNAVAILABLE");
    // Never silently overwrite or accept unexplained prior evidence. This is
    // the D1 equivalent of capturePrepRecipeHistory's guard and keeps the
    // prepared transition atomic when a recovery/retry races another writer.
    if (session.batches.some((batch) => batch.recipe_snapshot_at || batch.recipe_snapshot !== null)) return failure(409, "RECIPE_HISTORY_UNAVAILABLE");
    const captures: Array<{ id: string; snapshot: unknown }> = [];
    for (const batch of session.batches) if (batch.recipe_id) { const snapshot = await recipeSnapshot(db, actor.familyId, batch.recipe_id); if (!snapshot) return failure(409, "RECIPE_HISTORY_UNAVAILABLE"); captures.push({ id: batch.id, snapshot }); }
    const at = now.getTime();
    return { status: 200, body: { sessionId: session.id }, effects: (sql) => [d1WriteCheck(sql, `EXISTS(SELECT 1 FROM "MealPrepSession" WHERE id=?1 AND family_id=?2 AND prepared_at IS NULL)`, [session.id, actor.familyId]), ...captures.map((capture) => sql.prepare(`UPDATE "MealBatch" SET recipe_snapshot=?1,recipe_snapshot_at=?2 WHERE id=?3 AND family_id=?4 AND prep_session_id=?5 AND recipe_snapshot_at IS NULL`).bind(JSON.stringify(capture.snapshot), at, capture.id, actor.familyId, session.id)), sql.prepare(`UPDATE "MealPrepSession" SET prepared_at=?1 WHERE id=?2 AND family_id=?3 AND prepared_at IS NULL`).bind(at, session.id, actor.familyId), d1WriteCheck(sql, "changes()=1")] };
  }
  if (action === "undo-eaten") {
    const consumption = await db.mealBatchConsumption.findFirst({ where: { id: input.consumption_id, family_id: actor.familyId }, select: { id: true, cancelled_at: true } });
    if (!consumption) return failure(404, "CONSUMPTION_UNAVAILABLE");
    return { status: 200, body: { consumptionId: consumption.id }, effects: consumption.cancelled_at ? () => [] : (sql) => [sql.prepare(`UPDATE "MealBatchConsumption" SET cancelled_at=?1 WHERE id=?2 AND family_id=?3 AND cancelled_at IS NULL`).bind(now.getTime(), consumption.id, actor.familyId), d1WriteCheck(sql, "changes()=1")] };
  }
  const batch = await db.mealBatch.findFirst({ where: { id: input.batch_id, family_id: actor.familyId }, select: { id: true, family_id: true, total_servings: true, prep_session_id: true, prep_session: { select: { id: true, family_id: true, prepared_on: true, prepared_at: true } }, meals: { where: { family_id: actor.familyId }, take: 51, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, date: true, meal_type: true, servings: true, batch_allocation_key: true } }, consumption: { where: { family_id: actor.familyId, cancelled_at: null }, take: 51, orderBy: [{ consumed_at: "desc" }, { id: "desc" }], select: { id: true, meal_id: true, servings: true, consumed_at: true, allocation_key: true } } } });
  if (!batch || batch.prep_session.family_id !== actor.familyId) return failure(404, "BATCH_UNAVAILABLE");
  const counts = batchPortionCounts(batch.total_servings, batch.meals, batch.consumption);
  if (counts.unplanned < 0) return failure(409, "STATE_CHANGED", "This plan changed elsewhere. Reload the latest prep session.");
  if (action === "allocate") {
    if (input.require_prepared && !batch.prep_session.prepared_at) return failure(409, "PREP_NOT_READY", "Mark the session prepared before allocating portions.");
    let consumedOnRestore = 0;
    if (input.restore_allocation_key) {
      if (input.meals.length !== 1 || !input.restore_allocation_key.startsWith(`${actor.familyId}:`)) return failure(404, "MEAL_UNAVAILABLE");
      if (await db.familyMeal.findFirst({ where: { batch_allocation_key: input.restore_allocation_key, family_id: actor.familyId }, select: { id: true } })) return failure(409, "STATE_CHANGED");
      consumedOnRestore = batch.consumption.filter((row) => row.allocation_key === input.restore_allocation_key).reduce((n, row) => n + row.servings, 0);
      if (consumedOnRestore > input.meals[0].servings) return failure(409, "STATE_CHANGED");
    }
    const requested = input.meals.reduce((n, meal) => n + meal.servings, 0) - consumedOnRestore;
    if (requested > counts.unplanned) return failure(409, "BATCH_FULL", "Those portions are already planned or eaten. Reload the latest prep session.");
    if (input.meals.some((meal) => parseDateOnly(meal.date)! < batch.prep_session.prepared_on)) return failure(400, "BEFORE_PREPARATION", "Meal dates must be on or after preparation.");
    for (const meal of input.meals) if (!(await validCook(db, actor.familyId, meal.cook_id))) return failure(400, "COOK_UNAVAILABLE");
    const ids = input.meals.map(() => randomUUID()), at = now.getTime();
    return { status: 201, body: { batchId: batch.id, mealIds: ids }, effects: (sql) => { const effects: D1Statement[] = []; input.meals.forEach((meal, i) => effects.push(sql.prepare(`INSERT INTO "FamilyMeal"(id,family_id,date,meal_type,recipe_name,notes,cook_id,created_by,created_at,recipe_id,batch_id,batch_allocation_key,servings,updated_at)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,b.recipe_id,b.id,?10,?11,?9 FROM "MealBatch" b WHERE b.id=?12 AND b.family_id=?2`).bind(ids[i], actor.familyId, parseDateOnly(meal.date)!.getTime(), meal.meal_type, meal.recipe_name ?? "", meal.notes ?? null, meal.cook_id ?? null, actor.userId, at, input.restore_allocation_key && i === 0 ? input.restore_allocation_key : `${actor.familyId}:${randomUUID()}`, meal.servings, batch.id))); const idParams = ids.map((_, i) => `?${i + 1}`).join(","); effects.push(d1WriteCheck(sql, `SELECT count(*)=${ids.length} FROM "FamilyMeal" WHERE id IN (${idParams}) AND batch_id=?${ids.length + 1} AND family_id=?${ids.length + 2}`, [...ids, batch.id, actor.familyId])); if (input.restore_allocation_key) effects.push(sql.prepare(`UPDATE "MealBatchConsumption" SET meal_id=?1 WHERE allocation_key=?2 AND batch_id=?3 AND family_id=?4 AND cancelled_at IS NULL`).bind(ids[0], input.restore_allocation_key, batch.id, actor.familyId)); return effects; } };
  }
  if (!batch.prep_session.prepared_at) return failure(409, "PREP_NOT_READY", "Mark the session prepared before recording eaten portions.");
  let available = counts.unplanned;
  if (input.meal_id) { const meal = batch.meals.find((row) => row.id === input.meal_id); if (!meal) return failure(404, "MEAL_UNAVAILABLE"); available = (meal.servings ?? 0) - batch.consumption.filter((row) => row.meal_id === meal.id).reduce((n, row) => n + row.servings, 0); }
  if (input.servings > available || input.servings > counts.remaining) return failure(409, "NOT_ENOUGH_PORTIONS", "Not enough unplanned portions remain. Choose a planned meal or reload.");
  const id = randomUUID(), at = now.getTime(), allocation = input.meal_id ? batch.meals.find((row) => row.id === input.meal_id)?.batch_allocation_key ?? null : null;
  return { status: 201, body: { consumptionId: id }, effects: (sql) => [sql.prepare(`INSERT INTO "MealBatchConsumption"(id,family_id,batch_id,allocation_key,meal_id,servings,created_by,consumed_at,source_request_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(id, actor.familyId, batch.id, allocation, input.meal_id ?? null, input.servings, actor.userId, at, receiptId)] };
}

export async function mutateD1MealPrep(actor: D1MealPrepActor, input: CreateMealPrepInput | MealPrepAction, key: string, database?: D1Store): Promise<NativePersonResult> {
  const action = "dishes" in input ? "meal-prep.create" : `meal-prep.${input.action}`;
  return executeD1PersonEffect({ actor: actorForEffect(actor), action, input, key, database, authorize: (db) => authorizeD1MealPrep(db, actor), plan: (db, receiptId) => "dishes" in input ? createPlan(db, actor, input, receiptId, new Date()) : actionPlan(db, actor, input, receiptId, new Date()) });
}

export async function readD1MealPrep(actor: D1MealPrepActor, options: { cursor?: string | null; sessionId?: string | null }, database?: D1Store) {
  return withD1ReadClient(async (db) => {
    const denied = await authorizeD1MealPrep(db, actor); if (denied) return denied;
    if (options.cursor && !(await db.mealPrepSession.findFirst({ where: { id: options.cursor, family_id: actor.familyId }, select: { id: true } }))) return failure(404, "SESSION_UNAVAILABLE");
    const rows = await db.mealPrepSession.findMany({ where: { family_id: actor.familyId, ...(options.sessionId ? { id: options.sessionId } : {}) }, orderBy: [{ created_at: "desc" }, { id: "desc" }], take: options.sessionId ? 1 : 21, ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}), select: { id: true, prepared_on: true, next_prep_on: true, prepared_at: true, batches: { where: { family_id: actor.familyId }, take: 8, orderBy: { position: "asc" }, select: { id: true, name: true, total_servings: true, reserve_storage: true, recipe_id: true, recipe_snapshot_at: true, cook_id: true, meals: { where: { family_id: actor.familyId }, take: 51, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, batch_allocation_key: true, date: true, meal_type: true, servings: true } }, consumption: { where: { family_id: actor.familyId, cancelled_at: null }, take: 51, orderBy: [{ consumed_at: "desc" }, { id: "desc" }], select: { id: true, meal_id: true, servings: true, consumed_at: true } } } } } });
    if (options.sessionId && rows.length === 0) return failure(404, "SESSION_UNAVAILABLE");
    const sessions = rows.slice(0, 20).map((session) => ({ ...session, batches: session.batches.map((batch) => ({ ...batch, portions_complete: batch.meals.length <= 50 && batch.consumption.length <= 50, meals: batch.meals.slice(0, 50), consumption: batch.consumption.slice(0, 50) })) }));
    return { status: 200, body: { context: { familyId: actor.familyId, userId: actor.userId }, sessions, nextCursor: rows.length > 20 ? sessions[sessions.length - 1].id : null } };
  }, database as any);
}

export async function readD1BatchRecipeHistory(actor: D1MealPrepActor, id: string, database?: D1Store) {
  return withD1ReadClient(async (db) => {
    const denied = await authorizeD1MealPrep(db, actor); if (denied) return denied;
    const batch = await db.mealBatch.findFirst({ where: { id, family_id: actor.familyId }, select: { id: true, recipe_snapshot: true, recipe_snapshot_at: true, prep_session: { select: { family_id: true, prepared_at: true } } } });
    if (!batch || batch.prep_session.family_id !== actor.familyId) return failure(404, "BATCH_UNAVAILABLE");
    if (!batch.prep_session.prepared_at) return { status: 200, body: { batchId: id, state: "not-prepared" } };
    if (batch.recipe_snapshot === null && !batch.recipe_snapshot_at) return { status: 200, body: { batchId: id, state: "not-recorded" } };
    const snapshot = mealRecipeSnapshot.safeParse(batch.recipe_snapshot); if (!snapshot.success || !batch.recipe_snapshot_at || new TextEncoder().encode(JSON.stringify(snapshot.data)).byteLength > RECIPE_SNAPSHOT_MAX_BYTES) return failure(409, "RECIPE_HISTORY_UPDATE_REQUIRED");
    return { status: 200, body: { batchId: id, state: "recorded", capturedAt: batch.recipe_snapshot_at.toISOString(), snapshot: snapshot.data } };
  }, database as any);
}
