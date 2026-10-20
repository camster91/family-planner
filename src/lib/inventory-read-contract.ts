/** Bounded personal read DTOs. Unknown versions remain readable but cannot authorize writes. */
import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";
import { INVENTORY_CATEGORIES } from "@/lib/inventory";
const id = z.string().min(1).max(128);
const date = z.string().refine((value) => parseDateOnly(value) !== null);
const time = z.string().datetime();
const legacyTime = z
  .union([time, z.literal("")])
  .optional()
  .default("");
const nullableId = id.nullish().transform((value) => value ?? null);
const amount = z.number().finite().min(0).max(100000).nullable();
const maybeAmount = amount.optional().default(null);
const status = z.enum(["active", "consumed", "discarded"]);
const location = z.enum(["fridge", "freezer", "pantry"]);
const kind = z.enum(["best_before", "use_by"]);
const expiry = z.object({
  status: z.enum(["expired", "past_use_by", "today", "soon", "later", "none"]),
  daysLeft: z.number().int().nullable(),
});
export const inventoryReadItem = z.object({
  id,
  name: z.string().min(1).max(200),
  ingredient_id: nullableId,
  amount: maybeAmount,
  unit: z
    .string()
    .max(32)
    .nullish()
    .transform((value) => value ?? null),
  location,
  expires_on: date.nullish().transform((value) => value ?? null),
  date_kind: kind.nullish().transform((value) => value ?? "best_before"),
  category: z
    .enum(INVENTORY_CATEGORIES)
    .nullish()
    .transform((value) => value ?? null),
  purchased_on: date.nullish().transform((value) => value ?? null),
  opened_on: date.nullish().transform((value) => value ?? null),
  status: status.optional().default("active"),
  finished_at: time.nullish().transform((value) => value ?? null),
  added_by: nullableId,
  created_at: legacyTime,
  updated_at: legacyTime,
  expiry,
  barcode: z
    .string()
    .regex(/^\d{14}$/)
    .nullable()
    .optional(),
  product_brand: z.string().max(120).nullable().optional(),
  package_size: z.string().max(80).nullable().optional(),
  product_source: z.string().max(500).nullable().optional(),
});
export const inventoryReadPage = z.object({
  items: z.array(inventoryReadItem).max(500),
  nextOffset: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .optional()
    .default(null),
});
export const inventoryUseSoonPage = z.object({
  items: z
    .array(
      z.object({
        id,
        name: z.string().min(1).max(200),
        location,
        expiresOn: date,
        dateKind: kind.nullish().transform((value) => value ?? "best_before"),
        daysLeft: z.number().int(),
        status: z.enum(["expired", "today", "soon"]),
        label: z.string().max(300).optional().default(""),
      }),
    )
    .max(100),
});
export const inventoryHistoryPage = z.object({
  adjustments: z
    .array(
      z.object({
        id,
        item_id: z
          .union([id, z.literal("")])
          .optional()
          .default(""),
        kind: z.enum(["consume", "discard"]),
        amount_delta: z.number().finite().nullable().optional().default(null),
        amount_before: maybeAmount,
        amount_after: maybeAmount,
        status_before: status.optional().default("active"),
        status_after: status.optional().default("active"),
        actor_id: nullableId,
        created_at: time,
        undone_at: time.nullish().transform((value) => value ?? null),
        item_name: z.string().max(200),
        item_status: status.optional().default("active"),
        undoable: z.boolean().optional(),
      }),
    )
    .max(100),
});
