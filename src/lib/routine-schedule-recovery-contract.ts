/** Private parent-only exact requests. No offline mutation queue. */
import { z } from "zod";
import { queueOwnerSchema } from "@/lib/queue-owner-contract";
import {
  routineScheduleCommand,
  routineScheduleReceipt,
  ROUTINE_SCHEDULE_MAX_BYTES,
} from "@/lib/routine-schedule";
export const ROUTINE_RECOVERY_CONTRACT = "herewoven.routine-recovery.v1";
export const ROUTINE_RECOVERY_OWNER_HEADER = "X-Herewoven-Routine-Owner";
export const ROUTINE_RECOVERY_MAX_BYTES = 2 * 1024 * 1024;
export const routineRecoveryContext = z
  .object({
    contract: z.literal(ROUTINE_RECOVERY_CONTRACT),
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
export type RoutineRecoveryContext = z.infer<typeof routineRecoveryContext>;
export const routineRecoveryEntry = z
  .object({
    kind: z.literal("schedule"),
    key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    body: z.string().min(1).max(ROUTINE_SCHEDULE_MAX_BYTES),
  })
  .strict()
  .superRefine((entry, ctx) => {
    try {
      if (
        new TextEncoder().encode(entry.body).byteLength >
          ROUTINE_SCHEDULE_MAX_BYTES ||
        !routineScheduleCommand.safeParse(JSON.parse(entry.body)).success
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid saved routine request",
        });
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid saved routine request",
      });
    }
  });
export type RoutineRecoveryEntry = z.infer<typeof routineRecoveryEntry>;
export const routineRecoveryJournal = z
  .object({
    contract: z.literal(ROUTINE_RECOVERY_CONTRACT),
    entries: z.array(routineRecoveryEntry).max(5),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.entries.map((row) => row.key)).size ===
      value.entries.length,
  );
export function routineEntryMatchesContext(
  entry: RoutineRecoveryEntry,
  context: RoutineRecoveryContext,
) {
  const command = routineScheduleCommand.parse(JSON.parse(entry.body));
  return (
    command.expected_user_id === context.userId &&
    command.expected_family_id === context.familyId
  );
}
export const routineRecoveryReviewInput = z
  .object({
    contract: z.literal(ROUTINE_RECOVERY_CONTRACT),
    entry: routineRecoveryEntry,
  })
  .strict();
export const routineRecoveryReview = z
  .object({
    contract: z.literal(ROUTINE_RECOVERY_CONTRACT),
    ownerScope: z.string().regex(/^[a-f0-9]{64}$/),
    entry: routineRecoveryEntry,
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
    currentVersion: z.number().int().min(1).nullable(),
    receipt: routineScheduleReceipt.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const committed = value.state === "committed" || value.state === "removed";
    if (
      value.canRetry !== ["ready", "pending"].includes(value.state) ||
      committed !== (value.receipt !== null)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Contradictory routine recovery state",
      });
    if (value.receipt) {
      let matches = false;
      try {
        const command = routineScheduleCommand.parse(
          JSON.parse(value.entry.body),
        );
        matches =
          value.receipt.action === command.action &&
          (command.action === "create" ||
            value.receipt.stackId === command.stack_id);
      } catch {
        /* Nested invalid bodies are validation failures, never exceptions. */
      }
      if (!matches)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Routine receipt does not match request",
        });
    }
  });
export type RoutineRecoveryReview = z.infer<typeof routineRecoveryReview>;
