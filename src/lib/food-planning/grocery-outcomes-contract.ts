/** Historical canonical child receipts, deliberately separate from root replay. */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
import {
  foodRecoveryInput,
  foodRecoveryEntry,
  FOOD_RECOVERY,
} from "./recovery-contract";
export const FOOD_GROCERY_OUTCOMES = "herewoven.food-grocery-outcomes.v1";
export const foodGroceryOutcomeInput = foodRecoveryInput;
export const foodGroceryUndoInput = z
  .object({
    contract: z.literal(FOOD_RECOVERY),
    entry: foodRecoveryEntry,
    requestId: id,
  })
  .strict();
export const canonicalGroceryResult = z
  .object({
    listId: id,
    listName: z.string().max(1000),
    requestId: id,
    createdCount: z.number().int().min(0).max(100),
    alreadyOnListCount: z.number().int().min(0).max(100),
    possibleDuplicates: z
      .array(z.object({ ingredientId: id, matchedItemId: id }).strict())
      .max(20),
    possibleDuplicatesTruncated: z.boolean(),
    undoExpiresAt: z.string().datetime(),
  })
  .strict();
const binding = {
  protocol: z.literal(FOOD_GROCERY_OUTCOMES),
  ownerScope: z.string().regex(/^[a-f0-9]{64}$/),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
};
export const foodGroceryOutcomesReply = z
  .object({
    ...binding,
    outcomes: z
      .array(
        z
          .object({
            key: id,
            requestId: id,
            listId: id,
            result: canonicalGroceryResult.nullable(),
          })
          .strict(),
      )
      .max(14),
  })
  .strict()
  .refine(
    (reply) =>
      new Set(reply.outcomes.map((row) => row.key)).size ===
        reply.outcomes.length &&
      new Set(reply.outcomes.map((row) => row.requestId)).size ===
        reply.outcomes.length &&
      reply.outcomes.every(
        (row) =>
          !row.result ||
          (row.result.requestId === row.requestId &&
            row.result.listId === row.listId),
      ),
  );
export const foodGroceryUndoReply = z
  .object({
    ...binding,
    requestId: id,
    result: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("done"),
          removedCount: z.number().int().min(0).max(100),
          keptCheckedCount: z.number().int().min(0).max(100),
        })
        .strict(),
      z
        .object({
          kind: z.literal("refused"),
          code: z.enum([
            "UNDO_NOT_FOUND",
            "UNDO_NOT_ALLOWED",
            "UNDO_WINDOW_EXPIRED",
            "UNDO_IN_PROGRESS",
          ]),
        })
        .strict(),
    ]),
  })
  .strict();
export type FoodGroceryOutcomes = z.infer<typeof foodGroceryOutcomesReply>;
export type FoodGroceryUndo = z.infer<typeof foodGroceryUndoReply>;
