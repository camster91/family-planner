import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";
const id = z.string().min(1).max(128);
export const mealCreateContext = z
  .object({ userId: id, familyId: id })
  .strict();
export const mealCreateInput = z
  .object({
    protocol: z.literal("herewoven.meal-create.v1"),
    expected_user_id: id,
    expected_family_id: id,
    issued_at: z.string().datetime(),
    date: z.string().refine((value) => parseDateOnly(value) !== null),
    meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    recipe_name: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    cook_id: id.nullable().optional(),
    recipe_id: id.nullable().optional(),
    servings: z.number().int().min(1).max(100).nullable().optional(),
  })
  .strict();
export const mealCreateReceipt = z.object({ mealId: id }).strict();
export type MealCreateInput = z.infer<typeof mealCreateInput>;
