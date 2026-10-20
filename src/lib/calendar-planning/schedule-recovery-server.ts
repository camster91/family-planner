import type { PrismaClient } from "@prisma/client";
import { hashIdempotentRequest } from "@/lib/idempotency";
import {
  ScheduleReviewError,
  scheduleMoveCommand,
  requireScheduleIntentAge,
} from "./conflict-review";
import {
  scheduleReceipt,
  scheduleReceiptMatches,
  SCHEDULE_ACTION,
} from "./schedule-http";
import {
  openScheduleActorInTx,
  prepareScheduleInTx,
  requireScheduleMove,
  requireScheduleOwner,
  scopeForScheduleCommand,
  type ScheduleActor,
} from "./schedule-runtime";
import { scheduleReviewWritingEnabled } from "./schedule-owner";
import {
  SCHEDULE_RECOVERY,
  scheduleRecoveryReview,
  type ScheduleRecoveryEntry,
} from "./schedule-recovery";
export function reviewScheduleRequest(
  db: PrismaClient,
  actor: ScheduleActor,
  entry: ScheduleRecoveryEntry,
  ownerScope: string,
  now = new Date(),
) {
  const command = scheduleMoveCommand.parse(JSON.parse(entry.body));
  requireScheduleOwner(command, actor);
  return db.$transaction(async (tx) => {
    const current = await openScheduleActorInTx(tx, actor);
    const record = await tx.idempotencyRecord.findFirst({
      where: { scope: `user:${actor.userId}`, key: entry.key },
      select: {
        family_id: true,
        user_id: true,
        action: true,
        request_hash: true,
        response_status: true,
        response_body: true,
      },
    });
    if (
      record &&
      (record.family_id !== actor.familyId ||
        record.user_id !== actor.userId ||
        record.action !== SCHEDULE_ACTION ||
        record.request_hash !== hashIdempotentRequest(SCHEDULE_ACTION, command))
    )
      throw new ScheduleReviewError("STALE");
    type State =
      | "ready"
      | "pending"
      | "committed"
      | "expired"
      | "conflict"
      | "paused"
      | "unavailable";
    const reply = (
      state: State,
      currentSnapshotToken: string | null = null,
      receipt: unknown = null,
    ) =>
      scheduleRecoveryReview.parse({
        contract: SCHEDULE_RECOVERY,
        ownerScope,
        entry,
        state,
        canRetry: ["ready", "pending"].includes(state),
        currentSnapshotToken,
        receipt,
      });
    if (record && record.response_status !== null)
      return record.response_status === 200 &&
        scheduleReceiptMatches(record.response_body, command, entry.key)
        ? reply("committed", null, scheduleReceipt.parse(record.response_body))
        : reply("unavailable");
    try {
      requireScheduleIntentAge(command, now);
    } catch (error) {
      if (error instanceof ScheduleReviewError && error.code === "EXPIRED")
        return reply("expired");
      throw error;
    }
    if (!scheduleReviewWritingEnabled()) return reply("paused");
    if (current.role !== "parent") return reply("conflict");
    try {
      const prepared = await prepareScheduleInTx(
        tx,
        actor,
        current,
        scopeForScheduleCommand(command),
        now,
      );
      requireScheduleMove(prepared.snapshot, command, now);
      return reply(
        record ? "pending" : "ready",
        prepared.snapshot.snapshotToken,
      );
    } catch (error) {
      if (error instanceof ScheduleReviewError) {
        if (
          ["STALE", "MISSING", "FORBIDDEN", "INVALID_WINDOW"].includes(
            error.code,
          )
        )
          return reply("conflict");
        if (["UNAVAILABLE", "UNSUPPORTED"].includes(error.code))
          return reply("unavailable");
      }
      throw error;
    }
  });
}
