import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";
import { MEAL_TYPES } from "@/lib/meal-slots";

const day = z
  .string()
  .refine((value) => Boolean(parseDateOnly(value)), "Invalid calendar day");
const id = z.string().trim().min(1).max(128);
export const mealBatchAllocationSchema = z
  .object({
    date: day,
    meal_type: z.enum(MEAL_TYPES),
    servings: z.number().int().min(1).max(50),
    recipe_name: z.string().trim().min(1).max(200).optional(),
    notes: z.string().max(2000).nullable().optional(),
    cook_id: id.nullable().optional(),
  })
  .strict();
const contextFields = { expected_family_id: id, expected_user_id: id };
const allocations = z.array(mealBatchAllocationSchema).max(14);
const dish = z
  .object({
    name: z.string().trim().min(1).max(200),
    total_servings: z.number().int().min(1).max(50),
    reserve_storage: z.enum(["fridge", "freezer"]),
    recipe_id: id.nullable().optional(),
    cook_id: id.nullable().optional(),
    meals: allocations,
  })
  .strict();
export const createMealPrepSchema = z
  .object({
    ...contextFields,
    prepared_on: day,
    next_prep_on: day.nullable(),
    dishes: z.array(dish).min(1).max(8),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.next_prep_on && value.next_prep_on < value.prepared_on)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Next prep precedes this prep",
      });
    for (const batch of value.dishes) {
      if (batch.meals.some((meal) => meal.date < value.prepared_on))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Meal dates precede preparation",
        });
      if (plannedBatchServings(batch.meals) > batch.total_servings)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Planned portions exceed the dish",
        });
    }
  });
export const mealPrepActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...contextFields,
      action: z.literal("allocate"),
      require_prepared: z.literal(true).optional(),
      batch_id: id,
      meals: allocations.min(1),
      restore_allocation_key: id.optional(),
    })
    .strict(),
  z
    .object({ ...contextFields, action: z.literal("prepared"), session_id: id })
    .strict(),
  z
    .object({
      ...contextFields,
      action: z.literal("eaten"),
      batch_id: id,
      servings: z.number().int().min(1).max(50),
      meal_id: id.nullable().optional(),
    })
    .strict(),
  z
    .object({
      ...contextFields,
      action: z.literal("undo-eaten"),
      consumption_id: id,
    })
    .strict(),
  z
    .object({
      ...contextFields,
      action: z.literal("next-prep"),
      session_id: id,
      next_prep_on: day.nullable(),
      expected_next_prep_on: day.nullable(),
    })
    .strict(),
]);
export type MealBatchAllocation = z.infer<typeof mealBatchAllocationSchema>;
export type CreateMealPrepInput = z.infer<typeof createMealPrepSchema>;
export type MealPrepAction = z.infer<typeof mealPrepActionSchema>;
export function plannedBatchServings(
  meals: readonly { servings: number | null }[],
) {
  return meals.reduce((total, meal) => total + (meal.servings ?? 0), 0);
}
export function batchPortionCounts(
  total: number,
  meals: readonly { id: string; servings: number | null }[],
  consumption: readonly { meal_id: string | null; servings: number }[],
) {
  const eaten = plannedBatchServings(consumption);
  const planned = meals.reduce(
    (sum, meal) =>
      sum +
      Math.max(
        0,
        (meal.servings ?? 0) -
          consumption
            .filter((row) => row.meal_id === meal.id)
            .reduce((n, row) => n + row.servings, 0),
      ),
    0,
  );
  return {
    eaten,
    planned,
    remaining: total - eaten,
    unplanned: total - eaten - planned,
  };
}

const consumptionDto = z.object({
  id,
  meal_id: id.nullable(),
  servings: z.number().int().min(1).max(50),
  consumed_at: z.string().datetime(),
});
const mealDto = z.object({
  id,
  date: z.string().datetime(),
  meal_type: z.enum(MEAL_TYPES),
  servings: z.number().int().min(1).max(50),
});
const batchDto = z.object({
  id,
  name: z.string().min(1).max(200),
  portions_complete: z.boolean().optional(),
  total_servings: z.number().int().min(1).max(50),
  reserve_storage: z.enum(["fridge", "freezer"]),
  recipe_id: id.nullable(),
  recipe_snapshot_at: z.string().datetime().nullable().optional(),
  cook_id: id.nullable(),
  meals: z.array(mealDto).max(50),
  consumption: z.array(consumptionDto).max(50),
});
export const mealPrepListSchema = z.object({
  context: z.object({ familyId: id, userId: id }),
  sessions: z
    .array(
      z.object({
        id,
        prepared_on: z.string().datetime(),
        next_prep_on: z.string().datetime().nullable(),
        prepared_at: z.string().datetime().nullable(),
        batches: z.array(batchDto).min(1).max(8),
      }),
    )
    .max(20),
  nextCursor: id.nullable(),
});
export type MealPrepSummary = z.infer<
  typeof mealPrepListSchema
>["sessions"][number];
export type MealBatchSummary = MealPrepSummary["batches"][number];

export type MealPrepContext = z.infer<typeof mealPrepListSchema>["context"];
