/** Browser-safe exact canonical bulk request transport. Local drafts never send. */
import { z } from "zod";
import { createMealPrepSchema, mealPrepActionSchema } from "../meal-batches";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
import { queueOwnerSchema } from "../queue-owner-contract";
export const PREP_RECOVERY = "herewoven.meal-prep-recovery.v1";
export const PREP_OWNER_HEADER = "X-Herewoven-Prep-Owner";
export const PREP_INTENT_MS = 24 * 60 * 60 * 1000;
export const PREP_BODY_BYTES = 65536;
export const prepKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const identity = {
  protocol: z.literal(PREP_RECOVERY),
  generation: z.number().int().min(0),
  role: z.enum(["parent", "teen"]),
  issuedAt: z.string().datetime(),
};
export const prepCommand = z.discriminatedUnion("kind", [
  z
    .object({
      ...identity,
      kind: z.literal("create"),
      input: createMealPrepSchema,
    })
    .strict(),
  z
    .object({
      ...identity,
      kind: z.literal("action"),
      input: mealPrepActionSchema,
    })
    .strict(),
]);
export type PrepCommand = z.infer<typeof prepCommand>;
export const prepContext = z
  .object({
    contract: z.literal(PREP_RECOVERY),
    enabled: z.boolean(),
    userId: id,
    familyId: id,
    role: z.enum(["parent", "teen"]),
    owner: queueOwnerSchema
      .refine((owner) => owner.kind === "person")
      .nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (!value.enabled || value.owner !== null) &&
      (!value.owner || value.owner.ownerId === value.userId),
  );
export type PrepContext = z.infer<typeof prepContext>;
export const prepEntry = z
  .object({
    kind: z.literal("meal-prep"),
    key: prepKey,
    body: z.string().min(1).max(PREP_BODY_BYTES),
  })
  .strict()
  .refine((entry) => {
    try {
      return (
        new TextEncoder().encode(entry.body).byteLength <= PREP_BODY_BYTES &&
        prepCommand.safeParse(JSON.parse(entry.body)).success
      );
    } catch {
      return false;
    }
  });
export type PrepEntry = z.infer<typeof prepEntry>;
export const prepRecoveryInput = z
  .object({ contract: z.literal(PREP_RECOVERY), entry: prepEntry })
  .strict();
const ids = (limit: number) =>
  z
    .array(id)
    .max(limit)
    .refine((values) => new Set(values).size === values.length);
export const prepReceipt = z.union([
  z.object({ sessionId: id, batchIds: ids(8), mealIds: ids(112) }).strict(),
  z.object({ batchId: id, mealIds: ids(14) }).strict(),
  z.object({ sessionId: id }).strict(),
  z.object({ consumptionId: id }).strict(),
]);
export type PrepReceipt = z.infer<typeof prepReceipt>;
export function prepAction(command: PrepCommand) {
  return `meal-prep.${command.kind === "create" ? "create" : command.input.action}`;
}
export function prepStatus(command: PrepCommand) {
  return command.kind === "create" ||
    ["allocate", "eaten"].includes(command.input.action)
    ? 201
    : 200;
}
export function prepReceiptMatches(
  raw: unknown,
  command: PrepCommand,
): raw is PrepReceipt {
  const parsed = prepReceipt.safeParse(raw);
  if (!parsed.success) return false;
  const receipt = parsed.data;
  if (command.kind === "create")
    return (
      "batchIds" in receipt &&
      receipt.batchIds.length === command.input.dishes.length &&
      receipt.mealIds.length ===
        command.input.dishes.reduce((sum, dish) => sum + dish.meals.length, 0)
    );
  const input = command.input;
  if (input.action === "allocate")
    return (
      "batchId" in receipt &&
      receipt.batchId === input.batch_id &&
      receipt.mealIds.length === input.meals.length
    );
  if (input.action === "eaten") return "consumptionId" in receipt;
  if (input.action === "undo-eaten")
    return (
      "consumptionId" in receipt &&
      receipt.consumptionId === input.consumption_id
    );
  return (
    "sessionId" in receipt &&
    !("batchIds" in receipt) &&
    receipt.sessionId === input.session_id
  );
}
export function prepMatchesContext(entry: PrepEntry, context: PrepContext) {
  const command = prepCommand.parse(JSON.parse(entry.body));
  return (
    command.input.expected_user_id === context.userId &&
    command.input.expected_family_id === context.familyId &&
    command.role === context.role &&
    !!context.owner &&
    command.generation === context.owner.generation
  );
}
export const prepRecoveryReply = z
  .object({
    contract: z.literal(PREP_RECOVERY),
    ownerScope: z.string().regex(/^[a-f0-9]{64}$/),
    entry: prepEntry,
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum([
      "committed",
      "ready",
      "pending",
      "expired",
      "paused",
      "conflict",
      "unavailable",
    ]),
    canRetry: z.boolean(),
    retryUntil: z.string().datetime().nullable(),
    receipt: prepReceipt.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.canRetry === (value.state === "ready") &&
      (!value.retryUntil ||
        Date.parse(value.retryUntil) ===
          Date.parse(prepCommand.parse(JSON.parse(value.entry.body)).issuedAt) +
            PREP_INTENT_MS) &&
      (value.retryUntil !== null) === value.canRetry &&
      (value.receipt !== null) === (value.state === "committed") &&
      (!value.receipt ||
        prepReceiptMatches(
          value.receipt,
          prepCommand.parse(JSON.parse(value.entry.body)),
        )),
  );
export type PrepRecoveryReply = z.infer<typeof prepRecoveryReply>;
