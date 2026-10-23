import { foodWriteChoicesMatch } from "./choices";
/** Browser-safe transport validation. Never trust nested source labels/amounts. */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
import { parseDateOnly } from "../dates";
import { FOOD_PLANNING_PROTOCOL, foodPreviewRequest } from "./contract";
import { reviewedFoodWrite } from "./apply-contract";
const day = z.string().refine((value) => parseDateOnly(value) !== null);
const amount = z.number().finite().min(0);
const count = z.number().int().min(0);
const text = z.string().max(1000);
const unit = z.string().max(100).nullable();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const foodViewOwner = z
  .object({
    userId: id,
    familyId: id,
    role: z.enum(["parent", "teen"]),
    generation: count,
  })
  .strict();
const departure = z
  .object({
    id,
    title: z.string().max(480),
    start: z.string().datetime(),
    end: z.string().datetime(),
    sourceToken: digest,
    repeating: z.boolean(),
  })
  .strict();
const timing = z
  .object({
    state: z.enum(["not-requested", "fits", "conflict", "unknown"]),
    start: z.string().datetime().nullable(),
    finish: z.string().datetime().nullable(),
    readyBy: z.string().datetime().nullable(),
    occupiedMinutes: amount.nullable(),
    blockingEventIds: z.array(id).max(20),
    reasons: z
      .array(
        z.enum([
          "calendar-incomplete",
          "duration-unknown",
          "window-passed",
          "no-contiguous-window",
          "departure-unavailable",
        ]),
      )
      .max(10),
    departure: departure.nullable(),
  })
  .strict();
const ingredient = z
  .object({
    ingredientId: id,
    name: text,
    unit,
    required: amount.nullable(),
    recordedAvailable: amount,
    shortfall: amount.nullable(),
    state: z.enum(["covered", "shortfall", "check"]),
    match: z.enum(["linked", "name"]).nullable(),
    useSoon: z.boolean(),
    reasons: z
      .array(
        z.enum([
          "unknown-amount",
          "unknown-unit",
          "different-unit",
          "name-match",
          "not-recorded",
          "planned-elsewhere",
          "existing-commitment-unknown",
        ]),
      )
      .max(10),
  })
  .strict();
const timeState = z.enum([
  "within-requested-limit",
  "over-requested-limit",
  "unknown",
  "not-requested",
]);
const candidate = z
  .object({
    recipeId: id,
    title: text,
    servings: z.number().int().min(1).max(100),
    baseServings: z.number().int().min(1).max(100),
    authoredMinutes: amount.nullable(),
    totalMinutes: amount.nullable(),
    schedule: timing.optional(),
    time: timeState,
    ingredients: z.array(ingredient).max(100),
    useSoonCount: count,
    coveredCount: count,
    shortfallCount: count,
    checkCount: count,
  })
  .strict();
const calendarReasons = z
  .array(
    z.enum([
      "calendar-disabled",
      "storage-unavailable",
      "source-unavailable",
      "capped",
      "recurrence-unexpanded",
      "invalid-interval",
      "ignored-event-unavailable",
      "departure-unavailable",
    ]),
  )
  .max(20);
