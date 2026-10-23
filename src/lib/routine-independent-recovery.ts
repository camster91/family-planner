/** Original independent-step requests are held separately from stack requests. */
import { z } from "zod";
import { queueOwnerSchema } from "@/lib/queue-owner-contract";
import {
  routineIndependentCommand,
  routineIndependentReceipt,
} from "@/lib/routine-independent";
import { ROUTINE_SCHEDULE_MAX_BYTES } from "@/lib/routine-schedule";
export const INDEPENDENT_RECOVERY_CONTRACT =
  "herewoven.routine-independent-recovery.v1";
export const independentRecoveryContext = z
  .object({
    contract: z.literal(INDEPENDENT_RECOVERY_CONTRACT),
    enabled: z.boolean(),
    owner: queueOwnerSchema
      .refine((owner) => owner.kind === "person")
      .nullable(),
    userId: z.string().min(1).max(128),
    familyId: z.string().min(1).max(128),
  })
  .strict()
  .refine(
    (value) =>
      (!value.enabled || value.owner !== null) &&
      (!value.owner || value.owner.ownerId === value.userId),
  );
export type IndependentRecoveryContext = z.infer<
  typeof independentRecoveryContext
>;
export const independentRecoveryEntry = z
  .object({
    kind: z.literal("independent"),
    key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    body: z.string().min(1).max(ROUTINE_SCHEDULE_MAX_BYTES),
  })
  .strict()
  .superRefine((entry, ctx) => {
    try {
      if (
        new TextEncoder().encode(entry.body).byteLength >
          ROUTINE_SCHEDULE_MAX_BYTES ||
        !routineIndependentCommand.safeParse(JSON.parse(entry.body)).success
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid original independent request",
        });
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid original independent request",
      });
    }
  });
export type IndependentRecoveryEntry = z.infer<typeof independentRecoveryEntry>;
export const independentRecoveryJournal = z
  .object({
    contract: z.literal(INDEPENDENT_RECOVERY_CONTRACT),
    entries: z.array(independentRecoveryEntry).max(5),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.entries.map((row) => row.key)).size ===
      value.entries.length,
  );
export function independentEntryMatchesContext(
  entry: IndependentRecoveryEntry,
  context: IndependentRecoveryContext,
) {
  const command = routineIndependentCommand.parse(JSON.parse(entry.body));
  return (
    command.expected_user_id === context.userId &&
    command.expected_family_id === context.familyId
  );
}
export const independentRecoveryReviewInput = z
  .object({
    contract: z.literal(INDEPENDENT_RECOVERY_CONTRACT),
    entry: independentRecoveryEntry,
  })
  .strict();
export const independentRecoveryReview = z
  .object({
    contract: z.literal(INDEPENDENT_RECOVERY_CONTRACT),
    ownerScope: z.string().regex(/^[a-f0-9]{64}$/),
    entry: independentRecoveryEntry,
    state: z.enum([
      "ready",
      "pending",
      "committed",
      "removed",
      "expired",
      "conflict",
      "paused",
      "unavailable",
    ]),
    canRetry: z.boolean(),
    currentRevision: z.number().int().min(1).max(2147483647).nullable(),
    receipt: routineIndependentReceipt.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.canRetry !== ["ready", "pending"].includes(value.state) ||
      ["committed", "removed"].includes(value.state) !==
        (value.receipt !== null)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Contradictory independent result",
      });
    if (value.receipt) {
      const command = routineIndependentCommand.parse(
        JSON.parse(value.entry.body),
      );
      if (
        value.receipt.rootId !== command.root_id ||
        value.receipt.action !== command.action ||
        value.receipt.revision !== command.expected_revision + 1
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Independent proof does not match original request",
        });
    }
  });
export type IndependentRecoveryReview = z.infer<
  typeof independentRecoveryReview
>;
