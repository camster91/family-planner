import { prepareRewardApprovalNotifications, lockRewardApprovalNotificationPlan, recordRewardApprovalNotificationInTx } from "@/lib/reward-approval-notification-event";
import { randomUUID } from "node:crypto";
import { prepareRewardClaimNotifications, lockRewardClaimNotificationPlan, recordRewardClaimNotificationsInTx } from "@/lib/reward-claim-notification-event";
/**
 * Transactional reward mutations.
 *
 * The HTTP routes still accept requests without an Idempotency-Key for older
 * clients. When a key is present, the reward/XP/receipt writes happen in the
 * same transaction so a response lost after commit can be replayed without a
 * second reward, XP deduction, approval, metric, or notification fanout.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import type { EffectResult } from "@/lib/idempotency";
import type {
  claimRewardSchema,
  createRewardSchema,
  updateRewardSchema,
} from "@/lib/validations";
import type { z } from "zod";

type RewardTx = Prisma.TransactionClient;
type RewardDb = Pick<PrismaClient, "$transaction">;
type CreateRewardInput = z.infer<typeof createRewardSchema>;
type UpdateRewardInput = z.infer<typeof updateRewardSchema>;
type ClaimRewardInput = z.infer<typeof claimRewardSchema>;

export type RewardActor = {
  /** Original HTTP session generation; never renewed from a later DB value. */
  tokenVersion?: number;
  familyId: string;
  userId: string;
  role: string;
};

export type RewardMutation = {
  result: EffectResult;
  /** True only when this invocation performed the mutation. */
  applied: boolean;
  /** Actual price charged by a fresh claim, when applicable. */
  cost?: number;
  /** Atomic event/recipient handling already occurred; skip legacy fanout. */
  notificationHandled?: boolean;
};

const inProgress = (): EffectResult => ({
  status: 409,
  body: {
    error: {
      code: "IDEMPOTENCY_IN_PROGRESS",
      message: "Please retry this reward request.",
      retryable: true,
    },
  },
});

const featureOff = (): EffectResult => ({
  status: 403,
  body: { error: "This feature is turned off for your family" },
});

/**
 * Recheck live household membership, feature state, and parent authority. The
 * same check is used by mutation transactions and completed-receipt replay.
 */
export async function authorizeRewardActorInTx(
  tx: RewardTx,
  actor: RewardActor,
  parentOnly: boolean,
): Promise<EffectResult | null> {
  await lockRewardMembership(tx, actor);
  return authorizeRewardActorLocked(tx, actor, parentOnly);
}

async function authorizeRewardActorLocked(
  tx: RewardTx,
  actor: RewardActor,
  parentOnly: boolean,
): Promise<EffectResult | null> {
  const [currentActor, family] = await Promise.all([
    tx.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, role: true, family_id: true, token_version: true },
    }),
    tx.family.findUnique({
      where: { id: actor.familyId },
      select: { id: true, features: true },
    }),
  ]);

  if (actor.tokenVersion !== undefined && (!Number.isSafeInteger(actor.tokenVersion) || actor.tokenVersion < 0
      || !currentActor || !family || currentActor.family_id !== actor.familyId
      || currentActor.token_version !== actor.tokenVersion || currentActor.role !== actor.role)) {
    return { status: 401, body: { error: "Unauthorized", code: "REWARD_ACCESS_CHANGED" } };
  }
  if (!family || !currentActor || currentActor.family_id !== actor.familyId) {
    return { status: 400, body: { error: "No family" } };
  }
  if (!isFeatureEnabled(normalizeFeatures(family.features), "rewards"))
    return featureOff();
  if (parentOnly && currentActor.role !== "parent") {
    return {
      status: 403,
      body: { error: "Only parents can perform this action" },
    };
  }
  return null;
}

async function lockRewardMembership(tx: RewardTx, actor: RewardActor): Promise<void> {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  if (actor.tokenVersion !== undefined) {
    // Actual rows fence ordinary token/role/feature updates that do not use an
    // advisory lifecycle lock. Never replace the original cookie generation.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${actor.familyId} FOR SHARE`;
  }
}

async function receiptResult(
  tx: RewardTx,
  actor: RewardActor,
  recordId: string | null,
): Promise<EffectResult | null> {
  if (!recordId) return null;

  // withIdempotency owns the lease, while this lock makes the receipt and the
  // reward/XP mutation one transaction at the database boundary.
  await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
  const record = await tx.idempotencyRecord.findFirst({
    where: { id: recordId, family_id: actor.familyId, user_id: actor.userId },
    select: { response_status: true, response_body: true },
  });
  if (!record) return inProgress();
  if (record.response_status != null) {
    return { status: record.response_status, body: record.response_body };
  }
  return null;
}

