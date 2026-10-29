/** Native D1 food-planning read orchestration.
 *
 * This is the D1 counterpart to food-planning/server.ts.  It intentionally
 * returns the same provider-free preview contract and performs every source
 * read on one first-primary session.  It does not write meals, inventory or
 * lists; review/apply remains a separate keyed effect.
 */
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { getJwtSecret } from "../auth";
import { addDaysToKey, dayKeyFor } from "../local-day-key";
import { parseDateOnly, toDateOnlyUTC } from "../dates";
import { canonicalRequestJson } from "../idempotency-request-json";
import { hashIdempotentRequest } from "../idempotency-hash";
import { IDEMPOTENCY_TTL_MS } from "../idempotency-key";
import { isFeatureEnabled, normalizeFeatures } from "../features";
import {
  resolveCaptureConfig,
  structuredFoodPlanReply,
  type CaptureConfig,
} from "../capture";
import type { AiUsageJob } from "../ai-usage-server";
import { foodAiEnabled } from "../food-planning/ai-gates";
import {
  FOOD_AI,
  foodAiRequest,
  foodAiSuggestion,
} from "../food-planning/ai-contract";
import {
  buildFoodAiCatalog,
  foodAiLeaseCurrent,
  FoodAiRefused,
  resolveFoodAiChoices,
} from "../food-planning/ai-catalog";
import { evaluateFoodAiProposal } from "../food-planning/ai-evaluation";
import { issueFoodAiFeedback } from "../food-planning/ai-feedback";
import { foodPreviewView } from "../food-planning/view-contract";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
import {
  foodPreviewRequest,
  type FoodRecipe,
  type FoodStock,
  type FoodCommitment,
  type FoodPlanningInputs,
  type PreparedFoodPortions,
  type FoodCalendarSnapshot,
} from "../food-planning/contract";
import type { FoodPlanActor } from "../food-planning/server";
import { buildFoodPlan } from "../food-planning/planner";
import { foodWriteChoicesMatch } from "../food-planning/choices";
import {
  FOOD_APPLY_ACTION,
  reviewedFoodWrite,
  type ReviewedFoodWrite,
} from "../food-planning/apply-contract";
import {
  assertFoodReviewLease,
  FoodReviewRefused,
  foodReviewDigest,
  issueFoodReviewSeal,
  readFoodReviewSeal,
} from "../food-planning/review-proof";
import { FOOD_BODY_MAX_BYTES } from "../food-planning/recovery-contract";
import {
  ADD_FROM_RECIPE_ACTION,
  addFromRecipeSchema,
  recipeGroceryAmount,
  UNDO_WINDOW_MS,
} from "../grocery-from-recipe-contract";
import { batchPortionCounts } from "../meal-batches";
import { normalizeName } from "../backfill/meals-groceries";
import { POSSIBLE_DUPLICATES_LIMIT } from "../grocery-from-recipe-contract";
import { foodApplyReceipt } from "../food-planning/apply-contract";
import {
  executeD1PersonEffect,
  type NativePersonResult,
} from "./person-effect";
import type { D1ReadClient } from "./read-client";
import { d1WriteCheck } from "./write-check";
import { scheduleEventToken } from "../calendar-planning/schedule-source";
import type { D1Statement, D1Store } from "./database";
import {
  readD1FoodSourceVersions,
  d1FoodSourceStorageAvailable,
} from "./food-source-versions";

export class D1FoodPlanningUnavailable extends Error {
  constructor(
    readonly code:
      | "UNAVAILABLE"
      | "FORBIDDEN"
      | "CONTEXT_CHANGED"
      | "INVALID_DATES"
      | "RECIPES_FILTER_REQUIRED"
      | "SOURCE_LIMIT" = "UNAVAILABLE",
  ) {
    super(code);
  }
}

const maxDate = (value: string) => parseDateOnly(value)?.getTime() ?? NaN;
const placeholders = (count: number, start = 2) =>
  Array.from({ length: count }, (_, i) => `?${i + start}`).join(",");
const parseJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

type RecipeRow = {
  id: string;
  title: string;
  servings: number;
  prep_time: number | null;
  cook_time: number | null;
};
type IngredientRow = {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  amount: number;
  unit: string | null;
  ingredient_name: string | null;
  ingredient_unit: string | null;
  ingredient_family_id: string | null;
};
type InventoryRow = {
  id: string;
  ingredient_id: string | null;
  name: string;
  amount: number | null;
  unit: string | null;
  expires_on: number | null;
  date_kind: string;
  status: string;
  ingredient_family_id: string | null;
};
type MealRow = {
  id: string;
  date: number;
  meal_type: string;
  recipe_name: string | null;
  recipe_id: string | null;
  batch_id: string | null;
  servings: number | null;
};
type D1PrepSessionRow = {
  id: string;
  prepared_on: number;
  prepared_at: number | null;
  next_prep_on: number | null;
  created_at: number;
};
type D1BatchRow = {
  id: string;
  prep_session_id: string;
  name: string;
  total_servings: number;
  reserve_storage: string;
  recipe_id: string | null;
  recipe_snapshot_at: number | null;
  created_at: number;
};
type D1BatchMealRow = {
  id: string;
  batch_id: string;
  date: number;
  servings: number | null;
  recipe_id: string | null;
  created_at: number;
  updated_at: number;
};
type D1BatchConsumptionRow = {
  id: string;
  batch_id: string;
  meal_id: string | null;
  servings: number;
  consumed_at: number;
  allocation_key: string | null;
};

const sourceText = z.string().trim().min(1).max(500);
const sourceRecipe = z.object({
  id,
  title: sourceText,
  servings: z.number().int().min(1).max(100),
  prep_time: z.number().int().min(0).max(10080).nullable(),
  cook_time: z.number().int().min(0).max(10080).nullable(),
  ingredients: z
    .array(
      z.object({
        amount: z.number().finite().min(0).max(100000),
        unit: z.string().max(100).nullable(),
        ingredient: z.object({
          id,
          name: sourceText,
          unit: z.string().max(100).nullable(),
        }),
      }),
    )
    .max(100),
});
const sourceStock = z.object({
  id,
  ingredient_id: id.nullable(),
  name: sourceText,
  amount: z.number().finite().min(0).max(100000).nullable(),
  unit: z.string().max(100).nullable(),
  expires_on: z.string().nullable(),
  date_kind: z.enum(["best_before", "use_by"]),
  status: z.literal("active"),
});

function assertCurrent(now: Date, observed: Date) {
  if (
    !Number.isFinite(now.getTime()) ||
    now.getTime() >= observed.getTime() + 60000 ||
    now.getTime() < observed.getTime() - 1000
  )
    throw new D1FoodPlanningUnavailable();
}

