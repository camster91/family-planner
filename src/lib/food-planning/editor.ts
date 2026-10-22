/** Browser-safe partial editor state; validation occurs before source reads/sends. */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
import { newIdempotencyKey } from "../idempotency-key";
import { resolveScheduleWall } from "../calendar-planning/schedule-form";
import { foodPreviewRequest } from "./contract";
import { reviewedFoodWrite } from "./apply-contract";
import { canonicalRequestJson } from "../idempotency-request-json";
import type { FoodRecoveryContext } from "./recovery-contract";
import type { FoodPreviewView } from "./view-contract";
const partialId = z.union([z.literal(""), id]);
const numeric = z.string().max(12);
const mealType = z.enum(["breakfast", "lunch", "dinner", "snack"]);
const timing = z
  .object({
    enabled: z.boolean(),
    start: z.string().max(30),
    end: z.string().max(30),
    startChoice: z.string().max(40).nullable(),
    endChoice: z.string().max(40).nullable(),
    departureId: partialId,
    before: numeric,
    eating: numeric,
    cleanup: numeric,
    travel: numeric,
    departurePreparation: numeric,
  })
  .strict();
const allocation = z
  .object({
    date: z.string().max(10),
    mealType,
    servings: numeric,
    cookId: partialId,
    inheritCook: z.boolean().default(false),
    notes: z.string().max(2000),
  })
  .strict();
export const foodEditorSlot = z
  .object({
    key: id,
    date: z.string().max(10),
    mealType,
    servings: numeric,
    recipeId: partialId,
    maxMinutes: numeric,
    name: z.string().max(200),
    notes: z.string().max(2000),
    cookId: partialId,
    storage: z.enum(["fridge", "freezer"]),
    timing,
    allocations: z.array(allocation).max(14),
  })
  .strict();
export const foodEditorDraft = z
  .object({
    mode: z.enum(["meals", "prep"]),
    timeZone: z.string().max(100),
    priority: z.enum(["use-soon", "least-shopping", "quick"]),
    repeatRecipes: z.boolean(),
    prepDay: z.string().max(10),
    nextPrepDay: z.string().max(10),
    prepMaxMinutes: numeric,
    prepTiming: timing,
    slots: z.array(foodEditorSlot).min(1).max(14),
    recipeIds: z.array(id).max(50),
    ignoredCalendarEventIds: z.array(id).max(100),
    groceries: z
      .array(
        z
          .object({
            key: id,
            listId: partialId,
            ingredientIds: z.array(id).max(100),
          })
          .strict(),
      )
      .max(14),
  })
  .strict()
  .refine(
    (draft) =>
      new Set(draft.slots.map((slot) => slot.key)).size === draft.slots.length,
  );
