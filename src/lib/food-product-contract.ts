import { z } from "zod";
import { normalizeFoodBarcode } from "@/lib/food-barcode";
export const foodGtin = z
  .string()
  .length(14)
  .refine((value) => normalizeFoodBarcode(value, "gtin_14") !== null);
export const foodProductDraft = z
  .object({
    barcode: foodGtin,
    brand: z.string().trim().max(120).nullable(),
    package_size: z.string().trim().max(80).nullable(),
    origin: z.enum(["manual", "open-food-facts"]),
    remember: z.boolean(),
    base_revision: z.number().int().nonnegative().nullable(),
  })
  .strict();
export const foodProductSummary = z
  .object({
    barcode: foodGtin,
    name: z.string().min(1).max(200),
    brand: z.string().max(120).nullable(),
    package_size: z.string().max(80).nullable(),
    origin: z.enum(["manual", "open-food-facts"]),
    revision: z.number().int().nonnegative().nullable(),
    source_url: z
      .string()
      .max(500)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            url.hostname === "world.openfoodfacts.org" &&
            !url.username &&
            !url.password &&
            !url.port
          );
        } catch {
          return false;
        }
      })
      .nullable(),
    image_url: z
      .string()
      .max(1000)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            url.hostname === "images.openfoodfacts.org" &&
            !url.username &&
            !url.password &&
            !url.port
          );
        } catch {
          return false;
        }
      })
      .nullable()
      .optional(),
  })
  .strict();
export const foodProductReply = z
  .object({
    context: z
      .object({
        userId: z.string().min(1).max(128),
        familyId: z.string().min(1).max(128),
      })
      .strict(),
    barcode: foodGtin,
    product: foodProductSummary.nullable(),
    publicLookupAvailable: z.boolean(),
  })
  .strict();

export type FoodProductSummary = z.infer<typeof foodProductSummary>;
