import type { PrismaClient } from "@prisma/client";
import { hashIdempotentRequest } from "@/lib/idempotency";
import {
  ResponsibilityError,
  responsibilityCommand,
  planResponsibility,
} from "@/lib/responsibility";
import {
  openResponsibilityActorInTx,
  renewResponsibilityReceiptActorInTx,
  prepareResponsibilityInTx,
  type ResponsibilityActor,
} from "@/lib/responsibility-runtime";
import {
  responsibilityReceipt,
  responsibilityReceiptMatches,
  RESPONSIBILITY_ACTION,
} from "@/lib/responsibility-http-contract";
import {
  RESPONSIBILITY_RECOVERY,
  responsibilityRecoveryReview,
  type ResponsibilityRecoveryEntry,
} from "@/lib/responsibility-recovery";
export function reviewResponsibilityRequest(
  db: PrismaClient,
  actor: ResponsibilityActor,
  entry: ResponsibilityRecoveryEntry,
  ownerScope: string,
  now = new Date(),
) {
  const command = responsibilityCommand.parse(JSON.parse(entry.body));
  if (command.userId !== actor.userId || command.familyId !== actor.familyId)
    throw new ResponsibilityError("FORBIDDEN");
  return db.$transaction(async (tx) => {
    await openResponsibilityActorInTx(tx, actor);
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
        record.action !== RESPONSIBILITY_ACTION ||
        record.request_hash !==
          hashIdempotentRequest(RESPONSIBILITY_ACTION, command))
    )
      throw new ResponsibilityError("CONFLICT");
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
      currentRevision: number | null = null,
      receipt: unknown = null,
    ) =>
      responsibilityRecoveryReview.parse({
        contract: RESPONSIBILITY_RECOVERY,
        ownerScope,
        entry,
        state,
        canRetry: ["ready", "pending"].includes(state),
        currentRevision,
        receipt,
      });
    if (record?.response_status != null) {
      await renewResponsibilityReceiptActorInTx(tx, actor);
      return record.response_status === 200 &&
        responsibilityReceiptMatches(record.response_body, command, entry.key)
        ? reply(
            "committed",
            null,
            responsibilityReceipt.parse(record.response_body),
          )
        : reply("unavailable");
    }
    const age = now.getTime() - Date.parse(command.issuedAt);
    if (age > 15 * 60000 || age < -60000) {
      await renewResponsibilityReceiptActorInTx(tx, actor);
      return reply("expired");
    }
    // All planned reads are inside the transaction. Domain/identity holds throw
    // out of it; the HTTP layer never treats a failed DB transaction as empty.
    const opened = await prepareResponsibilityInTx(
      tx,
      actor,
      command.target,
      command,
      now,
    );
    if (!opened.context.writesEnabled)
      return reply("paused", opened.projection.stored.revision);
    try {
      planResponsibility(
        opened.current?.state ?? null,
        command,
        opened.context,
        now,
      );
    } catch (error) {
      if (
        error instanceof ResponsibilityError &&
        [
          "CONFLICT",
          "NO_OWNER",
          "DUPLICATE_SUBJECT",
          "SUBJECT_UNAVAILABLE",
          "FORBIDDEN",
        ].includes(error.code)
      )
        return reply("conflict", opened.projection.stored.revision);
      throw error;
    }
    return reply(
      record ? "pending" : "ready",
      opened.projection.stored.revision,
    );
  });
}