export type FoodEditorDraft = z.infer<typeof foodEditorDraft>;
export type FoodEditorSlot = z.infer<typeof foodEditorSlot>;
export function emptyFoodTiming(): FoodEditorSlot["timing"] {
  return {
    enabled: false,
    start: "",
    end: "",
    startChoice: null,
    endChoice: null,
    departureId: "",
    before: "0",
    eating: "0",
    cleanup: "0",
    travel: "0",
    departurePreparation: "0",
  };
}
export function newFoodSlot(day: string): FoodEditorSlot {
  return {
    key: newIdempotencyKey(),
    date: day,
    mealType: "dinner",
    servings: "2",
    recipeId: "",
    maxMinutes: "",
    name: "",
    notes: "",
    cookId: "",
    storage: "fridge",
    timing: emptyFoodTiming(),
    allocations: [],
  };
}
export function newFoodDraft(
  day: string,
  timeZone: string,
  mode: FoodEditorDraft["mode"] = "meals",
): FoodEditorDraft {
  return {
    mode,
    timeZone,
    prepDay: day,
    nextPrepDay: "",
    prepMaxMinutes: "",
    prepTiming: emptyFoodTiming(),
    priority: "use-soon",
    repeatRecipes: false,
    slots: [newFoodSlot(day)],
    recipeIds: [],
    ignoredCalendarEventIds: [],
    groceries: [],
  };
}
function number(value: string, min: number, max: number): number {
  if (!/^\d{1,6}$/.test(value) || Number(value) < min || Number(value) > max)
    throw new Error("Enter a whole number in the allowed range");
  return Number(value);
}
function readTiming(draft: FoodEditorSlot["timing"], zone: string) {
  if (!draft.enabled) return undefined;
  return {
    start: resolveScheduleWall(draft.start, draft.startChoice, zone),
    end: resolveScheduleWall(draft.end, draft.endChoice, zone),
    departureEventId: draft.departureId || undefined,
    beforeCookingMinutes: number(draft.before, 0, 240),
    eatingMinutes: number(draft.eating, 0, 240),
    cleanupMinutes: number(draft.cleanup, 0, 240),
    travelMinutes: number(draft.travel, 0, 240),
    departurePreparationMinutes: number(draft.departurePreparation, 0, 240),
  };
}
export function foodDraftQuery(raw: FoodEditorDraft) {
  const draft = foodEditorDraft.parse(raw);
  if (draft.mode === "prep" && draft.slots.length > 8)
    throw new Error("Choose at most eight prep dishes");
  return foodPreviewRequest.parse({
    recipeIds: draft.recipeIds.length ? draft.recipeIds : undefined,
    plan: {
      mode: draft.mode,
      timeZone: draft.timeZone,
      priority: draft.priority,
      repeatRecipes: draft.repeatRecipes,
      ignoredCalendarEventIds: draft.ignoredCalendarEventIds,
      prepMaxMinutes:
        draft.mode === "prep" && draft.prepMaxMinutes
          ? number(draft.prepMaxMinutes, 1, 1440)
          : undefined,
      prepTiming:
        draft.mode === "prep"
          ? readTiming(draft.prepTiming, draft.timeZone)
          : undefined,
      slots: draft.slots.map((slot) => ({
        key: slot.key,
        date: draft.mode === "prep" ? draft.prepDay : slot.date,
        mealType: slot.mealType,
        servings: number(slot.servings, 1, draft.mode === "prep" ? 50 : 100),
        recipeId: slot.recipeId || undefined,
        maxMinutes: slot.maxMinutes
          ? number(slot.maxMinutes, 1, 1440)
          : undefined,
        timing:
          draft.mode === "meals"
            ? readTiming(slot.timing, draft.timeZone)
            : undefined,
      })),
    },
  });
}
export function foodDraftCommand(
  draft: FoodEditorDraft,
  view: FoodPreviewView,
  context: FoodRecoveryContext,
) {
  const sourceRequest = foodDraftQuery(draft);
  if (
    !context.owner ||
    view.owner.userId !== context.userId ||
    view.owner.familyId !== context.familyId ||
    view.owner.role !== context.role ||
    view.owner.generation !== context.owner.generation ||
    canonicalRequestJson(sourceRequest) !==
      canonicalRequestJson(view.sourceRequest) ||
    view.plan.slots.some((row) => !row.choice || row.holds.length)
  )
    throw new Error("Refresh and review the current choices first");
  const selected = new Map(
    view.plan.slots.map((row) => [row.key, row.choice!]),
  );
  const identity = {
    expected_user_id: context.userId,
    expected_family_id: context.familyId,
  };
  const common = {
    protocol: "herewoven.food-apply.v1",
    sourceRequest,
    reviewProof: "pending-human-review",
    groceries: draft.groceries.filter((row) => row.ingredientIds.length > 0),
  };
  return reviewedFoodWrite.parse(
    draft.mode === "meals"
      ? {
          ...common,
          mode: "meals",
          meals: draft.slots.map((slot) => ({
            key: slot.key,
            input: {
              ...identity,
              protocol: "herewoven.meal-create.v1",
              issued_at: view.generatedAt,
              date: slot.date,
              meal_type: slot.mealType,
              recipe_id: selected.get(slot.key)!.recipeId,
              servings: number(slot.servings, 1, 100),
              notes: slot.notes || null,
              cook_id: slot.cookId || null,
            },
          })),
        }
      : {
          ...common,
          mode: "prep",
          dishKeys: draft.slots.map((slot) => slot.key),
          input: {
            ...identity,
            prepared_on: draft.prepDay,
            next_prep_on: draft.nextPrepDay || null,
            dishes: draft.slots.map((slot) => ({
              name:
                slot.name || defaultDishLabel(selected.get(slot.key)!.title),
              total_servings: number(slot.servings, 1, 50),
              reserve_storage: slot.storage,
              recipe_id: selected.get(slot.key)!.recipeId,
              cook_id: slot.cookId || null,
              meals: slot.allocations.map((meal) => ({
                date: meal.date,
                meal_type: meal.mealType,
                servings: number(meal.servings, 1, 50),
                cook_id: meal.inheritCook ? undefined : meal.cookId || null,
                notes: meal.notes || null,
              })),
            })),
          },
        },
  );
}
export const foodDraftPayload = z
  .object({ userId: id, familyId: id, draft: foodEditorDraft })
  .strict();
export const foodDraftEntry = z
  .object({
    kind: z.literal("local-food-draft"),
    key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    body: z.string().min(1).max(65536),
  })
  .strict()
  .refine((entry) => {
    try {
      return (
        new TextEncoder().encode(entry.body).byteLength <= 65536 &&
        foodDraftPayload.safeParse(JSON.parse(entry.body)).success
      );
    } catch {
      return false;
    }
  });

/** A derived dish label is shown in exact confirmation; recipe identity/title
 * remain unchanged. Respect the canonical 200-code-unit label without splitting
 * a Unicode character from a longer imported recipe title. */
function defaultDishLabel(title: string) {
  if (title.length <= 200) return title;
  let label = "";
  for (const letter of title) {
    if (label.length + letter.length > 197) break;
    label += letter;
  }
  return `${label}…`;
}
