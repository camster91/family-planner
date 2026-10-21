/** Content-minimal success proof, distinct from fresh current task/event state. */
import { z } from "zod";
import { hashIdempotentRequest } from "@/lib/idempotency";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
import {
  EVENT_PREPARATION_PROTOCOL,
  type PreparationCommand,
} from "./contract";
export const PREPARATION_ACTION = "event.preparation.v1";
const token = z.string().regex(/^[a-f0-9]{64}$/);
export const preparationReceipt = z
  .object({
    receipt: z
      .object({
        protocol: z.literal(EVENT_PREPARATION_PROTOCOL),
        userId: id,
        familyId: id,
        eventId: id,
        action: z.enum(["set-plan", "reuse-routine"]),
        requestKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
        requestHash: token,
        sourceToken: token,
        expectedToken: token,
        planId: id.nullable(),
        created: z
          .array(z.object({ clientId: id, choreId: id }).strict())
          .max(99),
      })
      .strict(),
  })
  .strict();
export function preparationReceiptMatches(
  raw: unknown,
  command: PreparationCommand,
  key: string,
) {
  const parsed = preparationReceipt.safeParse(raw);
  if (!parsed.success) return false;
  const proof = parsed.data.receipt;
  const expected =
    command.action === "reuse-routine"
      ? command.steps.map((step) => step.clientId)
      : command.steps.flatMap((step) =>
          step.kind === "new" ? [step.clientId] : [],
        );
  return (
    proof.userId === command.owner.userId &&
    proof.familyId === command.owner.familyId &&
    proof.eventId === command.eventId &&
    proof.action === command.action &&
    proof.requestKey === key &&
    proof.requestHash === hashIdempotentRequest(PREPARATION_ACTION, command) &&
    proof.sourceToken === command.eventSourceToken &&
    proof.expectedToken === command.expectedToken &&
    proof.created.length === expected.length &&
    new Set(proof.created.map((row) => row.clientId)).size ===
      expected.length &&
    new Set(proof.created.map((row) => row.choreId)).size === expected.length &&
    proof.created.every((row) => expected.includes(row.clientId))
  );
}
