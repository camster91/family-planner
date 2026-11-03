import { getD1Database, type D1Store } from "./database";
import {
  authorizeD1ScheduleActor,
  validatedD1ScheduleRead,
  captureD1ScheduleSource,
} from "./schedule-source";
import { hashIdempotentRequest } from "../idempotency-hash";
import {
  ScheduleReviewError,
  scheduleMoveCommand,
  requireScheduleIntentAge,
} from "../calendar-planning/conflict-review";
import {
  scheduleReceipt,
  scheduleReceiptMatches,
  SCHEDULE_ACTION,
} from "../calendar-planning/schedule-http";
import {
  requireScheduleMove,
  requireScheduleOwner,
  scopeForScheduleCommand,
  type ScheduleActor,
} from "../calendar-planning/schedule-runtime";
import { scheduleReviewWritingEnabled } from "../calendar-planning/schedule-owner";
import {
  SCHEDULE_RECOVERY,
  scheduleRecoveryReview,
  type ScheduleRecoveryEntry,
} from "../calendar-planning/schedule-recovery";
export async function reviewD1ScheduleRequest(
  actor: ScheduleActor,
  entry: ScheduleRecoveryEntry,
  ownerScope: string,
  database?: D1Store,
  now = new Date(),
) {
  const command = scheduleMoveCommand.parse(JSON.parse(entry.body));
  requireScheduleOwner(command, actor);
  const store = database ?? (await getD1Database());
  let source: Awaited<ReturnType<typeof captureD1ScheduleSource>> | undefined;
  return validatedD1ScheduleRead(
    async (tx) => {
      source = undefined;
      const current = await authorizeD1ScheduleActor(tx, actor);
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
          record.request_hash !==
            hashIdempotentRequest(SCHEDULE_ACTION, command))
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
      let storedBody: unknown = record?.response_body;
      if (typeof storedBody === "string") {
        try {
          storedBody = JSON.parse(storedBody);
        } catch {
          storedBody = null;
        }
      }
      if (record && record.response_status !== null)
        return record.response_status === 200 &&
          scheduleReceiptMatches(storedBody, command, entry.key)
          ? reply("committed", null, scheduleReceipt.parse(storedBody))
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
        const capture = await captureD1ScheduleSource(
          actor,
          scopeForScheduleCommand(command),
          store,
          now,
        );
        source = capture;
        const prepared = capture.prepared;
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
    },
    store,
    (target) => source?.checks(target) ?? [],
  );
}
