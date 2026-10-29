/** Native D1 ordinary meal reads and mutations.
 *
 * Bulk/prep meals deliberately stop at the ordinary boundary. Their lifecycle
 * belongs to /api/meals/bulk and remains a separate migration slice.
 */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import { MEAL_INCLUDE } from "@/lib/meal-recipe-link";
import { MEAL_TYPES, type MealType } from "@/lib/meal-slots";
import type { MealCreateInput } from "@/lib/meal-create-contract";
import { parseDateOnly } from "@/lib/dates";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import { mealCreateReceipt } from "@/lib/meal-create-contract";
import { IDEMPOTENCY_TTL_MS } from "@/lib/idempotency-key";
import {
  executeD1PersonEffect,
  type NativePersonPlan,
  type NativePersonResult,
} from "./person-effect";
import type { D1ReadClient } from "./read-client";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { d1WriteCheck } from "./write-check";

export type D1MealActor = {
  userId: string;
  familyId: string;
  generation: number;
  role?: string;
};

export type D1MealScope = {
  start: Date;
  end: Date;
  limit?: number;
  cursor?: { date: Date; createdAt: Date; id: string } | null;
};

const mealAction = "meal.create";
const mealCreateAction = "meal.create.v1";
const batchMessage = "Batch meals must be changed through meal prep.";
const failure = (status: number, error: string, code?: string): EffectResult => ({
  status,
  body: { error: code ? { code, message: error } : error },
});
// Receipt refusals are a stable protocol: match the Prisma endpoint's
// `{ error: { code } }` shape rather than exposing legacy meal messages.
const receiptFailure = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

