/** Strict owner-bound exact intent envelope; no background send/retry. */
import { z } from "zod";
import { queueOwnerSchema } from "@/lib/queue-owner-contract";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
import { preparationCommand } from "./contract";
import { preparationReceipt, preparationReceiptMatches } from "./http";
export const PREPARATION_RECOVERY = "herewoven.event-preparation-recovery.v1";
export const PREPARATION_OWNER_HEADER = "X-Event-Preparation-Owner";
export const PREPARATION_REQUEST_BYTES = 1024 * 1024;
export const PREPARATION_INSPECTION_BYTES =
  2 * PREPARATION_REQUEST_BYTES + 16384;
export const PREPARATION_JOURNAL_BYTES = 6 * PREPARATION_REQUEST_BYTES;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const preparationRecoveryContext = z
  .object({
    contract: z.literal(PREPARATION_RECOVERY),
    enabled: z.boolean(),
    owner: queueOwnerSchema
      .refine((owner) => owner.kind === "person")
      .nullable(),
    userId: id,
    familyId: id,
    role: z.literal("parent"),
  })
  .strict()
  .refine(
    (value) =>
      (!value.enabled || value.owner !== null) &&
      (!value.owner || value.owner.ownerId === value.userId),
  );
export type PreparationRecoveryContext = z.infer<
  typeof preparationRecoveryContext
>;
export const preparationRecoveryEntry = z
  .object({
    kind: z.literal("event-preparation"),
    key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    body: z.string().min(1).max(PREPARATION_REQUEST_BYTES),
    requestHash: hash,
  })
  .strict()
  .refine((entry) => {
    try {
      return (
        new TextEncoder().encode(entry.body).byteLength <=
          PREPARATION_REQUEST_BYTES &&
        preparationCommand.safeParse(JSON.parse(entry.body)).success
      );
    } catch {
      return false;
    }
  });
export type PreparationRecoveryEntry = z.infer<typeof preparationRecoveryEntry>;
export const preparationRecoveryJournal = z
  .object({
    contract: z.literal(PREPARATION_RECOVERY),
    entries: z.array(preparationRecoveryEntry).max(2),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.entries.map((entry) => entry.key)).size ===
      value.entries.length,
  );
export function preparationEntryMatchesContext(
  entry: PreparationRecoveryEntry,
  context: PreparationRecoveryContext,
) {
  const command = preparationCommand.parse(JSON.parse(entry.body));
  return (
    command.owner.userId === context.userId &&
    command.owner.familyId === context.familyId
  );
}
export const preparationRecoveryInput = z
  .object({
    contract: z.literal(PREPARATION_RECOVERY),
    entry: preparationRecoveryEntry,
  })
  .strict();
export const preparationRecoveryReview = z
  .object({
    contract: z.literal(PREPARATION_RECOVERY),
    ownerScope: hash,
    entry: preparationRecoveryEntry,
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
    currentToken: hash.nullable(),
    receipt: preparationReceipt.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    let command: ReturnType<typeof preparationCommand.parse>;
    try {
      command = preparationCommand.parse(JSON.parse(value.entry.body));
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid saved preparation request",
      });
      return;
    }
    if (
      value.canRetry !== ["ready", "pending"].includes(value.state) ||
      (value.state === "committed") !== (value.receipt !== null) ||
      (value.canRetry && value.currentToken !== command.expectedToken) ||
      (value.receipt &&
        !preparationReceiptMatches(
          value.receipt,
          command,
          value.entry.key,
          value.entry.requestHash,
        ))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inconsistent preparation recovery proof",
      });
  });
