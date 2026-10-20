import type { Prisma, PrismaClient } from "@prisma/client";
import { hashIdempotentRequest, type EffectResult } from "@/lib/idempotency";
import {
  responsibilityCommand,
  ResponsibilityError,
  planResponsibility,
  RESPONSIBILITY_PROTOCOL,
} from "@/lib/responsibility";
import {
  responsibilityReceipt,
  responsibilityReceiptMatches,
  RESPONSIBILITY_ACTION,
} from "@/lib/responsibility-http-contract";
import {
  openResponsibilityActorInTx,
  renewResponsibilityReceiptActorInTx,
  prepareResponsibilityInTx,
  type ResponsibilityActor,
} from "@/lib/responsibility-runtime";
import { persistResponsibilityStateInTx } from "@/lib/responsibility-state-store";
export async function authorizeResponsibilityReceipt(
  db: PrismaClient,
  actor: ResponsibilityActor,
) {
  await db.$transaction(async (tx) => {
    await openResponsibilityActorInTx(tx, actor);
    await renewResponsibilityReceiptActorInTx(tx, actor);
  });
}
/** No effect escapes its atomic minimal receipt, including an abandoned-key takeover. */
export async function writeResponsibility(
  db: PrismaClient,
  actor: ResponsibilityActor,
  raw: unknown,
  key: string,
  recordId: string,
  now = new Date(),
): Promise<EffectResult> {
  const command = responsibilityCommand.parse(raw);
  if (command.userId !== actor.userId || command.familyId !== actor.familyId)
    throw new ResponsibilityError("FORBIDDEN");
  return db.$transaction(async (tx) => {
    await openResponsibilityActorInTx(tx, actor);
    const where = {
      id: recordId,
      scope: `user:${actor.userId}`,
      user_id: actor.userId,
      family_id: actor.familyId,
      action: RESPONSIBILITY_ACTION,
      key,
      request_hash: hashIdempotentRequest(RESPONSIBILITY_ACTION, command),
    };
    const peek = await tx.idempotencyRecord.findFirst({
      where,
      select: { response_status: true, response_body: true },
    });
    if (!peek) throw new ResponsibilityError("CONFLICT");
    if (peek.response_status != null) {
      await renewResponsibilityReceiptActorInTx(tx, actor);
      if (
        peek.response_status !== 200 ||
        !responsibilityReceiptMatches(peek.response_body, command, key)
      )
        throw new ResponsibilityError("UNSUPPORTED");
      return {
        status: 200,
        body: responsibilityReceipt.parse(peek.response_body),
      };
    }
    // Identity rows precede target/root/state and receipt locks, matching identity
    // retirement triggers. The live target is never replaced with cached DTO data.
    const opened = await prepareResponsibilityInTx(
      tx,
      actor,
      command.target,
      command,
      now,
    );
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
    const record = await tx.idempotencyRecord.findFirst({
      where,
      select: { response_status: true, response_body: true },
    });
    if (!record) throw new ResponsibilityError("CONFLICT");
    if (record.response_status != null) {
      if (
        record.response_status !== 200 ||
        !responsibilityReceiptMatches(record.response_body, command, key)
      )
        throw new ResponsibilityError("UNSUPPORTED");
      return {
        status: 200,
        body: responsibilityReceipt.parse(record.response_body),
      };
    }
    const planned = planResponsibility(
      opened.current?.state ?? null,
      command,
      opened.context,
      now,
    );
    if (planned.changed)
      await persistResponsibilityStateInTx(
        tx,
        planned.state,
        command.expectedRevision,
        opened.current?.id ?? null,
      );
    const body = responsibilityReceipt.parse({
      receipt: {
        protocol: RESPONSIBILITY_PROTOCOL,
        userId: actor.userId,
        familyId: actor.familyId,
        target: command.target,
        requestKey: key,
        action: command.action,
        sourceToken: command.sourceToken,
        revision: planned.state.revision,
      },
    });
    await tx.idempotencyRecord.update({
      where: { id: recordId },
      data: {
        response_status: 200,
        response_body: body as Prisma.InputJsonObject,
      },
    });
    return { status: 200, body };
  });
}
/** Canonical permission errors have no names/target details; unknown outcomes must retain the request. */
export function responsibilityFailure(error: unknown): EffectResult {
  const code =
    error instanceof ResponsibilityError ? error.code : "UNAVAILABLE";
  return {
    status:
      code === "UNAUTHORIZED"
        ? 401
        : code === "FORBIDDEN"
          ? 403
          : code === "NOT_FOUND"
            ? 404
            : [
                  "CONFLICT",
                  "DUPLICATE_SUBJECT",
                  "NO_OWNER",
                  "SUBJECT_UNAVAILABLE",
                ].includes(code)
              ? 409
              : 503,
    body: {
      error: {
        code: `RESPONSIBILITY_${code}`,
        message:
          "Keep the saved request and review its current state before continuing.",
      },
    },
  };
}
