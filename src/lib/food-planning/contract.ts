/** Provider-free planning contract. No snapshot or proposal is write authority. */
import { z } from "zod";
import { parseDateOnly } from "../dates";
import { parseCalendarInstant } from "../calendar-planning/instant";
import { dayKeyFor } from "../local-day-key";
import { isValidTimeZone } from "../quiet-hours";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
export const FOOD_PLANNING_PROTOCOL = "herewoven.food-planning.v1" as const;
const instant = z.string().refine((value) => {
  try {
    parseCalendarInstant(value);
    return true;
  } catch {
    return false;
  }
});
export const foodTimingRequest = z
  .object({
    start: instant,
    end: instant,
    departureEventId: id.optional(),
    beforeCookingMinutes: z.number().int().min(0).max(240).default(0),
    eatingMinutes: z.number().int().min(0).max(240).default(0),
    cleanupMinutes: z.number().int().min(0).max(240).default(0),
    travelMinutes: z.number().int().min(0).max(240).default(0),
    departurePreparationMinutes: z.number().int().min(0).max(240).default(0),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.end) > Date.parse(value.start) &&
      Date.parse(value.end) - Date.parse(value.start) <= 26 * 3600000 &&
      (value.departureEventId !== undefined ||
        (value.travelMinutes === 0 && value.departurePreparationMinutes === 0)),
    "Choose a positive cooking window and explicit departure buffers.",
  );
