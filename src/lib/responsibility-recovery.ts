import { z } from "zod";
import { queueOwnerClassicSchema as queueOwnerSchema } from "@/lib/queue-owner-classic";
import { responsibilityCommand } from "@/lib/responsibility";
import {
  responsibilityReceipt,
  responsibilityReceiptMatches,
} from "@/lib/responsibility-http-contract";
export const RESPONSIBILITY_RECOVERY = "herewoven.responsibility-recovery.v1";
export const RESPONSIBILITY_OWNER_HEADER = "X-Herewoven-Responsibility-Owner";
export const responsibilityRecoveryContext = z
  .object({
    contract: z.literal(RESPONSIBILITY_RECOVERY),
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
export type ResponsibilityRecoveryContext = z.infer<
  typeof responsibilityRecoveryContext
>;
export const responsibilityRecoveryEntry = z
  .object({
    kind: z.literal("responsibility"),
    key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    body: z.string().min(1).max(4000),
  })
  .strict()
  .refine((entry) => {
    try {
      return (
        new TextEncoder().encode(entry.body).byteLength <= 4000 &&
        responsibilityCommand.safeParse(JSON.parse(entry.body)).success
      );
    } catch {
      return false;
    }
  });
export type ResponsibilityRecoveryEntry = z.infer<
  typeof responsibilityRecoveryEntry
>;
export const responsibilityRecoveryJournal = z
  .object({
    contract: z.literal(RESPONSIBILITY_RECOVERY),
    entries: z.array(responsibilityRecoveryEntry).max(10),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.entries.map((e) => e.key)).size === value.entries.length,
  );
export function responsibilityEntryMatchesContext(
  entry: ResponsibilityRecoveryEntry,
  context: ResponsibilityRecoveryContext,
) {
  const command = responsibilityCommand.parse(JSON.parse(entry.body));
  return (
    command.userId === context.userId && command.familyId === context.familyId
  );
}
export const responsibilityRecoveryInput = z
  .object({
    contract: z.literal(RESPONSIBILITY_RECOVERY),
    entry: responsibilityRecoveryEntry,
  })
  .strict();
export const responsibilityRecoveryReview = z
  .object({
    contract: z.literal(RESPONSIBILITY_RECOVERY),
    ownerScope: z.string().regex(/^[a-f0-9]{64}$/),
    entry: responsibilityRecoveryEntry,
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
    currentRevision: z.number().int().nonnegative().nullable(),
    receipt: responsibilityReceipt.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    let command: ReturnType<typeof responsibilityCommand.parse>;
    try {
      command = responsibilityCommand.parse(JSON.parse(value.entry.body));
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid saved request",
      });
      return;
    }
    if (
      value.canRetry !== ["ready", "pending"].includes(value.state) ||
      (value.state === "committed") !== (value.receipt !== null) ||
      (value.canRetry && value.currentRevision === null) ||
      (value.receipt &&
        !responsibilityReceiptMatches(value.receipt, command, value.entry.key))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inconsistent responsibility receipt",
      });
  });
