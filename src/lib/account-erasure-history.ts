/** Non-FK account identifiers retained in household history require explicit erasure. */
import type { Prisma } from "@prisma/client";
import { auditSummary } from "@/lib/household-audit";
/** Caller holds the account lock; acquire returned households in stable order. */
export async function accountErasureHistoryHouseholds(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string[]> {
  const [messages, audits] = await Promise.all([
    tx.message.findMany({
      where: { OR: [{ sender_id: userId }, { read_by: { has: userId } }] },
      select: { family_id: true },
      distinct: ["family_id"],
    }),
    tx.auditLog.findMany({
      where: {
        OR: [
          { actor_user_id: userId },
          { target_type: "member", target_id: userId },
        ],
      },
      select: { family_id: true },
      distinct: ["family_id"],
    }),
  ]);
  return [
    ...new Set([...messages, ...audits].map((row) => row.family_id)),
  ].sort();
}
/** All households are already locked. Do not append a new departure in old households. */
export async function eraseRetainedAccountHistoryInTx(
  tx: Prisma.TransactionClient,
  user: { id: string; role: string },
  families: readonly string[],
): Promise<void> {
  for (const familyId of [...new Set(families)].sort()) {
    const target = {
      family_id: familyId,
      target_type: "member",
      target_id: user.id,
    };
    for (const [action, summary] of [
      ["member.joined", auditSummary.memberJoined(null, user.role)],
      ["member.removed", auditSummary.memberRemoved(null, user.role)],
      ["member.left", auditSummary.memberLeft(user.role)],
    ])
      await tx.auditLog.updateMany({
        where: { ...target, action },
        data: { target_id: null, summary },
      });
    // Retain an unknown historical event's action/time, but not copied personal
    // text in its known member-subject slot. Never alter another member's target.
    await tx.auditLog.updateMany({
      where: target,
      data: { target_id: null, summary: auditSummary.memberRedacted() },
    });
    await tx.auditLog.updateMany({
      where: { family_id: familyId, actor_user_id: user.id },
      data: { actor_user_id: null },
    });
    await tx.$executeRaw`UPDATE "Message" SET "read_by" = array_remove("read_by", ${user.id})
      WHERE "family_id" = ${familyId} AND ${user.id} = ANY("read_by")`;
  }
}