function jsonBody(body: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(body)) as Prisma.InputJsonObject;
}

async function storeReceipt(
  tx: RewardTx,
  recordId: string | null,
  result: EffectResult,
): Promise<void> {
  if (!recordId) return;
  await tx.idempotencyRecord.update({
    where: { id: recordId },
    data: {
      response_status: result.status,
      response_body: jsonBody(result.body),
    },
  });
}

export async function createReward(
  db: RewardDb,
  input: CreateRewardInput,
  actor: RewardActor,
  recordId: string | null,
): Promise<RewardMutation> {
  return db.$transaction(async (tx) => {
    await lockRewardMembership(tx, actor);
    const denied = await authorizeRewardActorLocked(tx, actor, true);
    if (denied) return { result: denied, applied: false };
    const replay = await receiptResult(tx, actor, recordId);
    if (replay) return { result: replay, applied: false };

    const reward = await tx.reward.create({
      data: {
        family_id: actor.familyId,
        name: input.name,
        description: input.description || null,
        cost: input.cost,
        icon: input.icon || "gift",
        status: "available",
        created_by: actor.userId,
      },
      include: { creator: { select: { id: true, name: true } } },
    });
    const result: EffectResult = { status: 200, body: { reward } };
    await storeReceipt(tx, recordId, result);
    return { result, applied: true };
  });
}

export async function updateReward(
  db: RewardDb,
  input: UpdateRewardInput,
  actor: RewardActor,
  recordId: string | null,
): Promise<RewardMutation> {
  return db.$transaction(async (tx) => {
    await lockRewardMembership(tx, actor);
    const denied = await authorizeRewardActorLocked(tx, actor, true);
    if (denied) return { result: denied, applied: false };
    const replay = await receiptResult(tx, actor, recordId);
    if (replay) return { result: replay, applied: false };

    const current = await tx.reward.findUnique({
      where: { id: input.rewardId },
      select: { family_id: true },
    });
    if (!current)
      return {
        result: { status: 404, body: { error: "Reward not found" } },
        applied: false,
      };
    if (current.family_id !== actor.familyId)
      return {
        result: { status: 403, body: { error: "Forbidden" } },
        applied: false,
      };

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined)
      updateData.description = input.description;
    if (input.cost !== undefined) updateData.cost = input.cost;
    if (input.icon !== undefined) updateData.icon = input.icon;
    const reward = await tx.reward.update({
      where: { id: input.rewardId },
      data: updateData,
      include: {
        creator: { select: { id: true, name: true } },
        claimer: { select: { id: true, name: true } },
      },
    });
    const result: EffectResult = { status: 200, body: { reward } };
    await storeReceipt(tx, recordId, result);
    return { result, applied: true };
  });
}

export class InsufficientRewardXpError extends Error {}

export async function claimReward(
  db: RewardDb,
  input: ClaimRewardInput,
  actor: RewardActor,
  recordId: string | null,
): Promise<RewardMutation> {
  const notificationPlan = await prepareRewardClaimNotifications(db, actor);
  return db.$transaction(async (tx) => {
    if (notificationPlan) await lockRewardClaimNotificationPlan(tx, notificationPlan);
    else await lockRewardMembership(tx, actor);
    const denied = await authorizeRewardActorLocked(tx, actor, false);
    if (denied) return { result: denied, applied: false };
    const replay = await receiptResult(tx, actor, recordId);
    if (replay) return { result: replay, applied: false };

    const current = await tx.reward.findUnique({
      where: { id: input.rewardId },
      select: {
        id: true,
        family_id: true,
        cost: true,
        name: true,
        is_active: true,
      },
    });
    if (!current)
      return {
        result: { status: 404, body: { error: "Reward not found" } },
        applied: false,
      };
    if (current.family_id !== actor.familyId)
      return {
        result: { status: 403, body: { error: "Forbidden" } },
        applied: false,
      };
    if (!current.is_active) {
      return {
        result: { status: 400, body: { error: "Reward is not available" } },
        applied: false,
      };
    }
    const claimedAt = new Date();
    const transitionId = notificationPlan ? randomUUID() : null;
    const claimedReward = await tx.reward.updateMany({
      where: {
        id: input.rewardId,
        status: "available",
        is_active: true,
        family_id: actor.familyId,
      },
      data: {
        status: "claimed",
        claimed_by: actor.userId,
        claimed_at: claimedAt,
        ...(transitionId ? { notification_claim_id: transitionId } : {}),
      },
    });
    if (claimedReward.count === 0) {
      return {
        result: {
          status: 409,
          body: { error: "Reward is no longer available" },
        },
        applied: false,
      };
    }

    // Read the cost after the conditional claim, preserving the concurrent
    // pricing fix: a parent price change cannot charge a stale preflight cost.
    const claimed = await tx.reward.findUnique({
      where: { id: input.rewardId },
      select: { cost: true },
    });
    const cost = claimed?.cost ?? current.cost;
    if (notificationPlan && (!Number.isSafeInteger(cost) || cost < 0)) throw new Error("Reward claim notification held");
    const deducted = await tx.user.updateMany({
      where: { id: actor.userId, xp: { gte: cost } },
      data: { xp: { decrement: cost } },
    });
    if (deducted.count === 0) throw new InsufficientRewardXpError();

    const [fresh, reward] = await Promise.all([
      tx.user.findUnique({ where: { id: actor.userId }, select: { xp: true } }),
      tx.reward.findUnique({
        where: { id: input.rewardId },
        include: {
          creator: { select: { id: true, name: true } },
          claimer: { select: { id: true, name: true } },
        },
      }),
    ]);
    const result: EffectResult = {
      status: 200,
      body: { reward, xp: fresh?.xp ?? 0 },
    };
    if (notificationPlan && transitionId) {
      await recordRewardClaimNotificationsInTx(tx, notificationPlan, { rewardId: input.rewardId, transitionId, claimedAt, cost });
    }
    await storeReceipt(tx, recordId, result);
    return { result, applied: true, cost, notificationHandled: notificationPlan !== null };
  });
}

