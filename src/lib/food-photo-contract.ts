/** Reviewed document suggestions only. No receipt finances or inferred shelf life. */
import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";
export const FOOD_PHOTO_PROTOCOL = "herewoven.food-photo.v1" as const;
export const FOOD_PHOTO_MODES = ["package", "receipt"] as const;
export type FoodPhotoMode = (typeof FOOD_PHOTO_MODES)[number];
export const foodPhotoItem = z
  .object({
    name: z.string().min(1).max(80),
    amount: z.number().finite().min(0).max(100000).nullable(),
    unit: z.string().max(32).nullable(),
    location: z.enum(["fridge", "freezer", "pantry"]).nullable(),
    confidence: z.number().min(0).max(1),
    package_size: z.string().min(1).max(80).nullable(),
    date_text: z.string().min(1).max(100).nullable(),
    date_candidate: z
      .string()
      .refine((value) => parseDateOnly(value) !== null)
      .nullable(),
    date_kind: z.enum(["best_before", "use_by"]).nullable(),
  })
  .strict();
export const foodPhotoReply = z
  .object({
    protocol: z.literal(FOOD_PHOTO_PROTOCOL),
    capture_mode: z.enum(FOOD_PHOTO_MODES),
    items: z.array(foodPhotoItem).max(50),
    dropped: z.number().int().nonnegative(),
  })
  .strict();
export type FoodPhotoItem = z.infer<typeof foodPhotoItem>;
