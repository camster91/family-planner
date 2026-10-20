/** Explicit foreground I/O. No mount/focus/background retries or implicit writes. */
import { requestOwnedJson as request } from "@/lib/owned-request-http";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import {
  scheduleReviewScope,
  scheduleMoveCommand,
  previewScheduleMove,
  planScheduleReview,
  type ScheduleReviewScope,
  type ScheduleReviewQuery,
} from "./conflict-review";
import {
  scheduleReadReply,
  scheduleReceipt,
  scheduleReceiptMatches,
} from "./schedule-http";
import {
  SCHEDULE_RECOVERY,
  SCHEDULE_OWNER_HEADER,
  scheduleRecoveryContext,
  scheduleRecoveryEntry,
  scheduleRecoveryReview,
  type ScheduleRecoveryContext,
  type ScheduleRecoveryEntry,
} from "./schedule-recovery";
export async function readScheduleContext() {
  const result = await request(
    "/api/coordination/schedule-review/recovery",
    {},
    16384,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Schedule recovery unavailable");
  return scheduleRecoveryContext.parse(result.body);
}
function validateRead(value: unknown, context: ScheduleRecoveryContext) {
  const reply = scheduleReadReply.parse(value);
  if (
    reply.snapshot.owner.userId !== context.userId ||
    reply.snapshot.owner.familyId !== context.familyId ||
    reply.snapshot.role !== context.role
  )
    throw new Error("Schedule owner changed");
  return reply;
}
export async function readScheduleSnapshot(
  scope: ScheduleReviewScope,
  context: ScheduleRecoveryContext,
) {
  scheduleReviewScope.parse(scope);
  const result = await request(
    `/api/coordination/schedule-review?${new URLSearchParams({ targetId: scope.targetId, start: scope.range.start, end: scope.range.end, timeZone: scope.timeZone })}`,
    {},
    2 * 1024 * 1024,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Schedule unavailable");
  const reply = validateRead(result.body, context);
  if (
    reply.snapshot.timeZone !== scope.timeZone ||
    Date.parse(reply.snapshot.range.start) !== Date.parse(scope.range.start) ||
    Date.parse(reply.snapshot.range.end) !== Date.parse(scope.range.end) ||
    !reply.snapshot.events.some((event) => event.id === scope.targetId)
  )
    throw new Error("Schedule scope changed");
  return reply;
}
export async function readSchedulePreview(
  query: ScheduleReviewQuery,
  context: ScheduleRecoveryContext,
) {
  const result = await request(
    "/api/coordination/schedule-review/preview",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    },
    2 * 1024 * 1024,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Schedule preview unavailable");
  const reply = validateRead(result.body, context);
  return {
    ...reply,
    plan: planScheduleReview(
      reply.snapshot,
      query,
      new Date(reply.evaluatedAt),
    ),
  };
}
export function makeScheduleIntent(
  reply: ReturnType<typeof scheduleReadReply.parse>,
  query: ScheduleReviewQuery,
  choice: { start: string; end: string },
  context: ScheduleRecoveryContext,
  key = newIdempotencyKey(),
): ScheduleRecoveryEntry {
  validateRead(reply, context);
  if (!context.enabled || context.role !== "parent")
    throw new Error("Schedule changes paused");
  const command = previewScheduleMove(
    reply.snapshot,
    query,
    choice,
    new Date(reply.evaluatedAt),
  );
  return scheduleRecoveryEntry.parse({
    kind: "schedule-move",
    key,
    body: JSON.stringify(command),
  });
}
export async function inspectSchedule(
  entry: ScheduleRecoveryEntry,
  context: ScheduleRecoveryContext,
) {
  if (!context.owner) throw new Error("Schedule owner changed");
  const result = await request(
    "/api/coordination/schedule-review/recovery",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SCHEDULE_OWNER_HEADER]: context.owner.scope,
      },
      body: JSON.stringify({ contract: SCHEDULE_RECOVERY, entry }),
    },
    65536,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Schedule recovery unavailable");
  const value = scheduleRecoveryReview.parse(result.body);
  if (
    value.ownerScope !== context.owner.scope ||
    value.entry.key !== entry.key ||
    value.entry.body !== entry.body
  )
    throw new Error("Schedule owner changed");
  return value;
}
export async function sendSchedule(
  entry: ScheduleRecoveryEntry,
  ownerScope: string,
) {
  scheduleRecoveryEntry.parse(entry);
  const command = scheduleMoveCommand.parse(JSON.parse(entry.body));
  const result = await request(
    "/api/coordination/schedule-review",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": entry.key,
        [SCHEDULE_OWNER_HEADER]: ownerScope,
      },
      body: entry.body,
    },
    16384,
  );
  if (result.kind !== "reply") return { kind: "unknown" as const };
  if (!result.response.ok)
    return {
      kind:
        result.response.status >= 500 || result.response.status === 409
          ? ("unknown" as const)
          : ("refused" as const),
    };
  return scheduleReceiptMatches(result.body, command, entry.key)
    ? {
        kind: "confirmed" as const,
        receipt: scheduleReceipt.parse(result.body),
      }
    : { kind: "unknown" as const };
}