export const foodPlanView = z
  .object({
    protocol: z.literal(FOOD_PLANNING_PROTOCOL),
    slots: z
      .array(
        z
          .object({
            key: id,
            choice: candidate.nullable(),
            alternatives: z.array(candidate).max(3),
            holds: z
              .array(
                z.enum([
                  "slot-occupied",
                  "recipe-unavailable",
                  "no-recipe",
                  "time-unknown",
                  "time-exceeded",
                  "ingredients-unknown",
                  "source-incomplete",
                  "commitments-unresolved",
                  "calendar-unknown",
                  "calendar-conflict",
                ]),
              )
              .max(10),
          })
          .strict(),
      )
      .min(1)
      .max(14),
    coverage: z
      .object({ recipes: z.boolean(), stock: z.boolean(), meals: z.boolean() })
      .strict(),
    prepMinutes: amount.nullable(),
    prepTime: timeState,
    existingMealReservationsChecked: z.boolean(),
    inventoryBasis: z.enum([
      "recorded-stock-for-new-proposals",
      "recorded-stock-after-recorded-commitments",
      "recorded-stock-with-unresolved-commitments",
    ]),
    commitments: z
      .object({
        complete: z.boolean(),
        horizon: z.object({ from: day, through: day }).strict().nullable(),
        entries: z
          .array(
            z
              .object({
                id: z.string().min(1).max(150),
                kind: z.enum(["meal", "prep-dish"]),
                date: day,
                originalDate: day,
                label: text.nullable(),
                recipeId: id.nullable(),
                servings: z.number().finite().nullable(),
                servingsBasis: z.enum([
                  "recorded",
                  "recipe-default",
                  "unknown",
                ]),
                ingredients: z.array(ingredient).max(100),
                holds: z
                  .array(
                    z.enum([
                      "recipe-unknown",
                      "ingredients-unknown",
                      "quantity-unknown",
                      "prep-state-unknown",
                      "overdue-prep",
                    ]),
                  )
                  .max(10),
              })
              .strict(),
          )
          .max(700),
        prepared: z
          .array(
            z
              .object({
                batchId: id,
                sessionId: id,
                name: text,
                recipeId: id.nullable(),
                preparedOn: day,
                preparedAt: z.string().datetime(),
                nextPrepOn: day.nullable(),
                storage: z.enum(["fridge", "freezer"]),
                total: count,
                eaten: count,
                planned: count,
                remaining: count,
                unplanned: count,
                recipeHistoryRecorded: z.boolean(),
              })
              .strict(),
          )
          .max(200),
      })
      .strict(),
    calendarChecked: z.boolean(),
    calendar: z
      .object({
        complete: z.boolean(),
        scope: z.literal("recorded-household-events"),
        reasons: calendarReasons,
        ignoredEventIds: z.array(id).max(100),
      })
      .strict()
      .nullable(),
    prepSchedule: timing.nullable(),
    stockReserved: z.literal(false),
    writesPerformed: z.literal(false),
  })
  .strict()
  .refine(
    (plan) =>
      new Set(plan.slots.map((row) => row.key)).size === plan.slots.length,
  );
const lease = {
  owner: foodViewOwner,
  generatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
};
export const foodPreviewView = z
  .object({
    ...lease,
    sourceRequest: foodPreviewRequest,
    recipeScope: z.enum(["selected", "library"]),
    snapshotRevision: digest,
    plan: foodPlanView,
  })
  .strict()
  .refine(
    (view) =>
      Date.parse(view.expiresAt) - Date.parse(view.generatedAt) === 60000,
  );
export const foodReviewView = z
  .object({
    ...lease,
    input: reviewedFoodWrite,
    plan: foodPlanView,
    people: z.array(z.object({ id, name: text, role: text }).strict()).max(120),
    lists: z
      .array(
        z
          .object({ id, name: text, type: z.enum(["grocery", "shopping"]) })
          .strict(),
      )
      .max(14),
    groceries: z
      .array(
        z
          .object({
            key: id,
            listId: id,
            quantityBasis: z.literal("full-scaled-recipe"),
            ingredients: z
              .array(
                z
                  .object({ ingredientId: id, name: text, amount, unit })
                  .strict(),
              )
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .max(14),
  })
  .strict()
  .refine(
    (view) =>
      Date.parse(view.expiresAt) - Date.parse(view.generatedAt) === 60000,
  )
  .refine((view) => foodWriteChoicesMatch(view.owner, view.input, view.plan))
  .refine((view) => {
    const exactIds = (actual: readonly string[], expected: readonly string[]) =>
      actual.length === new Set(expected).size &&
      new Set(actual).size === actual.length &&
      actual.every((id) => expected.includes(id));
    const cooks =
      view.input.mode === "meals"
        ? view.input.meals.map((row) => row.input.cook_id)
        : view.input.input.dishes.flatMap((dish) => [
            dish.cook_id,
            ...dish.meals.map((meal) => meal.cook_id),
          ]);
    if (
      !exactIds(
        view.people.map((row) => row.id),
        cooks.filter((id): id is string => Boolean(id)),
      ) ||
      !exactIds(
        view.lists.map((row) => row.id),
        view.input.groceries.map((row) => row.listId),
      ) ||
      !exactIds(
        view.groceries.map((row) => row.key),
        view.input.groceries.map((row) => row.key),
      )
    )
      return false;
    return view.groceries.every((row) => {
      const selection = view.input.groceries.find(
        (selection) => selection.key === row.key,
      )!;
      return (
        row.listId === selection.listId &&
        exactIds(
          row.ingredients.map((line) => line.ingredientId),
          selection.ingredientIds,
        )
      );
    });
  });
export type FoodPreviewView = z.infer<typeof foodPreviewView>;
export type FoodReviewView = z.infer<typeof foodReviewView>;
