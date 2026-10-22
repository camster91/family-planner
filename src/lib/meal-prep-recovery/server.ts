/** Canonical bulk adapters plus receipt-first, foreground-only recovery. */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  authorizeMealBatchInTx,
  persistMealPrepInTx,
  batchFailure,
} from "../meal-batch-api";
import {
  hashIdempotentRequest,
  IDEMPOTENCY_LOCK_TIMEOUT_MS,
  IDEMPOTENCY_MAX_BODY_CHARS,
  type EffectResult,
} from "../idempotency";
import { prepRecoveryEnabled } from "./owner";
import {
  PREP_RECOVERY,
  PREP_INTENT_MS,
  prepCommand,
  prepAction,
  prepStatus,
  prepReceipt,
  prepReceiptMatches,
  prepRecoveryReply,
  type PrepCommand,
  type PrepEntry,
  type PrepRecoveryReply,
} from "./contract";
export type PrepActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};
export class PrepRecoveryRefused extends Error {
  constructor(public result: EffectResult) {
    super("Bulk recovery refused");
  }
}
function refuse(status: number, code: string): never {
  throw new PrepRecoveryRefused(batchFailure(status, code));
}
export async function authorizePrepRecovery(
  tx: Prisma.TransactionClient,
  actor: PrepActor,
  command?: PrepCommand,
) {
  const refusal = await authorizeMealBatchInTx(tx, {
    userId: actor.userId,
    familyId: actor.familyId,
    tokenVersion: actor.generation,
  });
  if (refusal) throw new PrepRecoveryRefused(refusal);
  const current = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { role: true },
  });
  if (
    !current ||
    current.role !== actor.role ||
    !["parent", "teen"].includes(actor.role)
  )
    refuse(403, "AUTH_CONTEXT_CHANGED");
  if (
    command &&
    (command.generation !== actor.generation ||
      command.role !== actor.role ||
      command.input.expected_user_id !== actor.userId ||
      command.input.expected_family_id !== actor.familyId)
  )
    refuse(403, "AUTH_CONTEXT_CHANGED");
}
function leaseCurrent(command: PrepCommand, now = Date.now()) {
  const issued = Date.parse(command.issuedAt);
  if (issued > now + 1000 || now >= issued + PREP_INTENT_MS)
    refuse(409, "INTENT_EXPIRED");
}
function validReceipt(result: EffectResult, command: PrepCommand) {
  return (
    result.status === prepStatus(command) &&
    prepReceiptMatches(result.body, command) &&
    JSON.stringify(result.body).length <= IDEMPOTENCY_MAX_BODY_CHARS
  );
}
export function ownedPrepReplay(
  result: EffectResult,
  command: PrepCommand,
): EffectResult {
  return validReceipt(result, command)
    ? { status: result.status, body: prepReceipt.parse(result.body) }
    : batchFailure(409, "RECEIPT_UNAVAILABLE");
}
export function persistOwnedPrep(
  db: Pick<PrismaClient, "$transaction">,
  actor: PrepActor,
  raw: PrepCommand,
  recordId: string,
): Promise<EffectResult> {
  const command = prepCommand.parse(raw);
  return db.$transaction(
    async (tx) => {
      await authorizePrepRecovery(tx, actor, command);
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id"=${recordId} FOR UPDATE`;
      const root = await tx.idempotencyRecord.findFirst({
        where: {
          id: recordId,
          scope: `user:${actor.userId}`,
          user_id: actor.userId,
          family_id: actor.familyId,
          action: prepAction(command),
          request_hash: hashIdempotentRequest(prepAction(command), command),
        },
        select: {
          response_status: true,
          response_body: true,
          expires_at: true,
        },
      });
      if (!root) refuse(409, "IDEMPOTENCY_IN_PROGRESS");
      if (root.response_status !== null) {
        const replay = {
          status: root.response_status,
          body: root.response_body,
        };
        if (!validReceipt(replay, command)) refuse(409, "RECEIPT_UNAVAILABLE");
        return ownedPrepReplay(replay, command);
      }
      if (root.expires_at.getTime() <= Date.now())
        refuse(409, "INTENT_EXPIRED");
      if (!prepRecoveryEnabled()) refuse(409, "RECOVERY_PAUSED");
      leaseCurrent(command);
      const result = await persistMealPrepInTx(
        tx,
        {
          userId: actor.userId,
          familyId: actor.familyId,
          tokenVersion: actor.generation,
        },
        command.input,
        recordId,
      );
      // A canonical refusal after any intermediate write must roll back with it.
      if (result.status < 200 || result.status >= 300)
        throw new PrepRecoveryRefused(result);
      if (!validReceipt(result, command)) refuse(409, "SAVE_UNCONFIRMED");
      if (!prepRecoveryEnabled()) refuse(409, "RECOVERY_PAUSED");
      leaseCurrent(command);
      return ownedPrepReplay(result, command);
    },
    { isolationLevel: "Serializable", timeout: 15000 },
  );
}
export function inspectOwnedPrep(
  db: Pick<PrismaClient, "$transaction">,
  actor: PrepActor,
  entry: PrepEntry,
  ownerScope: string,
  now = new Date(),
) {
  const command = prepCommand.parse(JSON.parse(entry.body));
  return db.$transaction(
    async (tx) => {
      await authorizePrepRecovery(tx, actor, command);
      const requestHash = hashIdempotentRequest(prepAction(command), command);
      const reply = (
        state: PrepRecoveryReply["state"],
        receipt: unknown = null,
      ) =>
        prepRecoveryReply.parse({
          contract: PREP_RECOVERY,
          ownerScope,
          entry,
          requestHash,
          state,
          canRetry: state === "ready",
          retryUntil:
            state === "ready"
              ? new Date(
                  Date.parse(command.issuedAt) + PREP_INTENT_MS,
                ).toISOString()
              : null,
          receipt,
        });
      const record = await tx.idempotencyRecord.findFirst({
        where: { scope: `user:${actor.userId}`, key: entry.key },
        select: {
          user_id: true,
          family_id: true,
          action: true,
          request_hash: true,
          response_status: true,
          response_body: true,
          created_at: true,
          expires_at: true,
        },
      });
      if (
        record &&
        (record.user_id !== actor.userId ||
          record.family_id !== actor.familyId ||
          record.action !== prepAction(command) ||
          record.request_hash !== requestHash)
      )
        return reply("conflict");
      if (record && record.response_status !== null) {
        const result = {
          status: record.response_status,
          body: record.response_body,
        };
        return validReceipt(result, command)
          ? reply("committed", prepReceipt.parse(record.response_body))
          : reply("unavailable");
      }
      if (
        +now >= Date.parse(command.issuedAt) + PREP_INTENT_MS ||
        (record && record.expires_at <= now)
      )
        return reply("expired");
      if (+now < Date.parse(command.issuedAt) - 1000)
        return reply("unavailable");
      if (!prepRecoveryEnabled()) return reply("paused");
      if (record && +record.created_at > +now - IDEMPOTENCY_LOCK_TIMEOUT_MS)
        return reply("pending");
      return reply("ready");
    },
    { isolationLevel: "RepeatableRead", timeout: 15000 },
  );
}