export async function approveReward(
  db: RewardDb,
  input: { rewardId: string },
  actor: RewardActor,
  recordId: string | null,
): Promise<RewardMutation & { claimerId?: string | null }> {
  const notificationPlan = await prepareRewardApprovalNotifications(db, actor, input.rewardId);
  return db.$transaction(async (tx) => {
    const recipientId = notificationPlan ? await lockRewardApprovalNotificationPlan(tx, notificationPlan) : null;
    if (!notificationPlan) await lockRewardMembership(tx, actor);
    const denied = await authorizeRewardActorLocked(tx, actor, true);
    if (denied) return { result: denied, applied: false };
    const replay = await receiptResult(tx, actor, recordId);
    if (replay) return { result: replay, applied: false };

    const current = await tx.reward.findUnique({
      where: { id: input.rewardId },
      select: {
        family_id: true,
        status: true,
        claimed_by: true,
        claimer: { select: { id: true } },
      },
    });
    if (!current)
      return {
        result: { status: 404, body: { error: "Reward not found" } },
        applied: false,
      };
    if (current.family_id !== actor.familyId)
      return {
        result: { status: 403, body: { error: "Forbidden" } },
        applied: false,
      };
    if (notificationPlan && current.claimed_by !== notificationPlan.claimantId) throw new Error("Reward approval claimant changed");
    if (current.status !== "claimed")
      return {
        result: {
          status: 400,
          body: { error: "Reward must be claimed before approval" },
        },
        applied: false,
      };

    // The status predicate is the approval transition guard. Two different
    // fresh keys cannot both redeem the same claimed reward or notify twice.
    const approvedAt = new Date();
    const transitionId = notificationPlan ? randomUUID() : null;
    const transitioned = await tx.reward.updateMany({
      where: {
        id: input.rewardId,
        family_id: actor.familyId,
        status: "claimed",
      },
      data: {
        status: "redeemed",
        approved: true,
        approved_by: actor.userId,
        approved_at: approvedAt,
        redeemed_at: approvedAt,
        ...(transitionId ? { notification_approval_id: transitionId } : {}),
      },
    });
    if (transitioned.count === 0) {
      return {
        result: {
          status: 400,
          body: { error: "Reward must be claimed before approval" },
        },
        applied: false,
      };
    }

    const reward = await tx.reward.findUnique({
      where: { id: input.rewardId },
      include: {
        creator: { select: { id: true, name: true } },
        claimer: { select: { id: true, name: true } },
      },
    });
    const result: EffectResult = { status: 200, body: { reward } };
    if (notificationPlan && transitionId) {
      await recordRewardApprovalNotificationInTx(tx, notificationPlan, { rewardId: input.rewardId, transitionId, approvedAt, recipientId });
    }
    await storeReceipt(tx, recordId, result);
    return {
      result,
      applied: true,
      notificationHandled: notificationPlan !== null,
      claimerId: current.claimer?.id ?? null,
    };
  });
}

export async function authorizeRewardReplay(
  db: RewardDb,
  actor: RewardActor,
  parentOnly: boolean,
): Promise<EffectResult | null> {
  return db.$transaction((tx) =>
    authorizeRewardActorInTx(tx, actor, parentOnly),
  );
}
