/** Provider-free planning contract. No snapshot or proposal is write authority. */
import { z } from "zod";
import { parseDateOnly } from "../dates";
import { isValidTimeZone } from "../quiet-hours";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
export const FOOD_PLANNING_PROTOCOL = "herewoven.food-planning.v1" as const;
export const foodPlanRequest = z
  .object({
    timeZone: z.string().max(100).refine(isValidTimeZone),
    mode: z.enum(["meals", "prep"]).default("meals"),
    priority: z
      .enum(["use-soon", "least-shopping", "quick"])
      .default("use-soon"),
    repeatRecipes: z.boolean().default(false),
    prepMaxMinutes: z.number().int().min(1).max(1440).optional(),
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
          })
          .strict(),
      )
      .min(1)
      .max(14),
  })
  .strict()
  .superRefine((value, ctx) => {
    const dates = value.slots.map((slot) => slot.date).sort();
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
  >;
};
export type FoodCandidate = {
  recipeId: string;
  title: string;
  servings: number;
  baseServings: number;
  authoredMinutes: number | null;
  totalMinutes: number | null;
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
  existingMealReservationsChecked: false;
  inventoryBasis: "recorded-stock-for-new-proposals";
  calendarChecked: false;
  stockReserved: false;
  writesPerformed: false;
};