export async function authorizeD1Meals(db: D1ReadClient, actor: D1MealActor, canonical = false): Promise<EffectResult | null> {
  const [user, family] = await Promise.all([
    db.user.findUnique({
      where: { id: actor.userId },
      select: { family_id: true, role: true, token_version: true },
    }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ]);
  if (!user || user.family_id !== actor.familyId || user.token_version !== actor.generation)
    return canonical ? receiptFailure(401, "UNAUTHORIZED") : failure(401, "Unauthorized");
  if (!family || !isFeatureEnabled(normalizeFeatures(family.features), "meals"))
    return canonical ? receiptFailure(403, "MEALS_DISABLED") : failure(403, "This feature is turned off for your family");
  if (!['parent', 'teen', 'child'].includes(user.role))
    return canonical ? receiptFailure(403, "PLANNER_FORBIDDEN") : failure(403, "This account cannot access meals in this household");
  return null;
}

function afterCursor(cursor: NonNullable<D1MealScope["cursor"]>) {
  return {
    OR: [
      { date: { gt: cursor.date } },
      { date: cursor.date, created_at: { gt: cursor.createdAt } },
      { date: cursor.date, created_at: cursor.createdAt, id: { gt: cursor.id } },
    ],
  };
}

function mealDto(row: any) {
  return row;
}

/** Range reader used by the legacy unpaged endpoint and the week keyset reader. */
export async function readD1Meals(
  actor: D1MealActor,
  scope: D1MealScope,
  database?: D1Store,
) {
  const { withD1ReadClient } = await import("./read-client");
  return withD1ReadClient(async (db) => {
    const denied = await authorizeD1Meals(db, actor);
    if (denied) throw new D1MealReadRefusal(denied);
    const rows = await db.familyMeal.findMany({
      where: {
        family_id: actor.familyId,
        date: { gte: scope.start, lt: scope.end },
        ...(scope.cursor ? afterCursor(scope.cursor) : {}),
      },
      include: MEAL_INCLUDE,
      orderBy: [{ date: "asc" }, { created_at: "asc" }, { id: "asc" }],
      ...(scope.limit ? { take: scope.limit + 1 } : {}),
    });
    return rows.map(mealDto);
  }, database as any);
}

export class D1MealReadRefusal extends Error {
  constructor(readonly result: EffectResult) { super("D1 meal read refused"); }
}

export async function readD1MealState(
  actor: D1MealActor,
  id: string,
  expected?: { userId: string; familyId: string; generation: number },
  database?: D1Store,
  canonical = false,
) {
  const store = database ?? await getD1Database();
  const db = store.withSession("first-primary");
  const user = await db.prepare('SELECT family_id,role,token_version FROM "User" WHERE id=?1').bind(actor.userId).first<{ family_id: string | null; role: string; token_version: number }>();
  const family = await db.prepare('SELECT id,features FROM "Family" WHERE id=?1').bind(actor.familyId).first<{ id: string; features: string | null }>();
  if (!user || user.family_id !== actor.familyId || user.token_version !== actor.generation)
    return { response: canonical ? receiptFailure(401, "UNAUTHORIZED") : failure(401, "Unauthorized") };
  if (!['parent', 'teen', 'child'].includes(user.role))
    return { response: canonical ? receiptFailure(403, "PLANNER_FORBIDDEN") : failure(403, "This account cannot access meals in this household") };
  if (!family || !isFeatureEnabled(normalizeFeatures(parseJson(family.features)), "meals"))
    return { response: canonical ? receiptFailure(403, "MEALS_DISABLED") : failure(403, "This feature is turned off for your family") };
  if (expected && (expected.userId !== actor.userId || expected.familyId !== actor.familyId || expected.generation !== actor.generation))
    return { response: { status: 409, body: { error: { code: "MEAL_OWNER_CHANGED" } } } };
  const meal = await db.prepare('SELECT id,family_id FROM "FamilyMeal" WHERE id=?1').bind(id).first<{ id: string; family_id: string }>();
  // Confirmation is scoped to the actor's household. The Prisma confirmation
  // filters by family and reports a missing pointer, so do the same for the
  // receipt protocol rather than leaking a cross-household meal.
  if (meal && meal.family_id !== actor.familyId)
    return { response: canonical ? receiptFailure(409, "MEAL_NO_LONGER_AVAILABLE") : failure(403, "Forbidden") };
  return { state: meal ? "present" as const : "missing" as const, mealId: meal?.id ?? id };
}

async function resolveLink(db: D1ReadClient, familyId: string, input: { recipe_id?: unknown; servings?: unknown }) {
  const { recipe_id, servings } = input;
  if (servings !== undefined && servings !== null &&
    (typeof servings !== "number" || !Number.isInteger(servings) || servings < 1 || servings > 100))
    return { ok: false as const, error: "servings must be a whole number from 1 to 100" };
  if (recipe_id === undefined || recipe_id === null)
    return { ok: true as const, recipeId: recipe_id as string | null | undefined, recipeTitle: null as string | null, servings: servings as number | null | undefined };
  if (typeof recipe_id !== "string" || !recipe_id || recipe_id.length > 128)
    return { ok: false as const, error: "recipe_id must be a recipe id" };
  const recipe = await db.recipe.findFirst({ where: { id: recipe_id, family_id: familyId }, select: { id: true, title: true } });
  if (!recipe) return { ok: false as const, error: "Recipe not found" };
  return { ok: true as const, recipeId: recipe.id, recipeTitle: recipe.title, servings: servings as number | null | undefined };
}

function actorForPerson(actor: D1MealActor) {
  return { userId: actor.userId, familyId: actor.familyId, role: actor.role ?? "", generation: actor.generation };
}

async function planCreate(
  db: D1ReadClient,
  actor: D1MealActor,
  input: Record<string, any>,
  receiptId: string | null,
  response: "meal" | "receipt",
  now: Date,
): Promise<NativePersonPlan> {
  const planFailure = (status: number, code: string, message?: string) => response === "receipt" ? receiptFailure(status, code) : failure(status, message ?? code);
  if (response === "receipt") {
    const issued = new Date(input.issued_at).getTime();
    const age = Date.now() - issued;
    if (!Number.isFinite(issued) || age < -60_000 || age > IDEMPOTENCY_TTL_MS - 60 * 60 * 1000)
      return planFailure(409, "MEAL_INTENT_EXPIRED");
  }
  const mealDate = parseDateOnly(input.date);
  if (!mealDate) return planFailure(400, "INVALID_DRAFT", "date must be YYYY-MM-DD");
  if (!(MEAL_TYPES as readonly string[]).includes(input.meal_type)) return planFailure(400, "INVALID_DRAFT", "Invalid meal type");
  if (input.cook_id && !(await db.user.findFirst({ where: { id: input.cook_id, family_id: actor.familyId }, select: { id: true } })))
    return planFailure(400, "COOK_UNAVAILABLE", "Cook must be a member of your family");
  const link = await resolveLink(db, actor.familyId, input);
  if (!link.ok) return planFailure(400, response === "receipt" ? "RECIPE_UNAVAILABLE" : link.error, link.error);
  const [cook, creator, recipe] = await Promise.all([
    input.cook_id
      ? db.user.findFirst({ where: { id: input.cook_id, family_id: actor.familyId }, select: { id: true, name: true } })
      : Promise.resolve(null),
    db.user.findFirst({ where: { id: actor.userId, family_id: actor.familyId }, select: { id: true, name: true } }),
    link.recipeId
      ? db.recipe.findFirst({ where: { id: link.recipeId, family_id: actor.familyId }, select: MEAL_INCLUDE.recipe.select })
      : Promise.resolve(null),
  ]);
  const id = randomUUID();
  const meal = {
    id, family_id: actor.familyId, date: mealDate, meal_type: input.meal_type,
    recipe_name: input.recipe_name ?? link.recipeTitle ?? "", notes: input.notes ?? null,
    cook_id: input.cook_id ?? null, created_by: actor.userId, created_at: now,
    recipe_id: link.recipeId ?? null, batch_id: null, batch_allocation_key: null,
    servings: link.servings ?? null, updated_at: now,
    cook, creator, recipe,
  };
  const body = response === "receipt" ? { mealId: id } : { meal };
  return {
    status: 201,
    body,
    effects: (session) => [
      session.prepare(`INSERT INTO "FamilyMeal" (id,family_id,date,meal_type,recipe_name,notes,cook_id,created_by,created_at,recipe_id,batch_id,batch_allocation_key,servings,updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL,NULL,?11,?9)`).bind(
        id, actor.familyId, mealDate.getTime(), meal.meal_type, meal.recipe_name, meal.notes,
        meal.cook_id, actor.userId, now.getTime(), meal.recipe_id, meal.servings,
      ),
    ],
  };
}

export async function createD1Meal(actor: D1MealActor, input: Record<string, any>, key: string | null, database?: D1Store) {
  const result = await executeD1PersonEffect({
    actor: actorForPerson(actor), action: mealAction, input, key, database,
    authorize: (db) => authorizeD1Meals(db, actor),
    plan: (db, receiptId) => planCreate(db, actor, input, receiptId, "meal", new Date()),
  });
  return result;
}

export async function createD1MealWithReceipt(actor: D1MealActor, input: MealCreateInput, key: string, database?: D1Store) {
  const result = await executeD1PersonEffect({
    actor: actorForPerson(actor), action: mealCreateAction, input, key, database,
    authorize: (db) => authorizeD1Meals(db, actor, true),
    plan: (db, receiptId) => planCreate(db, actor, input, receiptId, "receipt", new Date()),
  });
  return result;
}

export async function confirmD1CreatedMeal(actor: D1MealActor, result: NativePersonResult, database?: D1Store): Promise<NativePersonResult> {
  if (result.status !== 201) return result;
  const parsed = mealCreateReceipt.safeParse(result.body);
  if (!parsed.success) return { ...result, status: 409, body: { error: { code: "MEAL_CONFIRMATION_UNAVAILABLE" } } };
  const state = await readD1MealState(actor, parsed.data.mealId, undefined, database, true);
  if (state.response) return { ...result, status: state.response.status, body: state.response.body };
  return state.state === "present" ? result : { ...result, status: 409, body: { error: { code: "MEAL_NO_LONGER_AVAILABLE" } } };
}

export type D1MealUpdate = {
  id: string; recipe_name?: string | null; notes?: string | null; cook_id?: string | null;
  date?: string; meal_type?: MealType; recipe_id?: string | null; servings?: number | null;
};

export async function updateD1Meal(actor: D1MealActor, input: D1MealUpdate, key: string | null, database?: D1Store) {
  const now = new Date();
  return executeD1PersonEffect({
    actor: actorForPerson(actor), action: "meal.update", input, key, database,
    authorize: (db) => authorizeD1Meals(db, actor),
    plan: async (db) => {
      const meal = await db.familyMeal.findUnique({ where: { id: input.id }, include: MEAL_INCLUDE });
      if (!meal) return failure(404, "Meal not found");
      if (meal.family_id !== actor.familyId) return failure(403, "Forbidden");
      if (meal.batch_id) return failure(409, batchMessage, "MEAL_BATCH_OWNED");
      if (input.date !== undefined && !parseDateOnly(input.date)) return failure(400, "date must be YYYY-MM-DD");
      if (input.cook_id && !(await db.user.findFirst({ where: { id: input.cook_id, family_id: actor.familyId }, select: { id: true } }))) return failure(400, "Cook must be a member of your family");
      const link = await resolveLink(db, actor.familyId, input);
      if (!link.ok) return failure(400, link.error);
      const next = {
        ...meal,
        ...(input.recipe_name !== undefined ? { recipe_name: input.recipe_name } : link.recipeTitle !== null ? { recipe_name: link.recipeTitle } : {}),
        ...(link.recipeId !== undefined ? { recipe_id: link.recipeId } : {}),
        ...(link.servings !== undefined ? { servings: link.servings } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.cook_id !== undefined ? { cook_id: input.cook_id } : {}),
        ...(input.date !== undefined ? { date: parseDateOnly(input.date)! } : {}),
        ...(input.meal_type !== undefined ? { meal_type: input.meal_type } : {}),
        updated_at: now,
      };
      const flags = [input.recipe_name !== undefined || link.recipeTitle !== null, input.recipe_id !== undefined, input.servings !== undefined, input.notes !== undefined, input.cook_id !== undefined, input.date !== undefined, input.meal_type !== undefined];
      return {
        status: 200,
        body: { meal: next },
        effects: (session: Pick<D1Store, "prepare">): D1Statement[] => {
          const check = d1WriteCheck(session, `EXISTS(SELECT 1 FROM "FamilyMeal" WHERE id=?1 AND family_id=?2 AND batch_id IS NULL AND updated_at=?3)`, [input.id, actor.familyId, meal.updated_at.getTime()]);
          const statement = session.prepare(`UPDATE "FamilyMeal" SET
            recipe_name=CASE WHEN ?4=1 THEN ?5 ELSE recipe_name END,
            recipe_id=CASE WHEN ?6=1 THEN ?7 ELSE recipe_id END,
            servings=CASE WHEN ?8=1 THEN ?9 ELSE servings END,
            notes=CASE WHEN ?10=1 THEN ?11 ELSE notes END,
            cook_id=CASE WHEN ?12=1 THEN ?13 ELSE cook_id END,
            date=CASE WHEN ?14=1 THEN ?15 ELSE date END,
            meal_type=CASE WHEN ?16=1 THEN ?17 ELSE meal_type END,
            updated_at=?18 WHERE id=?1 AND family_id=?2 AND batch_id IS NULL`).bind(
            input.id, actor.familyId, meal.updated_at.getTime(), flags[0] ? 1 : 0, next.recipe_name ?? null,
            flags[1] ? 1 : 0, next.recipe_id ?? null, flags[2] ? 1 : 0, next.servings ?? null,
            flags[3] ? 1 : 0, next.notes ?? null, flags[4] ? 1 : 0, next.cook_id ?? null,
            flags[5] ? 1 : 0, next.date.getTime(), flags[6] ? 1 : 0, next.meal_type, now.getTime(),
          );
          return [check, statement, d1WriteCheck(session, "changes()=1")];
        },
      };
    },
  });
}

export async function deleteD1Meal(actor: D1MealActor, id: string, key: string | null, expected?: { userId: string; familyId: string; generation: number }, database?: D1Store) {
  return executeD1PersonEffect({
    actor: actorForPerson(actor), action: "meal.delete", input: { id, expected }, key, database,
    authorize: async (db) => {
      const denied = await authorizeD1Meals(db, actor);
      if (denied) return denied;
      if (expected && (expected.userId !== actor.userId || expected.familyId !== actor.familyId || expected.generation !== actor.generation)) return { status: 409, body: { error: { code: "MEAL_OWNER_CHANGED" } } };
      return null;
    },
    plan: async (db) => {
      const meal = await db.familyMeal.findUnique({ where: { id }, select: { id: true, family_id: true, batch_id: true, updated_at: true } });
      if (!meal) return failure(404, "Meal not found");
      if (meal.family_id !== actor.familyId) return failure(403, "Forbidden");
      if (meal.batch_id) return failure(409, batchMessage, "MEAL_BATCH_OWNED");
      return {
        status: 200,
        body: { success: true },
        effects: (session: Pick<D1Store, "prepare">) => [
          d1WriteCheck(session, `EXISTS(SELECT 1 FROM "FamilyMeal" WHERE id=?1 AND family_id=?2 AND batch_id IS NULL AND updated_at=?3)`, [id, actor.familyId, meal.updated_at.getTime()]),
          session.prepare('DELETE FROM "FamilyMeal" WHERE id=?1 AND family_id=?2 AND batch_id IS NULL').bind(id, actor.familyId),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}