async function rows<T>(
  db: D1Store,
  sql: string,
  args: Array<string | number | null>,
) {
  return (
    await db
      .withSession("first-primary")
      .prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;
}

async function readRecipes(
  db: D1Store,
  familyId: string,
  recipeIds?: readonly string[],
) {
  const where = recipeIds?.length
    ? ` AND r.id IN (${placeholders(recipeIds.length)})`
    : "";
  const base = await rows<RecipeRow>(
    db,
    `SELECT r.id,r.title,r.servings,r.prep_time,r.cook_time FROM "Recipe" r
      WHERE r.family_id=?1${where} ORDER BY r.id LIMIT 101`,
    [familyId, ...(recipeIds ?? [])],
  );
  if (base.length > 100)
    throw new D1FoodPlanningUnavailable("RECIPES_FILTER_REQUIRED");
  if (recipeIds && base.length !== recipeIds.length)
    throw new D1FoodPlanningUnavailable();
  if (!base.length) return [] as FoodRecipe[];
  const lines = await rows<IngredientRow>(
    db,
    `SELECT ri.id,ri.recipe_id,ri.ingredient_id,ri.amount,ri.unit,
            i.name AS ingredient_name,i.unit AS ingredient_unit,i.family_id AS ingredient_family_id
       FROM "RecipeIngredient" ri
       JOIN "Recipe" r ON r.id=ri.recipe_id AND r.family_id=?1
       LEFT JOIN "Ingredient" i ON i.id=ri.ingredient_id
      WHERE ri.recipe_id IN (${placeholders(base.length)}) ORDER BY ri.id LIMIT 5001`,
    [familyId, ...base.map((row) => row.id)],
  );
  if (lines.length > 5000) throw new D1FoodPlanningUnavailable("SOURCE_LIMIT");
  if (
    lines.some(
      (line) =>
        line.ingredient_family_id !== familyId ||
        line.ingredient_name === null,
    )
  )
    throw new D1FoodPlanningUnavailable();
  const byRecipe = new Map<string, IngredientRow[]>();
  for (const line of lines)
    byRecipe.set(line.recipe_id, [
      ...(byRecipe.get(line.recipe_id) ?? []),
      line,
    ]);
  try {
    return base.map((row) =>
      sourceRecipe.parse({
        ...row,
        ingredients: (byRecipe.get(row.id) ?? []).map((line) => ({
          amount: line.amount,
          unit: line.unit,
          ingredient: {
            id: line.ingredient_id,
            name: line.ingredient_name,
            unit: line.ingredient_unit,
          },
        })),
      }),
    ) as FoodRecipe[];
  } catch {
    throw new D1FoodPlanningUnavailable();
  }
}

async function readInventory(db: D1Store, familyId: string, today: string) {
  const rows0 = await rows<InventoryRow>(
    db,
    `SELECT ii.id,ii.ingredient_id,ii.name,ii.amount,ii.unit,ii.expires_on,ii.date_kind,ii.status,
            i.family_id AS ingredient_family_id
       FROM "InventoryItem" ii
       LEFT JOIN "Ingredient" i ON i.id=ii.ingredient_id
      WHERE ii.family_id=?1 AND ii.status='active'
        AND (ii.expires_on IS NULL OR ii.expires_on>=?2)
      ORDER BY ii.id LIMIT 501`,
    [familyId, maxDate(today)],
  );
  if (rows0.length > 500) throw new D1FoodPlanningUnavailable("SOURCE_LIMIT");
  if (
    rows0.some(
      (row) =>
        row.ingredient_id !== null && row.ingredient_family_id !== familyId,
    )
  )
    throw new D1FoodPlanningUnavailable();
  try {
    return rows0.map((row) =>
      sourceStock.parse({
        ...row,
        expires_on:
          row.expires_on === null
            ? null
            : toDateOnlyUTC(new Date(row.expires_on)),
      }),
    ) as FoodStock[];
  } catch {
    throw new D1FoodPlanningUnavailable();
  }
}

async function readMeals(
  db: D1Store,
  familyId: string,
  from: string,
  through: string,
) {
  return rows<MealRow>(
    db,
    `SELECT id,date,meal_type,recipe_name,recipe_id,batch_id,servings
       FROM "FamilyMeal" WHERE family_id=?1 AND date>=?2 AND date<?3
      ORDER BY id LIMIT 501`,
    [familyId, maxDate(from), maxDate(addDaysToKey(through, 1))],
  );
}

async function readD1FoodCommitments(
  db: D1Store,
  familyId: string,
  horizon: { from: string; through: string },
  meals: MealRow[],
) {
  const end = maxDate(addDaysToKey(horizon.through, 1));
  const selected = await rows<D1PrepSessionRow>(
    db,
    `SELECT s.id,s.prepared_on,s.prepared_at,s.next_prep_on,s.created_at
       FROM "MealPrepSession" s
      WHERE s.family_id=?1 AND (
        (s.prepared_at IS NULL AND s.prepared_on<?2) OR
        (s.prepared_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM "MealBatch" b
           WHERE b.family_id=?1 AND b.prep_session_id=s.id
             AND b.total_servings > COALESCE((SELECT SUM(c.servings)
               FROM "MealBatchConsumption" c
              WHERE c.family_id=?1 AND c.batch_id=b.id AND c.cancelled_at IS NULL),0)
        ))
      ) ORDER BY s.id LIMIT 51`,
    [familyId, end],
  );
  if (selected.length > 50) throw new D1FoodPlanningUnavailable("SOURCE_LIMIT");
  const linkedBatchIds = [
    ...new Set(meals.flatMap((meal) => (meal.batch_id ? [meal.batch_id] : []))),
  ];
  const linked = linkedBatchIds.length
    ? await rows<{ id: string; prep_session_id: string }>(
        db,
        `SELECT id,prep_session_id FROM "MealBatch"
          WHERE family_id=?1 AND id IN (${placeholders(linkedBatchIds.length)})`,
        [familyId, ...linkedBatchIds],
      )
    : [];
  if (linked.length !== linkedBatchIds.length)
    throw new D1FoodPlanningUnavailable();
  const sessionIds = [
    ...new Set([
      ...selected.map((row) => row.id),
      ...linked.map((row) => row.prep_session_id),
    ]),
  ].sort();
  if (sessionIds.length > 50)
    throw new D1FoodPlanningUnavailable("SOURCE_LIMIT");
  const sessions = sessionIds.length
    ? await rows<D1PrepSessionRow>(
        db,
        `SELECT id,prepared_on,prepared_at,next_prep_on,created_at
           FROM "MealPrepSession" WHERE family_id=?1
             AND id IN (${placeholders(sessionIds.length)}) ORDER BY id`,
        [familyId, ...sessionIds],
      )
    : [];
  if (sessions.length !== sessionIds.length)
    throw new D1FoodPlanningUnavailable();
  const batches = sessionIds.length
    ? await rows<D1BatchRow>(
        db,
        `SELECT id,prep_session_id,name,total_servings,reserve_storage,recipe_id,recipe_snapshot_at,created_at
           FROM "MealBatch" WHERE family_id=?1
             AND prep_session_id IN (${placeholders(sessionIds.length)})
          ORDER BY id LIMIT 201`,
        [familyId, ...sessionIds],
      )
    : [];
  if (batches.length > 200) throw new D1FoodPlanningUnavailable("SOURCE_LIMIT");
  const batchIds = batches.map((row) => row.id);
  const allocations = batchIds.length
    ? await rows<D1BatchMealRow>(
        db,
        `SELECT id,batch_id,date,servings,recipe_id,created_at,updated_at
           FROM "FamilyMeal" WHERE family_id=?1
             AND batch_id IN (${placeholders(batchIds.length)}) ORDER BY id LIMIT 1001`,
        [familyId, ...batchIds],
      )
    : [];
  const consumption = batchIds.length
    ? await rows<D1BatchConsumptionRow>(
        db,
        `SELECT id,batch_id,meal_id,servings,consumed_at,allocation_key
           FROM "MealBatchConsumption" WHERE family_id=?1
             AND cancelled_at IS NULL AND batch_id IN (${placeholders(batchIds.length)})
          ORDER BY id LIMIT 1001`,
        [familyId, ...batchIds],
      )
    : [];
  if (allocations.length > 1000 || consumption.length > 1000)
    throw new D1FoodPlanningUnavailable("SOURCE_LIMIT");
  const bySession = new Map(sessions.map((row) => [row.id, row]));
  const byBatch = new Map(batches.map((row) => [row.id, row]));
  const entries: FoodCommitment[] = [];
  const prepared: PreparedFoodPortions[] = [];
  const pendingRecipeIds = new Set<string>();
  const preparedRecipeIds = new Set<string>();
  for (const meal of meals) {
    if (meal.batch_id) {
      const batch = byBatch.get(meal.batch_id);
      const session = batch && bySession.get(batch.prep_session_id);
      if (
        !batch ||
        !session ||
        new Date(meal.date).getTime() < session.prepared_on ||
        meal.recipe_id !== batch.recipe_id
      )
        throw new D1FoodPlanningUnavailable();
      continue;
    }
    if (meal.recipe_name !== null && meal.recipe_name.length > 200)
      throw new D1FoodPlanningUnavailable();
    entries.push({
      id: `meal:${meal.id}`,
      kind: "meal",
      label: meal.recipe_name?.trim() || null,
      date: toDateOnlyUTC(new Date(meal.date)),
      originalDate: toDateOnlyUTC(new Date(meal.date)),
      recipeId: meal.recipe_id,
      servings: meal.servings,
    });
    if (meal.recipe_id) pendingRecipeIds.add(meal.recipe_id);
  }
  for (const batch of batches) {
    const session = bySession.get(batch.prep_session_id);
    const batchMeals = allocations.filter((row) => row.batch_id === batch.id);
    const eaten = consumption.filter((row) => row.batch_id === batch.id);
    if (
      !session ||
      !batch.name.trim() ||
      batch.name.length > 200 ||
      !Number.isInteger(batch.total_servings) ||
      batch.total_servings < 1 ||
      batch.total_servings > 50 ||
      batchMeals.some(
        (row) =>
          row.servings === null ||
          !Number.isInteger(row.servings) ||
          row.servings < 1 ||
          row.servings > 50 ||
          row.date < session.prepared_on ||
          row.recipe_id !== batch.recipe_id,
      ) ||
      eaten.some(
        (row) =>
          !Number.isInteger(row.servings) ||
          row.servings < 1 ||
          row.servings > 50 ||
          (row.meal_id !== null &&
            !batchMeals.some((meal) => meal.id === row.meal_id)),
      )
    )
      throw new D1FoodPlanningUnavailable();
    const counts = batchPortionCounts(batch.total_servings, batchMeals, eaten);
    if (
      Object.values(counts).some(
        (value) => !Number.isInteger(value) || value < 0,
      )
    )
      throw new D1FoodPlanningUnavailable();
    if (session.prepared_at !== null) {
      if (!["fridge", "freezer"].includes(batch.reserve_storage))
        throw new D1FoodPlanningUnavailable();
      if (batch.recipe_id) preparedRecipeIds.add(batch.recipe_id);
      prepared.push({
        batchId: batch.id,
        sessionId: session.id,
        name: batch.name,
        recipeId: batch.recipe_id,
        preparedOn: toDateOnlyUTC(new Date(session.prepared_on)),
        preparedAt: new Date(session.prepared_at).toISOString(),
        nextPrepOn: session.next_prep_on
          ? toDateOnlyUTC(new Date(session.next_prep_on))
          : null,
        storage: batch.reserve_storage as "fridge" | "freezer",
        total: batch.total_servings,
        ...counts,
        recipeHistoryRecorded: batch.recipe_snapshot_at !== null,
      });
    } else if (
      toDateOnlyUTC(new Date(session.prepared_on)) <= horizon.through
    ) {
      const originalDate = toDateOnlyUTC(new Date(session.prepared_on));
      entries.push({
        id: `batch:${batch.id}`,
        kind: "prep-dish",
        label: batch.name,
        date: originalDate < horizon.from ? horizon.from : originalDate,
        originalDate,
        recipeId: batch.recipe_id,
        servings: batch.total_servings,
        stateUncertain: eaten.length > 0,
      });
      if (batch.recipe_id) pendingRecipeIds.add(batch.recipe_id);
    }
  }
  return {
    entries,
    prepared,
    pendingRecipeIds: [...pendingRecipeIds].sort(),
    preparedRecipeIds: [...preparedRecipeIds].sort(),
    sources: { sessions, batches, allocations, consumption },
  };
}

type D1FoodCalendarEvent = {
  id: string;
  title?: string;
  start_time: number;
  end_time: number;
  recurrence: string | null;
  schedule_generation: string;
  schedule_epoch: number;
  source_subscription_id: string | null;
  source_connection_id: string | null;
};
type D1FoodCalendarStatus = {
  kind: "subscription" | "connection";
  id: string;
  status: string;
  checkedAt: number | null;
  updatedAt: number;
  generation: number | null;
};

async function readD1FoodCalendar(
  db: D1Store,
  familyId: string,
  request: import("../food-planning/contract").FoodPlanRequest,
  enabled: boolean,
  now: Date,
) {
  const windows = request.prepTiming
    ? [request.prepTiming]
    : request.slots.flatMap((slot) => (slot.timing ? [slot.timing] : []));
  if (!windows.length) return undefined;
  const snapshot: FoodCalendarSnapshot = {
    observedAt: now.toISOString(),
    complete: false,
    reasons: [],
    ignoredEventIds: request.ignoredCalendarEventIds,
    events: [],
    departures: [],
  };
  if (!enabled) {
    snapshot.reasons.push("calendar-disabled");
    return { snapshot, sources: null };
  }
  const start = Math.min(...windows.map((window) => Date.parse(window.start)));
  const end = Math.max(...windows.map((window) => Date.parse(window.end)));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new D1FoodPlanningUnavailable();
  const paddedStart = start - 240 * 60000;
  const paddedEnd = end + 480 * 60000;
  const session = db.withSession("first-primary");
  const events = await session
    .prepare(
      `SELECT id,title,start_time,end_time,recurrence,schedule_generation,schedule_epoch,source_subscription_id,source_connection_id
         FROM "Event" WHERE family_id=?1 AND (
           recurrence IS NOT NULL OR end_time<=start_time OR
           (start_time<?2 AND end_time>?3)
         ) ORDER BY id LIMIT 501`,
    )
    .bind(familyId, paddedEnd, paddedStart)
    .all<D1FoodCalendarEvent>();
  const subscriptions = await session
    .prepare(
      `SELECT id,last_status AS status,last_fetched_at AS checkedAt,updated_at AS updatedAt
         FROM "CalendarSubscription" WHERE family_id=?1 ORDER BY id LIMIT 101`,
    )
    .bind(familyId)
    .all<{
      id: string;
      status: string;
      checkedAt: number | null;
      updatedAt: number;
    }>();
  const connections = await session
    .prepare(
      `SELECT id,status,last_synced_at AS checkedAt,updated_at AS updatedAt,generation
         FROM "CalendarConnection" WHERE family_id=?1 ORDER BY id LIMIT 101`,
    )
    .bind(familyId)
    .all<{
      id: string;
      status: string;
      checkedAt: number | null;
      updatedAt: number;
      generation: number;
    }>();
  const statuses: D1FoodCalendarStatus[] = [
    ...subscriptions.results.map((row) => ({
      ...row,
      kind: "subscription" as const,
      generation: null,
    })),
    ...connections.results.map((row) => ({
      ...row,
      kind: "connection" as const,
    })),
  ].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  if (events.results.length > 500 || statuses.length > 100)
    snapshot.reasons.push("capped");
  const statusUnavailable = statuses.some(
    (row) =>
      row.status !== "ok" ||
      row.checkedAt === null ||
      now.getTime() - row.checkedAt > 24 * 60 * 60 * 1000 ||
      row.checkedAt - now.getTime() > 60000,
  );
  const statusKeys = new Set(statuses.map((row) => `${row.kind}:${row.id}`));
  if (
    statusUnavailable ||
    events.results.some(
      (row) =>
        (row.source_subscription_id !== null &&
          !statusKeys.has(`subscription:${row.source_subscription_id}`)) ||
        (row.source_connection_id !== null &&
          !statusKeys.has(`connection:${row.source_connection_id}`)),
    )
  )
    snapshot.reasons.push("source-unavailable");
  if (events.results.some((row) => row.recurrence !== null))
    snapshot.reasons.push("recurrence-unexpanded");
  if (
    events.results.some(
      (row) =>
        !Number.isFinite(row.start_time) ||
        !Number.isFinite(row.end_time) ||
        row.end_time <= row.start_time,
    )
  )
    snapshot.reasons.push("invalid-interval");
  const departureIds = [
    ...new Set(
      windows.flatMap((window) =>
        window.departureEventId ? [window.departureEventId] : [],
      ),
    ),
  ].sort();
  const departures = departureIds.length
    ? await session
        .prepare(
          `SELECT id,title,start_time,end_time,recurrence,schedule_generation,schedule_epoch,source_subscription_id,source_connection_id
             FROM "Event" WHERE family_id=?1 AND id IN (${placeholders(departureIds.length)}) ORDER BY id`,
        )
        .bind(familyId, ...departureIds)
        .all<D1FoodCalendarEvent>()
    : { results: [] as D1FoodCalendarEvent[] };
  const comparedIds = new Set(events.results.map((row) => row.id));
  for (const departure of departures.results) comparedIds.add(departure.id);
  if (departures.results.length !== departureIds.length)
    snapshot.reasons.push("departure-unavailable");
  if (request.ignoredCalendarEventIds.some((id) => !comparedIds.has(id)))
    snapshot.reasons.push("ignored-event-unavailable");
  const toToken = (row: D1FoodCalendarEvent) =>
    scheduleEventToken(familyId, {
      id: row.id,
      generation: row.schedule_generation,
      epoch: row.schedule_epoch,
    });
  snapshot.events = events.results
    .slice(0, 500)
    .filter((row) => row.end_time > row.start_time)
    .map((row) => ({
      id: row.id,
      start: new Date(row.start_time).toISOString(),
      end: new Date(row.end_time).toISOString(),
      repeating: row.recurrence !== null,
      sourceToken: toToken(row),
    }));
  snapshot.departures = departures.results.map((row) => ({
    id: row.id,
    title: Array.from(row.title ?? "")
      .slice(0, 240)
      .join(""),
    start: new Date(row.start_time).toISOString(),
    end: new Date(row.end_time).toISOString(),
    repeating: row.recurrence !== null,
    sourceToken: toToken(row),
  }));
  snapshot.complete = snapshot.reasons.length === 0;
  return {
    snapshot,
    sources: {
      rows: events.results,
      departures: departures.results,
      statuses,
      range: {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      },
    },
  };
}

export async function previewD1FoodPlan(
  db: D1Store,
  actor: FoodPlanActor,
  raw: unknown,
  now = new Date(),
) {
  const input = foodPreviewRequest.parse(raw);
  if (process.env.FAMILY_FOOD_PLANNING_READY !== "1")
    throw new D1FoodPlanningUnavailable();
  if (!["parent", "teen"].includes(actor.role))
    throw new D1FoodPlanningUnavailable("FORBIDDEN");
  const today = dayKeyFor({ kind: "tz", timeZone: input.plan.timeZone })(now);
  const dates = input.plan.slots.map((slot) => slot.date).sort();
  if (
    !Number.isFinite(now.getTime()) ||
    input.plan.slots.some(
      (slot) => slot.date < today || slot.date > addDaysToKey(today, 31),
    )
  )
    throw new D1FoodPlanningUnavailable("INVALID_DATES");
  const available = await d1FoodSourceStorageAvailable(db);
  if (!available) throw new D1FoodPlanningUnavailable();
  const current = await db
    .withSession("first-primary")
    .prepare(
      `SELECT u.family_id,u.role,u.token_version,f.features FROM "User" u JOIN "Family" f ON f.id=u.family_id WHERE u.id=?1`,
    )
    .bind(actor.userId)
    .first<{
      family_id: string | null;
      role: string;
      token_version: number;
      features: unknown;
    }>();
  if (
    !current ||
    current.family_id !== actor.familyId ||
    current.role !== actor.role ||
    current.token_version !== actor.generation
  )
    throw new D1FoodPlanningUnavailable("CONTEXT_CHANGED");
  const features = normalizeFeatures(parseJson(current.features));
  if (
    !isFeatureEnabled(features, "meals") ||
    !isFeatureEnabled(features, "inventory")
  )
    throw new D1FoodPlanningUnavailable("FORBIDDEN");
  const recipes = await readRecipes(db, actor.familyId, input.recipeIds);
  const inventory = await readInventory(db, actor.familyId, today);
  const meals = await readMeals(
    db,
    actor.familyId,
    today,
    dates[dates.length - 1],
  );
  if (meals.length > 500) throw new D1FoodPlanningUnavailable("SOURCE_LIMIT");
  const occupied = meals.map((meal) => ({
    date: toDateOnlyUTC(new Date(meal.date)),
    mealType: meal.meal_type,
  }));
  const horizon = { from: today, through: dates[dates.length - 1] };
  const commitmentGraph = await readD1FoodCommitments(
    db,
    actor.familyId,
    horizon,
    meals,
  );
  const existingRecipeIds = new Set(recipes.map((row) => row.id));
  const dependencyIds = commitmentGraph.pendingRecipeIds.filter(
    (recipeId) => !existingRecipeIds.has(recipeId),
  );
  if (dependencyIds.length > 200)
    throw new D1FoodPlanningUnavailable("SOURCE_LIMIT");
  const readRecipeChunks = async (ids: readonly string[]) => {
    const result: FoodRecipe[] = [];
    for (let offset = 0; offset < ids.length; offset += 50)
      result.push(
        ...(await readRecipes(
          db,
          actor.familyId,
          ids.slice(offset, offset + 50),
        )),
      );
    return result;
  };
  const dependencyRecipes = await readRecipeChunks(dependencyIds);
  if (dependencyRecipes.length !== dependencyIds.length)
    throw new D1FoodPlanningUnavailable();
  const verifiedRecipeIds = new Set([
    ...recipes.map((row) => row.id),
    ...dependencyRecipes.map((row) => row.id),
  ]);
  const preparedIds = commitmentGraph.preparedRecipeIds.filter(
    (recipeId) => !verifiedRecipeIds.has(recipeId),
  );
  const preparedRecipeOwnership = await readRecipeChunks(preparedIds);
  if (preparedRecipeOwnership.length !== preparedIds.length)
    throw new D1FoodPlanningUnavailable();
  const commitmentRecipes = dependencyRecipes;
  const calendar = await readD1FoodCalendar(
    db,
    actor.familyId,
    input.plan,
    isFeatureEnabled(features, "calendar"),
    now,
  );
  const graphRecipes = [...recipes, ...commitmentRecipes];
  const sourceRecipeIngredientRows = graphRecipes.length
    ? await rows<{ id: string }>(
        db,
        `SELECT ri.id FROM "RecipeIngredient" ri
           JOIN "Recipe" r ON r.id=ri.recipe_id AND r.family_id=?1
          WHERE ri.recipe_id IN (${placeholders(graphRecipes.length)})
          ORDER BY ri.id`,
        [actor.familyId, ...graphRecipes.map((row) => row.id)],
      )
    : [];
  const sourceVersions = await readD1FoodSourceVersions(db, actor.familyId, {
    Family: [actor.familyId],
    User: [actor.userId],
    Recipe: [
      ...graphRecipes.map((row) => row.id),
      ...preparedRecipeOwnership.map((row) => row.id),
    ],
    RecipeIngredient: sourceRecipeIngredientRows.map((row) => row.id),
    Ingredient: graphRecipes
      .flatMap((row) => row.ingredients.map((line) => line.ingredient.id))
      .concat(
        inventory.flatMap((row) =>
          row.ingredient_id ? [row.ingredient_id] : [],
        ),
      ),
    InventoryItem: inventory.map((row) => row.id),
    FamilyMeal: [
      ...meals.map((row) => row.id),
      ...commitmentGraph.sources.allocations.map((row) => row.id),
    ],
    MealPrepSession: commitmentGraph.sources.sessions.map((row) => row.id),
    MealBatch: commitmentGraph.sources.batches.map((row) => row.id),
    MealBatchConsumption: commitmentGraph.sources.consumption.map(
      (row) => row.id,
    ),
  });
  const planningInputs: FoodPlanningInputs = {
    recipes,
    stock: inventory,
    occupied,
    coverage: { recipes: true, stock: true, meals: true },
    calendar: calendar?.snapshot,
    commitments: {
      horizon,
      entries: commitmentGraph.entries,
      recipes: commitmentRecipes,
      prepared: commitmentGraph.prepared,
    },
  };
  const plan = buildFoodPlan(input.plan, planningInputs);
  assertCurrent(new Date(), now);
  const snapshotRevision = createHmac("sha256", getJwtSecret())
    .update(
      canonicalRequestJson([
        "food-plan.snapshot.v1",
        actor,
        input,
        features,
        JSON.parse(
          JSON.stringify({
            sourceVersions,
            recipes,
            inventory,
            meals,
            commitments: commitmentGraph.sources,
            dependencyRecipes,
            preparedRecipeOwnership,
            calendar,
          }),
        ),
      ]),
    )
    .digest("hex");
  return {
    owner: { ...actor },
    sourceRequest: input,
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60000).toISOString(),
    recipeScope: input.recipeIds ? ("selected" as const) : ("library" as const),
    snapshotRevision,
    plan,
  };
}

