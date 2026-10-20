import type { PrismaClient } from "@prisma/client";
import { hashIdempotentRequest } from "@/lib/idempotency";
import {
  weeklyResetActorInTx,
  type WeeklyResetActor,
} from "@/lib/weekly-reset-server";
import {
  planWeeklyReset,
  weeklyResetCommand,
  weeklyResetRecord,
  weeklyResetReceipt,
  WeeklyResetError,
} from "@/lib/weekly-reset";
import {
  WEEKLY_RESET_RECOVERY,
  weeklyResetRecoveryReview,
  type WeeklyResetRecoveryEntry,
} from "@/lib/weekly-reset-recovery";
export function reviewWeeklyResetRequest(
  db: PrismaClient,
  actor: WeeklyResetActor,
  entry: WeeklyResetRecoveryEntry,
  ownerScope: string,
  enabled: boolean,
  now = new Date(),
) {
  const command = weeklyResetCommand.parse(JSON.parse(entry.body));
  return db.$transaction(async (tx) => {
    const { user, features } = await weeklyResetActorInTx(tx, actor);
    if (command.userId !== actor.userId || command.familyId !== actor.familyId)
      throw new WeeklyResetError("FORBIDDEN");
    const record = await tx.idempotencyRecord.findUnique({
      where: { scope_key: { scope: `user:${actor.userId}`, key: entry.key } },
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
        record.action !== "weekly-reset.progress.v1" ||
        record.request_hash !==
          hashIdempotentRequest("weekly-reset.progress.v1", command))
    )
      throw new WeeklyResetError("CONFLICT");
    const reply = (
      state:
        | "ready"
        | "pending"
        | "committed"
        | "expired"
        | "conflict"
        | "paused"
        | "unavailable",
      receipt: unknown = null,
    ) =>
      weeklyResetRecoveryReview.parse({
        contract: WEEKLY_RESET_RECOVERY,
        ownerScope,
        entry,
        state,
        canRetry: ["ready", "pending"].includes(state),
        currentRevision: user.revision,
        receipt,
      });
    if (record?.response_status != null) {
      const proof = weeklyResetReceipt.safeParse(record.response_body);
      if (!proof.success || record.response_status !== 200)
        return reply("unavailable");
      // The strict review DTO also binds the receipt to the exact original scope/action/actor.
      return reply("committed", proof.data);
    }
    const age = now.getTime() - Date.parse(command.issuedAt);
    if (age > 15 * 60_000 || age < -60_000) return reply("expired");
    if (user.revision !== command.expectedRevision) return reply("conflict");
    const parsed =
      user.progress == null ? null : weeklyResetRecord.safeParse(user.progress);
    if (parsed && !parsed.success) return reply("unavailable");
    try {
      planWeeklyReset(parsed?.data ?? null, command, user.role, features, now);
    } catch {
      return reply("conflict");
    }
    if (!enabled) return reply("paused");
    return reply(record ? "pending" : "ready");
  });
}