export type FoodTimingRequest = z.infer<typeof foodTimingRequest>;
export const foodPlanRequest = z
  .object({
    timeZone: z.string().max(100).refine(isValidTimeZone),
    mode: z.enum(["meals", "prep"]).default("meals"),
    priority: z
      .enum(["use-soon", "least-shopping", "quick"])
      .default("use-soon"),
    repeatRecipes: z.boolean().default(false),
    prepMaxMinutes: z.number().int().min(1).max(1440).optional(),
    prepTiming: foodTimingRequest.optional(),
    ignoredCalendarEventIds: z.array(id).max(100).default([]),
    slots: z
      .array(
        z
          .object({
            key: id,
            date: z.string().refine((value) => parseDateOnly(value) !== null),
            mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
            servings: z.number().int().min(1).max(100),
            recipeId: id.optional(),
            maxMinutes: z.number().int().min(1).max(1440).optional(),
            timing: foodTimingRequest.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(14),
  })
  .strict()
  .superRefine((value, ctx) => {
    const dates = value.slots.map((slot) => slot.date).sort();
    const timings = value.prepTiming
      ? [{ timing: value.prepTiming, date: value.slots[0]?.date }]
      : value.slots
          .filter((slot) => slot.timing)
          .map((slot) => ({ timing: slot.timing!, date: slot.date }));
    const dayKey = isValidTimeZone(value.timeZone)
      ? dayKeyFor({ kind: "tz", timeZone: value.timeZone })
      : null;
    if (
      (value.mode === "meals" && value.prepTiming) ||
      (value.mode === "prep" && value.slots.some((slot) => slot.timing)) ||
      new Set(value.ignoredCalendarEventIds).size !==
        value.ignoredCalendarEventIds.length ||
      (!timings.length && value.ignoredCalendarEventIds.length) ||
      timings.some(
        (row) =>
          dayKey &&
          Number.isFinite(Date.parse(row.timing.end)) &&
          dayKey(new Date(row.timing.end)) !== row.date,
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Use one prep window or individual meal windows on the selected local day.",
      });

    if (
      new Set(value.slots.map((slot) => slot.key)).size !==
        value.slots.length ||
      Date.parse(dates[dates.length - 1]) - Date.parse(dates[0]) >
        6 * 86400000 ||
      (value.mode === "meals" &&
        new Set(value.slots.map((slot) => `${slot.date}:${slot.mealType}`))
          .size !== value.slots.length) ||
      (value.mode === "prep" && new Set(dates).size !== 1) ||
      (value.mode !== "prep" && value.prepMaxMinutes !== undefined)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Choose unique slots across at most seven days, or one prep day.",
      });
  });
export type FoodPlanRequest = z.infer<typeof foodPlanRequest>;
export const foodPreviewRequest = z
  .object({
    plan: foodPlanRequest,
    recipeIds: z
      .array(id)
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
  })
  .strict();

export type FoodPreviewRequest = z.infer<typeof foodPreviewRequest>;
export type FoodRecipe = {
  id: string;
  title: string;
  servings: number;
  prep_time: number | null;
  cook_time: number | null;
  ingredients: Array<{
    amount: number;
    unit: string | null;
    ingredient: { id: string; name: string; unit: string | null };
  }>;
};
export type FoodStock = {
  id: string;
  ingredient_id: string | null;
  name: string;
  amount: number | null;
  unit: string | null;
  expires_on: string | null;
  date_kind: string;
  status: string;
};
export type IngredientCheck = {
  ingredientId: string;
  name: string;
  unit: string | null;
  required: number | null;
  recordedAvailable: number;
  shortfall: number | null;
  state: "covered" | "shortfall" | "check";
  match: "linked" | "name" | null;
  useSoon: boolean;
  reasons: Array<
    | "unknown-amount"
    | "unknown-unit"
    | "different-unit"
    | "name-match"
    | "not-recorded"
    | "planned-elsewhere"
    | "existing-commitment-unknown"
  >;
};
export type FoodCandidate = {
  recipeId: string;
  title: string;
  servings: number;
  baseServings: number;
  authoredMinutes: number | null;
  totalMinutes: number | null;
  schedule?: FoodTimingResult;
  time:
    | "within-requested-limit"
    | "over-requested-limit"
    | "unknown"
    | "not-requested";
  ingredients: IngredientCheck[];
  useSoonCount: number;
  coveredCount: number;
  shortfallCount: number;
  checkCount: number;
};
export type FoodPlanningInputs = {
  recipes: FoodRecipe[];
  stock: FoodStock[];
  occupied: Array<{ date: string; mealType: string }>;
  coverage: { recipes: boolean; stock: boolean; meals: boolean };
  calendar?: FoodCalendarSnapshot;
  commitments?: {
    horizon: { from: string; through: string };
    entries: FoodCommitment[];
    recipes: FoodRecipe[];
    prepared: PreparedFoodPortions[];
  };
};
/** Derived from canonical records by the scoped server reader, never the model. */
export type FoodCommitment = {
  id: string;
  kind: "meal" | "prep-dish";
  date: string;
  originalDate: string;
  label?: string | null;
  recipeId: string | null;
  servings: number | null;
  /** An unprepared dish with recorded consumption is not assumed prepared. */
  stateUncertain?: boolean;
};
export type PreparedFoodPortions = {
  batchId: string;
  sessionId: string;
  name: string;
  recipeId: string | null;
  preparedOn: string;
  preparedAt: string;
  nextPrepOn: string | null;
  storage: "fridge" | "freezer";
  total: number;
  eaten: number;
  planned: number;
  remaining: number;
  unplanned: number;
  recipeHistoryRecorded: boolean;
};
export type FoodCommitmentReview = {
  id: string;
  kind: FoodCommitment["kind"];
  date: string;
  originalDate: string;
  label: string | null;
  recipeId: string | null;
  servings: number | null;
  servingsBasis: "recorded" | "recipe-default" | "unknown";
  ingredients: IngredientCheck[];
  holds: Array<
    | "recipe-unknown"
    | "ingredients-unknown"
    | "quantity-unknown"
    | "prep-state-unknown"
    | "overdue-prep"
  >;
};
export type FoodCalendarSnapshot = {
  observedAt: string;
  complete: boolean;
  reasons: Array<
    | "calendar-disabled"
    | "storage-unavailable"
    | "source-unavailable"
    | "capped"
    | "recurrence-unexpanded"
    | "invalid-interval"
    | "ignored-event-unavailable"
    | "departure-unavailable"
  >;
  ignoredEventIds: string[];
  events: Array<{
    id: string;
    start: string;
    end: string;
    sourceToken: string;
    repeating: boolean;
  }>;
  departures: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    sourceToken: string;
    repeating: boolean;
  }>;
};
export type FoodTimingResult = {
  state: "not-requested" | "fits" | "conflict" | "unknown";
  start: string | null;
  finish: string | null;
  readyBy: string | null;
  occupiedMinutes: number | null;
  blockingEventIds: string[];
  reasons: Array<
    | "calendar-incomplete"
    | "duration-unknown"
    | "window-passed"
    | "no-contiguous-window"
    | "departure-unavailable"
  >;
  departure: FoodCalendarSnapshot["departures"][number] | null;
};
export type FoodPlan = {
  protocol: typeof FOOD_PLANNING_PROTOCOL;
  slots: Array<{
    key: string;
    choice: FoodCandidate | null;
    alternatives: FoodCandidate[];
    holds: Array<
      | "slot-occupied"
      | "recipe-unavailable"
      | "no-recipe"
      | "time-unknown"
      | "time-exceeded"
      | "ingredients-unknown"
      | "source-incomplete"
      | "commitments-unresolved"
      | "calendar-unknown"
      | "calendar-conflict"
    >;
  }>;
  coverage: FoodPlanningInputs["coverage"];
  /** Sequential estimate only: no parallel-cooking, appliance or cleanup assumptions. */
  prepMinutes: number | null;
  prepTime:
    | "within-requested-limit"
    | "over-requested-limit"
    | "unknown"
    | "not-requested";
  existingMealReservationsChecked: boolean;
  inventoryBasis:
    | "recorded-stock-for-new-proposals"
    | "recorded-stock-after-recorded-commitments"
    | "recorded-stock-with-unresolved-commitments";
  commitments: {
    complete: boolean;
    horizon: { from: string; through: string } | null;
    entries: FoodCommitmentReview[];
    prepared: PreparedFoodPortions[];
  };
  calendarChecked: boolean;
  calendar: {
    complete: boolean;
    scope: "recorded-household-events";
    reasons: FoodCalendarSnapshot["reasons"];
    ignoredEventIds: string[];
  } | null;
  prepSchedule: FoodTimingResult | null;
  stockReserved: false;
  writesPerformed: false;
};
