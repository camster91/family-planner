/**
 * Parent allowance creation and its keyed replay receipt commit together.
 *
 * The HTTP route performs the cheap authentication, feature and body checks.
 * This effect repeats the authorization and membership checks after taking the
 * same user-before-household advisory locks used by account membership code.
 * A response that is lost after commit can therefore be replayed without
 * creating another allowance, including when an abandoned idempotency lease is
 * taken over.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { EffectResult } from "@/lib/idempotency";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import type { z } from "zod";
import type { createAllowanceSchema } from "@/lib/validations";

type AllowanceInput = z.infer<typeof createAllowanceSchema>;
type AllowanceTx = Prisma.TransactionClient;

const inProgress = (): EffectResult => ({
  status: 409,
  body: {
    error: {
      code: "IDEMPOTENCY_IN_PROGRESS",
      message: "Please retry this allowance.",
      retryable: true,
    },
  },
});

/**
 * Create an allowance within an existing transaction. Membership locks are
 * acquired before the receipt row so allowance creation and account or
 * household deletion share one user(s) -> household -> receipt order.
 */
export async function createPersonAllowanceInTx(
  tx: AllowanceTx,
  input: AllowanceInput,
  actor: { familyId: string; userId: string },
  recordId: string | null,
): Promise<EffectResult> {
  // Account deletion/member removal lock users first and the household second.
  // Sort the user locks so two allowance writes with reversed participants do
  // not wait on each other in opposite orders.
  const memberIds = [...new Set([actor.userId, input.to_user_id])].sort();
  for (const memberId of memberIds) await lockUser(tx, memberId);
  await lockHousehold(tx, actor.familyId);

  // Deletion removes receipts only after taking the same membership locks.
  // Lock and re-read the receipt after those locks so this transaction cannot
  // hold the receipt while waiting on a deletion that is about to remove it.
  if (recordId) {
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
    const record = await tx.idempotencyRecord.findFirst({
      where: { id: recordId, family_id: actor.familyId, user_id: actor.userId },
      select: { response_status: true, response_body: true },
    });
    if (!record) return inProgress();
    if (record.response_status != null)
      return { status: record.response_status, body: record.response_body };
  }

  const [currentActor, recipient, family] = await Promise.all([
    tx.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, role: true, family_id: true },
    }),
    tx.user.findUnique({
      where: { id: input.to_user_id },
      select: { id: true, family_id: true },
    }),
    tx.family.findUnique({
      where: { id: actor.familyId },
      select: { id: true },
    }),
  ]);

  if (!family || !currentActor || currentActor.family_id !== actor.familyId) {
    return { status: 400, body: { error: "No family" } };
  }
  if (currentActor.role !== "parent") {
    return {
      status: 403,
      body: { error: "Only parents can create allowance" },
    };
  }
  if (!recipient || recipient.family_id !== actor.familyId) {
    return { status: 400, body: { error: "Target user not in your family" } };
  }

  const created = await tx.allowance.create({
    data: {
      family_id: actor.familyId,
      from_user_id: actor.userId,
      to_user_id: input.to_user_id,
      amount: input.amount,
      reason: input.reason?.trim() || null,
    },
  });
  const body = JSON.parse(
    JSON.stringify({ allowance: created }),
  ) as Prisma.InputJsonObject;
  if (recordId) {
    await tx.idempotencyRecord.update({
      where: { id: recordId },
      data: { response_status: 201, response_body: body },
    });
  }
  return { status: 201, body };
}

export async function createPersonAllowance(
  db: Pick<PrismaClient, "$transaction">,
  input: AllowanceInput,
  actor: { familyId: string; userId: string },
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction((tx) =>
    createPersonAllowanceInTx(tx, input, actor, recordId),
  );
}