/** Native D1 counterpart to the provider-backed food suggestion.  The
 * provider receives only the opaque catalog projection; every proposed
 * recipe is resolved and re-read through the same D1 source lease before a
 * response is returned.  This function never reserves a food write key. */
export async function suggestD1FoodPlan(
  db: D1Store,
  actor: FoodPlanActor,
  raw: unknown,
  config: CaptureConfig,
  features: ReturnType<typeof normalizeFeatures>,
  meter: Exclude<AiUsageJob, undefined>,
  renewAuthentication: () => Promise<boolean>,
) {
  if (!foodAiEnabled()) throw new FoodAiRefused("AI_SOURCE_CHANGED");
  const input = foodAiRequest.parse(raw);
  const original = foodPreviewView.parse(
    await previewD1FoodPlan(db, actor, input.sourceRequest),
  );
  if (!foodAiLeaseCurrent(original))
    throw new FoodAiRefused("AI_SOURCE_CHANGED");
  if (Buffer.byteLength(JSON.stringify(original), "utf8") > 262144)
    throw new FoodAiRefused("AI_SOURCE_LIMIT");
  const catalog = buildFoodAiCatalog(original);
  if (
    !foodAiEnabled() ||
    !foodAiLeaseCurrent(original) ||
    !(await renewAuthentication())
  )
    throw new FoodAiRefused("AI_SOURCE_CHANGED");
  const providerReply = await structuredFoodPlanReply(
    catalog.projection,
    input.preference,
    config,
    meter.observer,
  );
  if (
    !foodAiEnabled() ||
    !foodAiLeaseCurrent(original) ||
    !(await renewAuthentication()) ||
    !(await meter.replyAllowed())
  )
    throw new FoodAiRefused("AI_SOURCE_CHANGED");
  const evidence = resolveFoodAiChoices(providerReply, catalog, original);
  const chosen = foodPreviewRequest.parse({
    ...original.sourceRequest,
    plan: {
      ...original.sourceRequest.plan,
      slots: original.sourceRequest.plan.slots.map((slot) => ({
        ...slot,
        recipeId: evidence.find((row) => row.key === slot.key)!.recipeId,
      })),
    },
  });
  const renewed = foodPreviewView.parse(
    await previewD1FoodPlan(
      db,
      actor,
      original.sourceRequest,
      new Date(original.generatedAt),
    ),
  );
  if (
    renewed.snapshotRevision !== original.snapshotRevision ||
    canonicalRequestJson(renewed.plan) !== canonicalRequestJson(original.plan)
  )
    throw new FoodAiRefused("AI_SOURCE_CHANGED");
  const current = await db
    .withSession("first-primary")
    .prepare(
      `SELECT f.features,f.beta_metrics_enabled,f.capture_ai_key_enc,f.capture_ai_base_url,f.capture_ai_model
         FROM "Family" f WHERE f.id=?1`,
    )
    .bind(actor.familyId)
    .first<{
      features: unknown;
      beta_metrics_enabled: number | boolean | null;
      capture_ai_key_enc: string | null;
      capture_ai_base_url: string | null;
      capture_ai_model: string | null;
    }>();
  const currentConfig = current ? resolveCaptureConfig(current) : null;
  if (
    !current ||
    !currentConfig ||
    canonicalRequestJson(currentConfig) !== canonicalRequestJson(config) ||
    canonicalRequestJson(normalizeFeatures(parseJson(current.features))) !==
      canonicalRequestJson(features)
  )
    throw new FoodAiRefused("AI_SOURCE_CHANGED");
  const proposal = foodPreviewView.parse(
    await previewD1FoodPlan(db, actor, chosen, new Date(original.generatedAt)),
  );
  const evaluation = evaluateFoodAiProposal(original, proposal);
  const result = foodAiSuggestion.parse({
    protocol: FOOD_AI,
    feedbackTicket:
      current.beta_metrics_enabled === true ||
      current.beta_metrics_enabled === 1
        ? issueFoodAiFeedback(actor)
        : null,
    original,
    proposal,
    evidence,
    evaluation,
  });
  if (
    !foodAiEnabled() ||
    !foodAiLeaseCurrent(original) ||
    !(await renewAuthentication()) ||
    !(await meter.replyAllowed())
  )
    throw new FoodAiRefused("AI_SOURCE_CHANGED");
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 655360)
    throw new FoodAiRefused("AI_SOURCE_LIMIT");
  return result;
}

