/** Private exact intents; no automatic replay, domain data or editable drafts. */
import { z } from "zod";
import { queueOwnerClassicSchema as queueOwnerSchema } from "@/lib/queue-owner-classic";
import { weeklyResetCommand, weeklyResetReceipt } from "@/lib/weekly-reset";
export const WEEKLY_RESET_RECOVERY = "herewoven.weekly-reset-recovery.v1";
export const WEEKLY_RESET_OWNER_HEADER = "X-Herewoven-Weekly-Reset-Owner";
export const weeklyResetRecoveryContext = z
  .object({
    contract: z.literal(WEEKLY_RESET_RECOVERY),
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
export type WeeklyResetRecoveryContext = z.infer<
  typeof weeklyResetRecoveryContext
>;
export const weeklyResetRecoveryEntry = z
  .object({
    kind: z.literal("weekly-reset"),
    key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    body: z.string().min(1).max(4000),
  })
  .strict()
  .refine((entry) => {
    try {
      return (
        new TextEncoder().encode(entry.body).byteLength <= 4000 &&
        weeklyResetCommand.safeParse(JSON.parse(entry.body)).success
      );
    } catch {
      return false;
    }
  });
export type WeeklyResetRecoveryEntry = z.infer<typeof weeklyResetRecoveryEntry>;
export const weeklyResetRecoveryJournal = z
  .object({
    contract: z.literal(WEEKLY_RESET_RECOVERY),
    entries: z.array(weeklyResetRecoveryEntry).max(1),
  })
  .strict();
export function weeklyResetEntryMatchesContext(
  entry: WeeklyResetRecoveryEntry,
  context: WeeklyResetRecoveryContext,
) {
  const command = weeklyResetCommand.parse(JSON.parse(entry.body));
  return (
    command.userId === context.userId && command.familyId === context.familyId
  );
}
export const weeklyResetRecoveryInput = z
  .object({
    contract: z.literal(WEEKLY_RESET_RECOVERY),
    entry: weeklyResetRecoveryEntry,
  })
  .strict();
export const weeklyResetRecoveryReview = z
  .object({
    contract: z.literal(WEEKLY_RESET_RECOVERY),
    ownerScope: z.string().regex(/^[a-f0-9]{64}$/),
    entry: weeklyResetRecoveryEntry,
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
    currentRevision: z.number().int().nonnegative(),
    receipt: weeklyResetReceipt.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    let command: ReturnType<typeof weeklyResetCommand.parse>;
    try {
      command = weeklyResetCommand.parse(JSON.parse(value.entry.body));
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid saved request",
      });
      return;
    }
    const proof = value.receipt?.receipt;
    if (
      value.canRetry !== ["ready", "pending"].includes(value.state) ||
      (value.state === "committed") !== (proof !== undefined) ||
      (proof &&
        (proof.userId !== command.userId ||
          proof.familyId !== command.familyId ||
          proof.weekStart !== command.weekStart ||
          proof.timeZone !== command.timeZone ||
          proof.action !== command.action))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inconsistent weekly review receipt",
      });
  });
