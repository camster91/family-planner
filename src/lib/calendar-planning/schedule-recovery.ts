import { z } from "zod";
import { queueOwnerClassicSchema as queueOwnerSchema } from "@/lib/queue-owner-classic";
import { scheduleMoveCommand } from "./conflict-review";
import { scheduleReceipt, scheduleReceiptMatches } from "./schedule-http";
export const SCHEDULE_RECOVERY = "herewoven.schedule-recovery.v1";
export const SCHEDULE_OWNER_HEADER = "X-Herewoven-Schedule-Owner";
export const scheduleRecoveryContext = z
  .object({
    contract: z.literal(SCHEDULE_RECOVERY),
    enabled: z.boolean(),
    owner: queueOwnerSchema
      .refine((owner) => owner.kind === "person")
      .nullable(),
    userId: z.string().min(1).max(128),
    familyId: z.string().min(1).max(128),
    role: z.enum(["parent", "teen", "child"]),
  })
  .strict()
  .refine(
    (value) =>
      (!value.enabled || value.owner !== null) &&
      (!value.owner || value.owner.ownerId === value.userId),
  );
export type ScheduleRecoveryContext = z.infer<typeof scheduleRecoveryContext>;
export const scheduleRecoveryEntry = z
  .object({
    kind: z.literal("schedule-move"),
    key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    body: z.string().min(1).max(32768),
  })
  .strict()
  .refine((entry) => {
    try {
      return (
        new TextEncoder().encode(entry.body).byteLength <= 32768 &&
        scheduleMoveCommand.safeParse(JSON.parse(entry.body)).success
      );
    } catch {
      return false;
    }
  });
export type ScheduleRecoveryEntry = z.infer<typeof scheduleRecoveryEntry>;
export const scheduleRecoveryJournal = z
  .object({
    contract: z.literal(SCHEDULE_RECOVERY),
    entries: z.array(scheduleRecoveryEntry).max(4),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.entries.map((entry) => entry.key)).size ===
      value.entries.length,
  );
export function scheduleEntryMatchesContext(
  entry: ScheduleRecoveryEntry,
  context: ScheduleRecoveryContext,
) {
  const command = scheduleMoveCommand.parse(JSON.parse(entry.body));
  return (
    command.owner.userId === context.userId &&
    command.owner.familyId === context.familyId
  );
}
export const scheduleRecoveryInput = z
  .object({
    contract: z.literal(SCHEDULE_RECOVERY),
    entry: scheduleRecoveryEntry,
  })
  .strict();
export const scheduleRecoveryReview = z
  .object({
    contract: z.literal(SCHEDULE_RECOVERY),
    ownerScope: z.string().regex(/^[a-f0-9]{64}$/),
    entry: scheduleRecoveryEntry,
    state: z.enum([
      "ready",
      "pending",
      "committed",
      "expired",
      "conflict",
      "paused",
      "unavailable",
    ]),
    canRetry: z.boolean(),
    currentSnapshotToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    receipt: scheduleReceipt.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    let command: ReturnType<typeof scheduleMoveCommand.parse>;
    try {
      command = scheduleMoveCommand.parse(JSON.parse(value.entry.body));
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid saved schedule request",
      });
      return;
    }
    if (
      value.canRetry !== ["ready", "pending"].includes(value.state) ||
      (value.state === "committed") !== (value.receipt !== null) ||
      (value.canRetry &&
        value.currentSnapshotToken !== command.snapshotToken) ||
      (value.receipt &&
        !scheduleReceiptMatches(value.receipt, command, value.entry.key))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inconsistent schedule recovery proof",
      });
  });