type D1FoodReviewAuxiliary = {
  people: Array<{
    id: string;
    name: string;
    role: string;
    token_version: number;
  }>;
  lists: Array<{
    id: string;
    name: string;
    type: string;
    updated_at: number;
  }>;
  groceries: Array<{
    key: string;
    listId: string;
    quantityBasis: "full-scaled-recipe";
    ingredients: Array<{
      ingredientId: string;
      name: string;
      amount: number;
      unit: string | null;
    }>;
  }>;
  occupiedAllocations: Array<{ id: string }>;
  sourceVersions: Awaited<ReturnType<typeof readD1FoodSourceVersions>>;
};

/** Re-read the small, user-selected part of the food write graph.  This is
 * deliberately shared by review and apply so the auxiliary digest has one
 * canonical shape on D1 as it does on PostgreSQL. */
export async function readD1FoodReviewAuxiliary(
  db: D1Store,
  actor: FoodPlanActor,
  input: ReviewedFoodWrite,
  now: Date,
): Promise<D1FoodReviewAuxiliary> {
  const session = db.withSession("first-primary");
  const current = await session
    .prepare(
      `SELECT role,token_version,email_verified FROM "User" WHERE id=?1 AND family_id=?2`,
    )
    .bind(actor.userId, actor.familyId)
    .first<{
      role: string;
      token_version: number;
      email_verified: number | boolean;
    }>();
  if (
    !current ||
    current.role !== actor.role ||
    current.token_version !== actor.generation ||
    (input.mode === "prep" && !Boolean(current.email_verified))
  )
    throw new FoodReviewRefused();
  const cooks =
    input.mode === "meals"
      ? input.meals.map((row) => row.input.cook_id)
      : input.input.dishes.flatMap((dish) => [
          dish.cook_id,
          ...dish.meals.map((meal) => meal.cook_id),
        ]);
  const cookIds = [
    ...new Set(cooks.filter((value): value is string => Boolean(value))),
  ].sort();
  const people = cookIds.length
    ? (
        await session
          .prepare(
            `SELECT id,name,role,token_version FROM "User" WHERE family_id=?1 AND id IN (${placeholders(cookIds.length)}) ORDER BY id`,
          )
          .bind(actor.familyId, ...cookIds)
          .all<{
            id: string;
            name: string;
            role: string;
            token_version: number;
          }>()
      ).results
    : [];
  if (people.length !== cookIds.length) throw new FoodReviewRefused();
  const listIds = [...new Set(input.groceries.map((row) => row.listId))].sort();
  const lists = listIds.length
    ? (
        await session
          .prepare(
            `SELECT id,name,type,updated_at FROM "List" WHERE family_id=?1 AND type IN ('grocery','shopping') AND id IN (${placeholders(listIds.length)}) ORDER BY id`,
          )
          .bind(actor.familyId, ...listIds)
          .all<{ id: string; name: string; type: string; updated_at: number }>()
      ).results
    : [];
  if (lists.length !== listIds.length) throw new FoodReviewRefused();
  const selected =
    input.mode === "meals"
      ? input.meals.map((row) => ({
          key: row.key,
          recipeId: row.input.recipe_id!,
          servings: row.input.servings!,
        }))
      : input.input.dishes.map((dish, index) => ({
          key: input.dishKeys[index],
          recipeId: dish.recipe_id!,
          servings: dish.total_servings,
        }));
  const recipeIds = [...new Set(selected.map((row) => row.recipeId))].sort();
  const recipeLines = recipeIds.length
    ? (
        await session
          .prepare(
            `SELECT ri.recipe_id,ri.ingredient_id,ri.amount,ri.unit,i.name,i.unit AS ingredient_unit,i.family_id AS ingredient_family_id,r.servings FROM "RecipeIngredient" ri JOIN "Recipe" r ON r.id=ri.recipe_id AND r.family_id=?1 JOIN "Ingredient" i ON i.id=ri.ingredient_id AND i.family_id=?1 WHERE ri.recipe_id IN (${placeholders(recipeIds.length)}) ORDER BY ri.id`,
          )
          .bind(actor.familyId, ...recipeIds)
          .all<{
            recipe_id: string;
            ingredient_id: string;
            amount: number;
            unit: string | null;
            name: string;
            ingredient_unit: string | null;
            ingredient_family_id: string;
            servings: number;
          }>()
      ).results
    : [];
  if (recipeLines.some((line) => line.ingredient_family_id !== actor.familyId))
    throw new FoodReviewRefused();
  const groceries = input.groceries.map((selection) => {
    const choice = selected.find((row) => row.key === selection.key);
    const lines = recipeLines.filter(
      (line) => line.recipe_id === choice?.recipeId,
    );
    if (!choice || !lines.length) throw new FoodReviewRefused();
    return {
      key: selection.key,
      listId: selection.listId,
      quantityBasis: "full-scaled-recipe" as const,
      ingredients: selection.ingredientIds.map((ingredientId) => {
        const line = lines.find(
          (value) => value.ingredient_id === ingredientId,
        );
        if (
          !line ||
          !Number.isFinite(line.amount) ||
          line.amount < 0 ||
          line.servings < 1
        )
          throw new FoodReviewRefused();
        const amount = recipeGroceryAmount(
          line.amount,
          line.servings,
          choice.servings,
        );
        if (!Number.isFinite(amount)) throw new FoodReviewRefused();
        return {
          ingredientId,
          name: line.name,
          amount,
          unit: line.unit ?? line.ingredient_unit ?? null,
        };
      }),
    };
  });
  const allocations =
    input.mode === "prep" ? input.input.dishes.flatMap((row) => row.meals) : [];
  const today = dayKeyFor({
    kind: "tz",
    timeZone: input.sourceRequest.plan.timeZone,
  })(now);
  if (
    allocations.some(
      (row) => row.date < today || row.date > addDaysToKey(today, 31),
    )
  )
    throw new FoodReviewRefused();
  const occupiedAllocations = allocations.length
    ? (
        await session
          .prepare(
            `SELECT id FROM "FamilyMeal" WHERE family_id=?1 AND (${allocations
              .map(
                (_, index) =>
                  `(date=?${index * 2 + 2} AND meal_type=?${index * 2 + 3})`,
              )
              .join(" OR ")}) LIMIT 1`,
          )
          .bind(
            actor.familyId,
            ...allocations.flatMap((row) => [
              parseDateOnly(row.date)!.getTime(),
              row.meal_type,
            ]),
          )
          .all<{ id: string }>()
      ).results
    : [];
  if (occupiedAllocations.length) throw new FoodReviewRefused();
  return {
    people,
    lists,
    groceries,
    occupiedAllocations,
    sourceVersions: await readD1FoodSourceVersions(db, actor.familyId, {
      User: cookIds,
      List: listIds,
    }),
  };
}

