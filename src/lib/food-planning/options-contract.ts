/** Scoped record selectors, read-only metadata; no model-generated IDs/URLs. */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
import { foodViewOwner } from "./view-contract";
import { parseCalendarInstant } from "../calendar-planning/instant";
export const FOOD_OPTIONS = "herewoven.food-options.v1";
export const FOOD_OPTIONS_PAGE = 8;
export const foodOptionsQuery = z
  .object({
    kind: z.enum(["recipes", "people", "lists", "departures"]),
    search: z.string().trim().max(100).default(""),
    offset: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .multipleOf(FOOD_OPTIONS_PAGE)
      .default(0),
    selectedIds: z
      .array(id)
      .max(50)
      .default([])
      .refine((ids) => new Set(ids).size === ids.length),
    range: z.object({ start: z.string(), end: z.string() }).strict().optional(),
  })
  .strict()
  .superRefine((query, ctx) => {
    let valid = query.kind !== "departures" ? query.range === undefined : false;
    if (query.kind === "departures" && query.range) {
      try {
        const start = +parseCalendarInstant(query.range.start),
          end = +parseCalendarInstant(query.range.end);
        valid = end > start && end - start <= 32 * 86400000;
      } catch {
        /* Invalid precise interval is not repaired. */
      }
    }
    if (!valid)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose the explicit departure search interval",
      });
  });
export type FoodOptionsQuery = z.infer<typeof foodOptionsQuery>;
export const foodOption = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("recipe"),
      id,
      title: z.string().min(1).max(1000),
      servings: z.number().int().min(1).max(100),
      minutes: z.number().int().min(0).max(20160).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("person"),
      id,
      name: z.string().min(1).max(1000),
      role: z.string().max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("list"),
      id,
      name: z.string().min(1).max(1000),
      type: z.enum(["grocery", "shopping"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("departure"),
      id,
      title: z.string().max(1000),
      start: z.string().datetime(),
      end: z.string().datetime(),
      repeating: z.boolean(),
    })
    .strict(),
]);
export type FoodOption = z.infer<typeof foodOption>;
const singular = {
  recipes: "recipe",
  people: "person",
  lists: "list",
  departures: "departure",
} as const;
export const foodOptionsReply = z
  .object({
    protocol: z.literal(FOOD_OPTIONS),
    owner: foodViewOwner,
    query: foodOptionsQuery,
    items: z.array(foodOption).max(FOOD_OPTIONS_PAGE),
    selected: z.array(foodOption).max(50),
    hasMore: z.boolean(),
  })
  .strict()
  .refine((reply) => {
    const kind = singular[reply.query.kind];
    return (
      reply.items.every((row) => row.kind === kind) &&
      reply.selected.every(
        (row) => row.kind === kind && reply.query.selectedIds.includes(row.id),
      ) &&
      new Set(reply.items.map((row) => row.id)).size === reply.items.length &&
      new Set(reply.selected.map((row) => row.id)).size ===
        reply.selected.length &&
      reply.selected.length === reply.query.selectedIds.length
    );
  });
export type FoodOptionsReply = z.infer<typeof foodOptionsReply>;
