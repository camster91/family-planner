/** Readonly saved-request inspection. Historical success is checked before any
 * target/schema/readiness/age read; it does not assert current task readiness. */
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import type { PrismaClient, Prisma } from "@prisma/client";
import { hashIdempotentRequest } from "@/lib/idempotency";
import {
  preparationCommand,
  planEventPreparation,
  EventPreparationError,
} from "./contract";
import { preparationReceiptMatches } from "./receipt-server";
import { preparationReceipt, PREPARATION_ACTION } from "./http";
import {
  openPreparationActorInTx,
  prepareEventPreparationInTx,
  type PreparationActor,
} from "./runtime";
import { eventPreparationWritingEnabled } from "./owner";
import { scopeForPreparationCommand } from "./read-contract";
import {
  preparationRecoveryEntry,
  preparationRecoveryReview,
  PREPARATION_RECOVERY,
  type PreparationRecoveryEntry,
} from "./recovery";
/** Must run after actor/household advisory locks, before target/receipt reads.
 * Shared user lock is compatible with the later sorted participant read set. */
export async function renewPreparationReceiptActorInTx(
  tx: Prisma.TransactionClient,
  actor: PreparationActor,
) {
  const users = await tx.$queryRaw<
    Array<{ role: string; token_version: number }>
  >`SELECT "role", "token_version" FROM "User" WHERE "id"=${actor.userId} AND "family_id"=${actor.familyId} FOR SHARE`;
  if (!users[0] || users[0].token_version !== actor.tokenVersion)
    throw new EventPreparationError("UNAUTHORIZED");
  if (users[0].role !== "parent") throw new EventPreparationError("FORBIDDEN");
}
export async function authorizePreparationReceipt(
  db: PrismaClient,
  actor: PreparationActor,
) {
  return db.$transaction(async (tx) => {
    await openPreparationActorInTx(tx, actor);
    await renewPreparationReceiptActorInTx(tx, actor);
    const families = await tx.$queryRaw<
      Array<{ features: unknown }>
    >`SELECT "features" FROM "Family" WHERE "id"=${actor.familyId} FOR SHARE`;
    if (!families[0]) throw new EventPreparationError("FORBIDDEN");
    const features = normalizeFeatures(families[0].features);
    return {
      domainsEnabled:
        isFeatureEnabled(features, "calendar") &&
        isFeatureEnabled(features, "chores"),
    };
  });
}
export async function reviewPreparationRequest(
  db: PrismaClient,
  actor: PreparationActor,
  rawEntry: PreparationRecoveryEntry,
  ownerScope: string,
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
  return db.$transaction(async (tx) => {
    await openPreparationActorInTx(tx, actor);
    await renewPreparationReceiptActorInTx(tx, actor);
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
        record.action !== PREPARATION_ACTION ||
        record.request_hash !== digest)
    )
      throw new EventPreparationError("STALE");
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
    if (record?.response_status != null)
      return record.response_status === 200 &&
        preparationReceiptMatches(record.response_body, command, entry.key)
        ? reply(
            "committed",
            null,
            preparationReceipt.parse(record.response_body),
          )
        : reply("unavailable");
    const age = +now - Date.parse(command.issuedAt);
    if (!Number.isFinite(age) || age < -60000 || age > 15 * 60000)
      return reply("expired");
    if (!eventPreparationWritingEnabled()) return reply("paused");
    try {
      const prepared = await prepareEventPreparationInTx(
        tx,
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
  });
}