/** D1 review bridge.  This is still read-only: it renews the preview and
 * issues the same short-lived review seal consumed by the eventual apply. */
export async function reviewD1FoodPlanWrite(
  db: D1Store,
  actor: FoodPlanActor,
  raw: unknown,
  now = new Date(),
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new FoodReviewRefused();
  const input = reviewedFoodWrite.parse({
    ...(raw as Record<string, unknown>),
    reviewProof: "pending-server-review",
  });
  const observation = await previewD1FoodPlan(
    db,
    actor,
    input.sourceRequest,
    now,
  );
  if (!foodWriteChoicesMatch(actor, input, observation.plan))
    throw new FoodReviewRefused();
  const auxiliary = await readD1FoodReviewAuxiliary(db, actor, input, now);
  const reviewProof = issueFoodReviewSeal(
    actor,
    input,
    observation.snapshotRevision,
    auxiliary,
    now,
  );
  assertFoodReviewLease(readFoodReviewSeal(actor, { ...input, reviewProof }));
  const sealedInput: ReviewedFoodWrite = { ...input, reviewProof };
  if (
    Buffer.byteLength(JSON.stringify(sealedInput), "utf8") > FOOD_BODY_MAX_BYTES
  )
    throw new FoodReviewRefused();
  return {
    owner: { ...actor },
    generatedAt: observation.generatedAt,
    expiresAt: observation.expiresAt,
    input: sealedInput,
    plan: observation.plan,
    people: auxiliary.people.map(({ id, name, role }) => ({ id, name, role })),
    lists: auxiliary.lists.map(({ id, name, type }) => ({ id, name, type })),
    groceries: auxiliary.groceries,
  };
}

