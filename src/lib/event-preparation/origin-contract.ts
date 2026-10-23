/** Minimal personal context with separate parent and own-account projections. References are not edit authority and do
 * not copy source status, completion proof or future routine definitions. */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
import { parseDateOnly } from "@/lib/dates";
const day = z.string().refine((value) => parseDateOnly(value) !== null);
export const preparationRoutineOrigin = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("available"),
      stackId: id,
      sourceChoreId: id,
      occurrenceDay: day,
      label: z.string().max(200),
      copiedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      state: z.literal("unavailable"),
      copiedAt: z.string().datetime(),
    })
    .strict(),
]);
export const chorePreparationContext = z
  .object({
    owner: z
      .object({
        userId: id,
        familyId: id,
        generation: z.number().int().nonnegative(),
      })
      .strict(),
    state: z.enum(["available", "paused"]),
    backlinks: z.record(id, id),
    origins: z.record(id, preparationRoutineOrigin),
    ownContext: z
      .record(id, z.object({ eventTitle: z.string().max(512) }).strict())
      .default({}),
  })
  .strict();
export type PreparationRoutineOrigins = z.infer<
  typeof chorePreparationContext
>["origins"];
export type ChorePreparationContext = z.infer<typeof chorePreparationContext>;
export function preparationOriginHref(
  origin: Extract<PreparationRoutineOrigins[string], { state: "available" }>,
) {
  return `/dashboard/chores/routines?${new URLSearchParams({ stack_id: origin.stackId, occurrence_date: origin.occurrenceDay })}`;
}
