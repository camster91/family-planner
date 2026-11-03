/** Read-only recovery preserves historical success before checking live targets. */
import { hashIdempotentRequest } from "../idempotency-hash";
import {
  preparationCommand,
  planEventPreparation,
  EventPreparationError,
} from "../event-preparation/contract";
import { preparationReceiptMatches } from "../event-preparation/receipt-server";
import {
  preparationReceipt,
  PREPARATION_ACTION,
} from "../event-preparation/http";
import { eventPreparationWritingEnabled } from "../event-preparation/owner";
import { scopeForPreparationCommand } from "../event-preparation/read-contract";
import {
  preparationRecoveryEntry,
  preparationRecoveryReview,
  PREPARATION_RECOVERY,
  type PreparationRecoveryEntry,
} from "../event-preparation/recovery";
import type { PreparationActor } from "../event-preparation/runtime";
import {
  authorizeD1PreparationActor,
  loadD1PreparationSource,
  validatedD1PreparationRead,
} from "./preparation-source";
import { getD1Database, type D1Store } from "./database";
import { d1EventPreparationStorageAvailable } from "./chore-read-policy";

export async function reviewD1PreparationRequest(
  actor: PreparationActor,
  rawEntry: PreparationRecoveryEntry,
  ownerScope: string,
  database?: D1Store,
  now = new Date(),
) {
  const entry = preparationRecoveryEntry.parse(rawEntry);
  const command = preparationCommand.parse(JSON.parse(entry.body));
  if (
    command.owner.userId !== actor.userId ||
    command.owner.familyId !== actor.familyId
  )
    throw new EventPreparationError("FORBIDDEN");
  const digest = hashIdempotentRequest(PREPARATION_ACTION, command);
  if (entry.requestHash !== digest) throw new EventPreparationError("INVALID");
  const store = database ?? (await getD1Database());
  return validatedD1PreparationRead(async (db) => {
    await authorizeD1PreparationActor(db, actor);
    const record = await db.idempotencyRecord.findUnique({
      where: { scope_key: { scope: `user:${actor.userId}`, key: entry.key } },
    });
    if (
      record &&
      (record.family_id !== actor.familyId ||
        record.user_id !== actor.userId ||
        record.action !== PREPARATION_ACTION ||
        record.request_hash !== digest)
    )
      throw new EventPreparationError("STALE");
    const reply = (
      state:
        | "ready"
        | "pending"
        | "committed"
        | "expired"
        | "conflict"
        | "paused"
        | "unavailable",
      currentToken: string | null = null,
      receipt: unknown = null,
    ) =>
      preparationRecoveryReview.parse({
        contract: PREPARATION_RECOVERY,
        ownerScope,
        entry,
        state,
        canRetry: ["ready", "pending"].includes(state),
        currentToken,
        receipt,
      });
    if (record?.response_status != null) {
      let body: unknown = record.response_body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          return reply("unavailable");
        }
      }
      return record.response_status === 200 &&
        preparationReceiptMatches(body, command, entry.key)
        ? reply("committed", null, preparationReceipt.parse(body))
        : reply("unavailable");
    }
    const age = +now - Date.parse(command.issuedAt);
    if (!Number.isFinite(age) || age < -60000 || age > 15 * 60000)
      return reply("expired");
    if (!eventPreparationWritingEnabled()) return reply("paused");
    if (!(await d1EventPreparationStorageAvailable(store)))
      return reply("unavailable");
    try {
      const prepared = await loadD1PreparationSource(
        db,
        actor,
        scopeForPreparationCommand(command),
      );
      planEventPreparation(command, prepared.context, now);
      return reply(record ? "pending" : "ready", prepared.context.viewToken);
    } catch (error) {
      if (error instanceof EventPreparationError) {
        if (error.code === "EXPIRED") return reply("expired");
        if (["UNAVAILABLE", "UNSUPPORTED"].includes(error.code))
          return reply("unavailable");
        if (
          [
            "STALE",
            "NOT_FOUND",
            "FORBIDDEN",
            "CLOSED",
            "REVIEW_REQUIRED",
            "SUBJECT_UNAVAILABLE",
            "ALREADY_LINKED",
            "TASK_UNAVAILABLE",
            "DATE_LOCKED",
            "CUE_MISMATCH",
            "POINTS_DISABLED",
          ].includes(error.code)
        )
          return reply("conflict");
      }
      throw error;
    }
  }, store);
}
