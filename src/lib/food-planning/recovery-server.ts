/** Receipt-first inspection. Missing/pending/expired is never proof of no effect. */
import type { PrismaClient } from "@prisma/client";
import {
  hashIdempotentRequest,
  IDEMPOTENCY_LOCK_TIMEOUT_MS,
} from "../idempotency";
import {
  FOOD_APPLY_ACTION,
  reviewedFoodWrite,
  foodApplyReceipt,
  foodApplyReceiptMatches,
} from "./apply-contract";
import { authorizeFoodWriteInTx } from "./persist";
import type { FoodPlanActor } from "./server";
import { createFoodWriteSourceGuard } from "./review";
import { foodWritingEnabled } from "./owner";
import { FoodReviewRefused, readFoodReviewSeal } from "./review-proof";
import {
  FOOD_RECOVERY,
  foodRecoveryReply,
  type FoodRecoveryEntry,
  type FoodRecoveryReply,
} from "./recovery-contract";
export async function inspectFoodRequest(
  db: Pick<PrismaClient, "$transaction">,
  actor: FoodPlanActor,
  entry: FoodRecoveryEntry,
  ownerScope: string,
  now = new Date(),
) {
  const command = reviewedFoodWrite.parse(JSON.parse(entry.body));
  return db.$transaction(
    async (tx) => {
      await authorizeFoodWriteInTx(tx, actor, command);
      const seal = readFoodReviewSeal(actor, command); // Original role/generation, no lease/source requirement yet.
      const requestHash = hashIdempotentRequest(FOOD_APPLY_ACTION, command);
      const reply = (
        state: FoodRecoveryReply["state"],
        receipt: unknown = null,
      ) =>
        foodRecoveryReply.parse({
          contract: FOOD_RECOVERY,
          ownerScope,
          entry,
          requestHash,
          state,
          canRetry: state === "ready",
          retryUntil: state === "ready" ? seal.expiresAt : null,
          receipt,
        });
      const record = await tx.idempotencyRecord.findFirst({
        where: { scope: `user:${actor.userId}`, key: entry.key },
        select: {
          family_id: true,
          user_id: true,
          action: true,
          request_hash: true,
          response_status: true,
          response_body: true,
          created_at: true,
          expires_at: true,
        },
      });
      if (
        record &&
        (record.family_id !== actor.familyId ||
          record.user_id !== actor.userId ||
          record.action !== FOOD_APPLY_ACTION ||
          record.request_hash !== requestHash)
      )
        return reply("conflict");
      if (record && record.response_status !== null)
        return record.response_status === 201 &&
          foodApplyReceiptMatches(record.response_body, command)
          ? reply("committed", foodApplyReceipt.parse(record.response_body))
          : reply("unavailable");
      if (
        +now >= Date.parse(seal.expiresAt) ||
        (record && record.expires_at <= now)
      )
        return reply("expired");
      if (+now < Date.parse(seal.issuedAt) - 1000) return reply("unavailable");
      if (!foodWritingEnabled()) return reply("paused");
      if (record && +record.created_at > +now - IDEMPOTENCY_LOCK_TIMEOUT_MS)
        return reply("pending");
      try {
        const guard = createFoodWriteSourceGuard();
        await guard.verify(tx, actor, command);
        guard.assertCurrent();
        return reply("ready");
      } catch (error) {
        return reply(
          error instanceof FoodReviewRefused ? "conflict" : "unavailable",
        );
      }
    },
    { isolationLevel: "RepeatableRead", timeout: 15000 },
  );
}