function foodApplyFailure(status: number, code: string) {
  return { status, body: { error: { code } } };
}

async function authorizeD1FoodApply(
  db: D1ReadClient,
  actor: FoodPlanActor,
  input: ReviewedFoodWrite,
) {
  const [user, family] = await Promise.all([
    db.user.findUnique({
      where: { id: actor.userId },
      select: {
        family_id: true,
        role: true,
        token_version: true,
        email_verified: true,
      },
    }),
    db.family.findUnique({
      where: { id: actor.familyId },
      select: { features: true },
    }),
  ]);
  if (
    !user ||
    user.family_id !== actor.familyId ||
    user.role !== actor.role ||
    user.token_version !== actor.generation
  )
    return foodApplyFailure(403, "AUTH_CONTEXT_CHANGED");
  if (!["parent", "teen"].includes(actor.role))
    return foodApplyFailure(403, "FORBIDDEN");
  const features = normalizeFeatures(parseJson(family?.features));
  if (
    !family ||
    !isFeatureEnabled(features, "meals") ||
    !isFeatureEnabled(features, "inventory") ||
    (input.groceries.length && !isFeatureEnabled(features, "lists"))
  )
    return foodApplyFailure(403, "FORBIDDEN");
  if (input.mode === "prep" && !Boolean(user.email_verified))
    return foodApplyFailure(403, "FORBIDDEN");
  return null;
}

/** Native D1 food apply.  The root idempotency key is owned by this one
 * person-effect batch; meals, prep rows and grocery items therefore commit
 * atomically and an exact retry returns the saved receipt without recreating
 * any child row. */
