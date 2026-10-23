import { recordTimelineFactInTx } from "@/lib/review-inbox/timeline-fact";
import { scheduleReviewWritingEnabled } from "./schedule-owner";
import type { PrismaClient } from "@prisma/client";
import { hashIdempotentRequest, type EffectResult } from "@/lib/idempotency";
import {
  ScheduleReviewError,
  scheduleMoveCommand,
  SCHEDULE_REVIEW_PROTOCOL,
} from "./conflict-review";
import {
  SCHEDULE_ACTION,
  scheduleReceipt,
  scheduleReceiptMatches,
} from "./schedule-http";
import {
  openScheduleActorInTx,
  prepareScheduleInTx,
  requireScheduleOwner,
  requireScheduleMove,
  scopeForScheduleCommand,
  type ScheduleActor,
} from "./schedule-runtime";
import { applyComparedScheduleMoveInTx } from "./schedule-source";
/** Target time effect + minimal receipt are one transaction. Completed-key
 * takeover/replay never reapplies a calendar effect or returns a private DTO. */
export async function writeScheduleMove(
  db: PrismaClient,
  actor: ScheduleActor,
  raw: unknown,
  key: string,
  recordId: string,
  now = new Date(),
): Promise<EffectResult> {
  const command = scheduleMoveCommand.parse(raw);
  requireScheduleOwner(command, actor);
  return db.$transaction(async (tx) => {
    const current = await openScheduleActorInTx(tx, actor);
    const where = {
      id: recordId,
      scope: `user:${actor.userId}`,
      user_id: actor.userId,
      family_id: actor.familyId,
      key,
      action: SCHEDULE_ACTION,
      request_hash: hashIdempotentRequest(SCHEDULE_ACTION, command),
    };
    const peek = await tx.idempotencyRecord.findFirst({
      where,
      select: { response_status: true, response_body: true },
    });
    if (!peek) throw new ScheduleReviewError("STALE");
    if (peek.response_status !== null) {
      if (
        peek.response_status !== 200 ||
        !scheduleReceiptMatches(peek.response_body, command, key)
      )
        throw new ScheduleReviewError("UNSUPPORTED");
      return { status: 200, body: scheduleReceipt.parse(peek.response_body) };
    }
    if (!scheduleReviewWritingEnabled())
      throw new ScheduleReviewError("FORBIDDEN");
    if (current.role !== "parent") throw new ScheduleReviewError("FORBIDDEN");
    const prepared = await prepareScheduleInTx(
      tx,
      actor,
      current,
      scopeForScheduleCommand(command),
      now,
    );
    requireScheduleMove(prepared.snapshot, command, now);
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
    const record = await tx.idempotencyRecord.findFirst({
      where,
      select: { response_status: true, response_body: true },
    });
    if (!record) throw new ScheduleReviewError("STALE");
    if (record.response_status !== null) {
      if (
        record.response_status !== 200 ||
        !scheduleReceiptMatches(record.response_body, command, key)
      )
        throw new ScheduleReviewError("UNSUPPORTED");
      return { status: 200, body: scheduleReceipt.parse(record.response_body) };
    }
    await applyComparedScheduleMoveInTx(tx, {
      familyId: actor.familyId,
      targetId: command.target.id,
      range: command.range,
      compared: prepared.compared,
      sourceStatuses: prepared.sourceStatuses,
      start: command.start,
      end: command.end,
    });
    await recordTimelineFactInTx(
      tx,
      actor,
      "schedule_changed",
      { kind: "event", id: command.target.id },
      now,
    );
    const body = scheduleReceipt.parse({
      receipt: {
        protocol: SCHEDULE_REVIEW_PROTOCOL,
        userId: actor.userId,
        familyId: actor.familyId,
        targetId: command.target.id,
        requestKey: key,
        action: command.action,
        sourceToken: command.target.sourceToken,
        snapshotToken: command.snapshotToken,
        start: command.start,
        end: command.end,
      },
    });
    await tx.idempotencyRecord.update({
      where: { id: recordId },
      data: { response_status: 200, response_body: body },
    });
    return { status: 200, body };
  });
}
export function scheduleFailure(error: unknown): EffectResult {
  const code =
    error instanceof ScheduleReviewError ? error.code : "UNAVAILABLE";
  return {
    status:
      code === "UNAUTHORIZED"
        ? 401
        : code === "FORBIDDEN"
          ? 403
          : code === "MISSING"
            ? 404
            : ["STALE", "EXPIRED"].includes(code)
              ? 409
              : ["INVALID", "INVALID_WINDOW"].includes(code)
                ? 400
                : 503,
    body: {
      error: {
        code: `SCHEDULE_REVIEW_${code}`,
        message:
          "Keep the saved request and check its current state before continuing.",
      },
    },
  };
}
