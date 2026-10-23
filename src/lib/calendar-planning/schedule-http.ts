import { z } from "zod";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
import {
  SCHEDULE_REVIEW_PROTOCOL,
  scheduleReviewSnapshot,
  scheduleReviewInstant,
  type ScheduleMoveCommand,
} from "./conflict-review";
export const SCHEDULE_ACTION = "schedule.reschedule.v1";
export const scheduleReadReply = z
  .object({
    snapshot: scheduleReviewSnapshot,
    evaluatedAt: scheduleReviewInstant,
  })
  .strict();
export const scheduleReceipt = z
  .object({
    receipt: z
      .object({
        protocol: z.literal(SCHEDULE_REVIEW_PROTOCOL),
        userId: id,
        familyId: id,
        targetId: id,
        requestKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
        action: z.literal("reschedule"),
        sourceToken: z.string().regex(/^[a-f0-9]{64}$/),
        snapshotToken: z.string().regex(/^[a-f0-9]{64}$/),
        start: scheduleReviewInstant,
        end: scheduleReviewInstant,
      })
      .strict(),
  })
  .strict();
export function scheduleReceiptMatches(
  value: unknown,
  command: ScheduleMoveCommand,
  key: string,
) {
  const parsed = scheduleReceipt.safeParse(value);
  if (!parsed.success) return false;
  const receipt = parsed.data.receipt;
  return (
    receipt.userId === command.owner.userId &&
    receipt.familyId === command.owner.familyId &&
    receipt.targetId === command.target.id &&
    receipt.requestKey === key &&
    receipt.sourceToken === command.target.sourceToken &&
    receipt.snapshotToken === command.snapshotToken &&
    receipt.start === command.start &&
    receipt.end === command.end
  );
}