export async function applyD1FoodPlan(
  db: D1Store,
  actor: FoodPlanActor,
  raw: unknown,
  key: string,
): Promise<NativePersonResult> {
  const input = reviewedFoodWrite.parse(raw);
  let sourceVersionsForChecks: Awaited<
    ReturnType<typeof readD1FoodSourceVersions>
  > = [];
  return executeD1PersonEffect({
    actor,
    action: FOOD_APPLY_ACTION,
    input,
    key,
    database: db,
    authorize: (read) => authorizeD1FoodApply(read, actor, input),
    plan: async (read, receiptId) => {
      if (process.env.FAMILY_FOOD_PLANNING_READY !== "1")
        return foodApplyFailure(409, "UNAVAILABLE");
      const writeSession = db.withSession("first-primary");
      const seal = readFoodReviewSeal(actor, input);
      assertFoodReviewLease(seal);
      const observation = await previewD1FoodPlan(
        db,
        actor,
        input.sourceRequest,
        new Date(seal.issuedAt),
      );
      if (
        observation.snapshotRevision !== seal.source ||
        !foodWriteChoicesMatch(actor, input, observation.plan)
      )
        throw new FoodReviewRefused();
      const auxiliary = await readD1FoodReviewAuxiliary(
        db,
        actor,
        input,
        new Date(seal.issuedAt),
      );
      if (
        foodReviewDigest("food-review.auxiliary.v1", auxiliary) !==
        seal.auxiliary
      )
        throw new FoodReviewRefused();

      const selected =
        input.mode === "meals"
          ? input.meals.map((row) => ({
              key: row.key,
              recipeId: row.input.recipe_id!,
              servings: row.input.servings!,
            }))
          : input.input.dishes.map((dish, index) => ({
              key: input.dishKeys[index],
              recipeId: dish.recipe_id!,
              servings: dish.total_servings,
            }));
      const recipeIds = [...new Set(selected.map((row) => row.recipeId))];
      const sourceRecipeIngredientRows = recipeIds.length
        ? await db
            .withSession("first-primary")
            .prepare(
              `SELECT ri.id,ri.ingredient_id FROM "RecipeIngredient" ri
                 JOIN "Recipe" r ON r.id=ri.recipe_id AND r.family_id=?1
                 JOIN "Ingredient" i ON i.id=ri.ingredient_id AND i.family_id=?1
                WHERE ri.recipe_id IN (${placeholders(recipeIds.length)})
                ORDER BY ri.id`,
            )
            .bind(actor.familyId, ...recipeIds)
            .all<{ id: string; ingredient_id: string }>()
        : { results: [] as Array<{ id: string; ingredient_id: string }> };
      const cookIdsForSources = [
        ...new Set(
          (input.mode === "meals"
            ? input.meals.map((row) => row.input.cook_id)
            : input.input.dishes.flatMap((dish) => [
                dish.cook_id,
                ...dish.meals.map((meal) => meal.cook_id),
              ])
          ).filter((value): value is string => Boolean(value)),
        ),
      ];
      sourceVersionsForChecks = await readD1FoodSourceVersions(
        db,
        actor.familyId,
        {
          Family: [actor.familyId],
          User: [actor.userId, ...cookIdsForSources],
          Recipe: recipeIds,
          RecipeIngredient: sourceRecipeIngredientRows.results.map(
            (row) => row.id,
          ),
          Ingredient: sourceRecipeIngredientRows.results.map(
            (row) => row.ingredient_id,
          ),
          List: [...new Set(input.groceries.map((row) => row.listId))],
        },
      );
      const recipes = await read.recipe.findMany({
        where: { family_id: actor.familyId, id: { in: recipeIds } },
        select: { id: true, title: true, servings: true },
      });
      if (recipes.length !== recipeIds.length) throw new FoodReviewRefused();
      const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
      const cooks =
        input.mode === "meals"
          ? input.meals.map((row) => row.input.cook_id)
          : input.input.dishes.flatMap((dish) => [
              dish.cook_id,
              ...dish.meals.map((meal) => meal.cook_id),
            ]);
      const cookIds = [
        ...new Set(cooks.filter((value): value is string => Boolean(value))),
      ];
      if (cookIds.length) {
        const people = await read.user.findMany({
          where: { family_id: actor.familyId, id: { in: cookIds } },
          select: { id: true },
        });
        if (people.length !== cookIds.length) throw new FoodReviewRefused();
      }
      const listIds = [...new Set(input.groceries.map((row) => row.listId))];
      const lists = listIds.length
        ? await read.list.findMany({
            where: {
              family_id: actor.familyId,
              id: { in: listIds },
              type: { in: ["grocery", "shopping"] },
            },
            select: { id: true },
          })
        : [];
      if (lists.length !== listIds.length) throw new FoodReviewRefused();
      const nowMs = Date.now();
      const effects: D1Statement[] = [];
      const receipt = {
        meals: [] as Array<{ key: string; mealId: string }>,
        prep: null as {
          sessionId: string;
          dishes: Array<{ key: string; batchId: string }>;
        } | null,
        groceries: [] as Array<{
          key: string;
          requestId: string;
          listId: string;
        }>,
      };
      const targets = new Map<
        string,
        {
          recipeId: string;
          servings: number;
          mealId?: string;
          batchId?: string;
        }
      >();
      const mealRows: Array<{
        key: string;
        mealId: string;
        date: string;
        mealType: string;
        recipeName: string | null;
        notes: string | null;
        cookId: string | null;
        recipeId: string;
        servings: number | null;
      }> = [];
      if (input.mode === "meals") {
        for (const row of input.meals) {
          const recipe = recipeById.get(row.input.recipe_id!);
          if (!recipe) throw new FoodReviewRefused();
          const mealId = randomUUID();
          mealRows.push({
            key: row.key,
            mealId,
            date: row.input.date,
            mealType: row.input.meal_type,
            recipeName: row.input.recipe_name ?? recipe.title,
            notes: row.input.notes ?? null,
            cookId: row.input.cook_id ?? null,
            recipeId: recipe.id,
            servings: row.input.servings ?? null,
          });
          targets.set(row.key, {
            recipeId: recipe.id,
            servings: row.input.servings ?? recipe.servings,
            mealId,
          });
          receipt.meals.push({ key: row.key, mealId });
        }
      } else {
        const sessionId = randomUUID();
        const batchRows: Array<{
          key: string;
          batchId: string;
          name: string;
          total: number;
          storage: string;
          recipeId: string;
          cookId: string | null;
          meals: Array<{
            date: string;
            meal_type: "breakfast" | "lunch" | "dinner" | "snack";
            servings: number;
            recipe_name?: string;
            notes?: string | null;
            cook_id?: string | null;
          }>;
        }> = [];
        for (const [index, dish] of input.input.dishes.entries()) {
          const recipe = recipeById.get(dish.recipe_id!);
          if (!recipe) throw new FoodReviewRefused();
          const batchId = randomUUID();
          batchRows.push({
            key: input.dishKeys[index],
            batchId,
            name: dish.name,
            total: dish.total_servings,
            storage: dish.reserve_storage,
            recipeId: recipe.id,
            cookId: dish.cook_id ?? null,
            meals: dish.meals,
          });
          targets.set(input.dishKeys[index], {
            recipeId: recipe.id,
            servings: dish.total_servings,
            batchId,
          });
        }
        effects.push(
          writeSession
            .prepare(
              `INSERT INTO "MealPrepSession"(id,family_id,prepared_on,next_prep_on,created_by,source_request_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)`,
            )
            .bind(
              sessionId,
              actor.familyId,
              parseDateOnly(input.input.prepared_on)!.getTime(),
              input.input.next_prep_on
                ? parseDateOnly(input.input.next_prep_on)!.getTime()
                : null,
              actor.userId,
              receiptId,
              nowMs,
            ),
        );
        for (const [position, batch] of batchRows.entries()) {
          effects.push(
            writeSession
              .prepare(
                `INSERT INTO "MealBatch"(id,family_id,prep_session_id,position,name,total_servings,reserve_storage,recipe_id,cook_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
              )
              .bind(
                batch.batchId,
                actor.familyId,
                sessionId,
                position,
                batch.name,
                batch.total,
                batch.storage,
                batch.recipeId,
                batch.cookId,
                nowMs,
              ),
          );
          for (const meal of batch.meals) {
            const mealId = randomUUID();
            mealRows.push({
              key: batch.key,
              mealId,
              date: meal.date,
              mealType: meal.meal_type,
              recipeName: meal.recipe_name ?? batch.name,
              notes: meal.notes ?? null,
              cookId: meal.cook_id !== undefined ? meal.cook_id : batch.cookId,
              recipeId: batch.recipeId,
              servings: meal.servings,
            });
            effects.push(
              writeSession
                .prepare(
                  `INSERT INTO "FamilyMeal"(id,family_id,date,meal_type,recipe_name,notes,cook_id,created_by,created_at,recipe_id,batch_id,batch_allocation_key,servings,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?9)`,
                )
                .bind(
                  mealId,
                  actor.familyId,
                  parseDateOnly(meal.date)!.getTime(),
                  meal.meal_type,
                  meal.recipe_name ?? batch.name,
                  meal.notes ?? null,
                  meal.cook_id !== undefined ? meal.cook_id : batch.cookId,
                  actor.userId,
                  nowMs,
                  batch.recipeId,
                  batch.batchId,
                  `${actor.familyId}:${randomUUID()}`,
                  meal.servings,
                ),
            );
          }
        }
        receipt.prep = {
          sessionId,
          dishes: batchRows.map((row) => ({
            key: row.key,
            batchId: row.batchId,
          })),
        };
      }
      for (const row of mealRows) {
        if (input.mode === "prep") continue;
        effects.push(
          writeSession
            .prepare(
              `INSERT INTO "FamilyMeal"(id,family_id,date,meal_type,recipe_name,notes,cook_id,created_by,created_at,recipe_id,batch_id,batch_allocation_key,servings,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL,NULL,?11,?9)`,
            )
            .bind(
              row.mealId,
              actor.familyId,
              parseDateOnly(row.date)!.getTime(),
              row.mealType,
              row.recipeName,
              row.notes,
              row.cookId,
              actor.userId,
              nowMs,
              row.recipeId,
              row.servings,
            ),
        );
      }
      for (const selection of auxiliary.groceries) {
        const target = targets.get(selection.key);
        if (!target) throw new FoodReviewRefused();
        const sourceKey = target.batchId
          ? `batch:${target.batchId}`
          : `meal:${target.mealId}`;
        const ingredientIds = selection.ingredients.map(
          (row) => row.ingredientId,
        );
        const existing = await read.listItem.findMany({
          where: {
            list_id: selection.listId,
            checked: false,
            ingredient_id: { in: ingredientIds },
            source_key: sourceKey,
          },
          select: { ingredient_id: true },
        });
        const already = new Set(
          existing.flatMap((row) =>
            row.ingredient_id ? [row.ingredient_id] : [],
          ),
        );
        const possibleDuplicates: Array<{
          ingredientId: string;
          matchedItemId: string;
        }> = [];
        let possibleDuplicatesTruncated = false;
        if (ingredientIds.length) {
          const freeText = await read.listItem.findMany({
            where: {
              list_id: selection.listId,
              checked: false,
              ingredient_id: null,
            },
            orderBy: [{ position: "asc" }, { id: "asc" }],
            select: { id: true, content: true },
            take: 2000,
          });
          const byName = new Map<string, string>();
          for (const row of freeText) {
            const name = normalizeName(row.content);
            if (name && !byName.has(name)) byName.set(name, row.id);
          }
          for (const ingredient of selection.ingredients) {
            const matchedItemId = byName.get(normalizeName(ingredient.name));
            if (!matchedItemId) continue;
            if (possibleDuplicates.length >= POSSIBLE_DUPLICATES_LIMIT) {
              possibleDuplicatesTruncated = true;
              break;
            }
            possibleDuplicates.push({
              ingredientId: ingredient.ingredientId,
              matchedItemId,
            });
          }
        }
        const max = await read.listItem.findFirst({
          where: { list_id: selection.listId },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        const requestId = randomUUID();
        const childInput = addFromRecipeSchema.parse(
          input.mode === "meals"
            ? {
                recipeId: target.recipeId,
                mealId: target.mealId,
                servings:
                  input.meals.find((row) => row.key === selection.key)?.input
                    .servings ?? undefined,
                listId: selection.listId,
                ingredientIds,
              }
            : {
                recipeId: target.recipeId,
                batchId: target.batchId,
                servings: target.servings,
                listId: selection.listId,
                ingredientIds,
              },
        );
        const createdCount = ingredientIds.filter(
          (ingredientId) => !already.has(ingredientId),
        ).length;
        const childBody = {
          listId: selection.listId,
          listName:
            auxiliary.lists.find((list) => list.id === selection.listId)
              ?.name ?? "",
          requestId,
          createdCount,
          alreadyOnListCount: ingredientIds.length - createdCount,
          possibleDuplicates,
          possibleDuplicatesTruncated,
          undoExpiresAt: new Date(nowMs + UNDO_WINDOW_MS).toISOString(),
        };
        receipt.groceries.push({
          key: selection.key,
          requestId,
          listId: selection.listId,
        });
        // Grocery outcomes and undo are linked to the same canonical child
        // receipt as the standalone recipe-to-list flow. The child is part of
        // this root batch, so a replay never recreates it or extends undo.
        effects.push(
          writeSession
            .prepare(
              `INSERT INTO "IdempotencyRecord"(id,scope,key,family_id,user_id,action,request_hash,response_status,response_body,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
            )
            .bind(
              requestId,
              `user:${actor.userId}`,
              requestId,
              actor.familyId,
              actor.userId,
              ADD_FROM_RECIPE_ACTION,
              hashIdempotentRequest(ADD_FROM_RECIPE_ACTION, childInput),
              201,
              JSON.stringify(childBody),
              nowMs,
              nowMs + IDEMPOTENCY_TTL_MS,
            ),
        );
        let position = (max?.position ?? 0) + 1;
        for (const ingredient of selection.ingredients) {
          if (already.has(ingredient.ingredientId)) continue;
          effects.push(
            d1WriteCheck(
              writeSession,
              `NOT EXISTS (SELECT 1 FROM "ListItem" WHERE list_id=?1 AND ingredient_id=?2 AND source_key=?3 AND checked=0)`,
              [selection.listId, ingredient.ingredientId, sourceKey],
            ),
            writeSession
              .prepare(
                `INSERT INTO "ListItem"(id,list_id,content,checked,quantity,added_by,position,created_at,updated_at,ingredient_id,recipe_id,meal_id,amount,unit,source,source_key,source_request_id) VALUES(?1,?2,?3,0,1,?4,?5,?6,?6,?7,?8,?9,?10,?11,'recipe',?12,?13)`,
              )
              .bind(
                randomUUID(),
                selection.listId,
                ingredient.name,
                actor.userId,
                position++,
                nowMs,
                ingredient.ingredientId,
                target.recipeId,
                target.mealId ?? null,
                ingredient.amount,
                ingredient.unit,
                sourceKey,
                requestId,
              ),
          );
        }
      }
      const body = foodApplyReceipt.parse(receipt);
      return { status: 201, body, effects: () => effects };
    },
    effectChecks: async () => {
      const allocations =
        input.mode === "meals"
          ? input.meals.map((row) => ({
              date: row.input.date,
              mealType: row.input.meal_type,
            }))
          : input.input.dishes.flatMap((dish) =>
              dish.meals.map((meal) => ({
                date: meal.date,
                mealType: meal.meal_type,
              })),
            );
      return {
        checks: (session: Pick<D1Store, "prepare">) => {
          const sourceChecks = sourceVersionsForChecks.map((version) => {
            const quoted = `"${version.kind}"`;
            if (version.kind === "RecipeIngredient")
              return d1WriteCheck(
                session,
                `EXISTS (SELECT 1 FROM "RecipeIngredient" ri JOIN "Recipe" r ON r.id=ri.recipe_id JOIN "Ingredient" i ON i.id=ri.ingredient_id WHERE ri.id=?1 AND r.family_id=?2 AND i.family_id=?2 AND ri.food_generation=?3 AND ri.food_epoch=?4)`,
                [version.id, actor.familyId, version.generation, version.epoch],
              );
            return d1WriteCheck(
              session,
              `EXISTS (SELECT 1 FROM ${quoted} WHERE id=?1 AND ${version.kind === "Family" ? "id" : "family_id"}=?2 AND food_generation=?3 AND food_epoch=?4)`,
              [version.id, actor.familyId, version.generation, version.epoch],
            );
          });
          return [
            d1WriteCheck(
              session,
              `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role=?3 AND token_version=?4)`,
              [actor.userId, actor.familyId, actor.role, actor.generation],
            ),
            ...sourceChecks,
            ...(allocations.length
              ? [
                  d1WriteCheck(
                    session,
                    `NOT EXISTS (SELECT 1 FROM "FamilyMeal" WHERE family_id=?1 AND (${allocations
                      .map(
                        (_, index) =>
                          `(date=?${index * 2 + 2} AND meal_type=?${index * 2 + 3})`,
                      )
                      .join(" OR ")}))`,
                    [
                      actor.familyId,
                      ...allocations.flatMap((row) => [
                        parseDateOnly(row.date)!.getTime(),
                        row.mealType,
                      ]),
                    ],
                  ),
                ]
              : []),
          ];
        },
      };
    },
  });
}
