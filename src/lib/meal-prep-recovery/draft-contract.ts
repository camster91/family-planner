/** Incomplete editor fields stay local, separate from a frozen canonical save. */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
import {
  PREP_RECOVERY,
  prepEntry,
  prepKey,
  prepMatchesContext,
  type PrepContext,
} from "./contract";
const partialId = z.union([z.literal(""), id]);
const numeric = z.string().max(12);
const day = z.string().max(10);
const allocation = z
  .object({
    date: day,
    meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    servings: numeric,
  })
  .strict();
const recipe = z
  .object({
    id,
    title: z.string().max(1000),
    servings: z.number().int().min(1).max(100).nullable(),
    prep_time: z.number().int().min(0).max(20160).nullable(),
    cook_time: z.number().int().min(0).max(20160).nullable(),
  })
  .strict();
export const prepCreateDraft = z
  .object({
    kind: z.literal("create"),
    day,
    nextDay: day,
    dishes: z
      .array(
        z
          .object({
            name: z.string().max(200),
            portions: numeric,
            recipe: recipe.nullable(),
            cookId: partialId,
            storage: z.enum(["fridge", "freezer"]),
            meals: z.array(allocation).max(14),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    step: z.number().int().min(0).max(2),
    selectedDish: z.number().int().min(0).max(7),
  })
  .strict()
  .refine((draft) => draft.selectedDish < draft.dishes.length);
export const prepActionDraft = z
  .object({
    kind: z.literal("action"),
    action: z.enum([
      "allocate",
      "eaten",
      "prepared",
      "next-prep",
      "undo-eaten",
    ]),
    sessionId: id,
    batchId: id.optional(),
    consumptionId: id.optional(),
    requirePrepared: z.boolean(),
    mealId: partialId,
    servings: numeric,
    meals: z.array(allocation).max(14),
    nextDay: day,
    expectedNext: day.nullable(),
  })
  .strict()
  .superRefine((draft, ctx) => {
    if (
      (["allocate", "eaten", "undo-eaten"].includes(draft.action) &&
        !draft.batchId) ||
      (draft.action === "undo-eaten" && !draft.consumptionId) ||
      (draft.action !== "allocate" && draft.requirePrepared)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Restore the same canonical bulk action target",
      });
  });
export const prepDraft = z.union([prepCreateDraft, prepActionDraft]);
export type PrepDraft = z.infer<typeof prepDraft>;
export const prepDraftPayload = z
  .object({
    userId: id,
    familyId: id,
    role: z.enum(["parent", "teen"]),
    generation: z.number().int().min(0),
    draft: prepDraft,
  })
  .strict();
export const prepDraftEntry = z
  .object({
    kind: z.literal("local-prep-draft"),
    key: prepKey,
    body: z.string().min(1).max(65536),
  })
  .strict()
  .refine((entry) => {
    try {
      return (
        new TextEncoder().encode(entry.body).byteLength <= 65536 &&
        prepDraftPayload.safeParse(JSON.parse(entry.body)).success
      );
    } catch {
      return false;
    }
  });
export const prepJournalEntry = z.union([prepEntry, prepDraftEntry]);
export type PrepJournalEntry = z.infer<typeof prepJournalEntry>;
export const prepJournal = z
  .object({
    contract: z.literal(PREP_RECOVERY),
    entries: z.array(prepJournalEntry).max(5),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.entries.map((entry) => entry.key)).size ===
        value.entries.length &&
      value.entries.filter((entry) => entry.kind === "local-prep-draft")
        .length <= 1 &&
      value.entries.filter((entry) => entry.kind === "meal-prep").length <= 4,
  );
export function prepJournalMatchesContext(
  entry: PrepJournalEntry,
  context: PrepContext,
) {
  if (entry.kind === "meal-prep") return prepMatchesContext(entry, context);
  const payload = prepDraftPayload.parse(JSON.parse(entry.body));
  return (
    payload.userId === context.userId &&
    payload.familyId === context.familyId &&
    payload.role === context.role &&
    !!context.owner &&
    payload.generation === context.owner.generation
  );
}
