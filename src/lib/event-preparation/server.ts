/** Owned claim -> current authority/source -> canonical effect + proof in one
 * transaction. Complete receipts replay without target reads or another clone. */
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { hashIdempotentRequest, type EffectResult } from "@/lib/idempotency";
import {
  preparationCommand,
  EventPreparationError,
  EVENT_PREPARATION_PROTOCOL,
} from "./contract";
import {
  PREPARATION_ACTION,
  preparationReceipt,
  preparationReceiptMatches,
} from "./http";
import {
  openPreparationActorInTx,
  prepareEventPreparationInTx,
  type PreparationActor,
} from "./runtime";
import { scopeForPreparationCommand } from "./read-contract";
import { eventPreparationWritingEnabled } from "./owner";
import { applyPreparationInTx } from "./mutation";
export async function writeEventPreparation(
  db: PrismaClient,
  actor: PreparationActor,
  raw: unknown,
  key: string,
  recordId: string,
  now = new Date(),
): Promise<EffectResult> {
  const command = preparationCommand.parse(raw);
  z.string()
    .regex(/^[A-Za-z0-9_-]{16,128}$/)
    .parse(key);
  if (
    command.owner.userId !== actor.userId ||
    command.owner.familyId !== actor.familyId
  )
    throw new EventPreparationError("FORBIDDEN");
  return db.$transaction(async (tx) => {
    await openPreparationActorInTx(tx, actor);
    // Receipt-only replay renews actor membership/token under a row lock even
    // when source/event/schema readiness no longer exists after pause/deletion.
    const users = await tx.$queryRaw<
      Array<{ id: string; role: string; token_version: number }>
    >`SELECT "id", "role", "token_version" FROM "User" WHERE "id"=${actor.userId} AND "family_id"=${actor.familyId} FOR SHARE`;
    if (!users[0] || users[0].token_version !== actor.tokenVersion)
      throw new EventPreparationError("UNAUTHORIZED");
    if (users[0].role !== "parent")
      throw new EventPreparationError("FORBIDDEN");
    const where = {
      id: recordId,
      scope: `user:${actor.userId}`,
      user_id: actor.userId,
      family_id: actor.familyId,
      key,
      action: PREPARATION_ACTION,
      request_hash: hashIdempotentRequest(PREPARATION_ACTION, command),
    };
    const peek = await tx.idempotencyRecord.findFirst({
      where,
      select: { response_status: true, response_body: true },
    });
    if (!peek) throw new EventPreparationError("STALE");
    if (peek.response_status !== null) {
      if (
        peek.response_status !== 200 ||
        !preparationReceiptMatches(peek.response_body, command, key)
      )
        throw new EventPreparationError("UNSUPPORTED");
      return {
        status: 200,
        body: preparationReceipt.parse(peek.response_body),
      };
    }
    if (!eventPreparationWritingEnabled())
      throw new EventPreparationError("UNAVAILABLE");
    const prepared = await prepareEventPreparationInTx(
      tx,
      actor,
      scopeForPreparationCommand(command),
    );
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id"=${recordId} FOR UPDATE`;
    const record = await tx.idempotencyRecord.findFirst({
      where,
      select: { response_status: true, response_body: true },
    });
    if (!record) throw new EventPreparationError("STALE");
    if (record.response_status !== null) {
      if (
        record.response_status !== 200 ||
        !preparationReceiptMatches(record.response_body, command, key)
      )
        throw new EventPreparationError("UNSUPPORTED");
      return {
        status: 200,
        body: preparationReceipt.parse(record.response_body),
      };
    }
    const effect = await applyPreparationInTx(
      tx,
      actor,
      prepared,
      command,
      now,
    );
    const body = preparationReceipt.parse({
      receipt: {
        protocol: EVENT_PREPARATION_PROTOCOL,
        userId: actor.userId,
        familyId: actor.familyId,
        eventId: command.eventId,
        action: command.action,
        requestKey: key,
        requestHash: hashIdempotentRequest(PREPARATION_ACTION, command),
        sourceToken: command.eventSourceToken,
        expectedToken: command.expectedToken,
        planId: effect.planId,
        created: effect.created,
      },
    });
    await tx.idempotencyRecord.update({
      where: { id: recordId },
      data: { response_status: 200, response_body: body },
    });
    return { status: 200, body };
  });
}
export function preparationFailure(error: unknown): EffectResult {
  const code =
    error instanceof EventPreparationError
      ? error.code
      : error instanceof z.ZodError
        ? "INVALID"
        : "UNAVAILABLE";
  return {
    status:
      code === "UNAUTHORIZED"
        ? 401
        : code === "FORBIDDEN"
          ? 403
          : code === "NOT_FOUND"
            ? 404
            : code === "INVALID"
              ? 400
              : ["UNAVAILABLE", "UNSUPPORTED"].includes(code)
                ? 503
                : 409,
    body: {
      error: {
        code: `EVENT_PREPARATION_${code}`,
        message:
          "Keep the saved request and review the current event and tasks before continuing.",
      },
    },
  };
}
