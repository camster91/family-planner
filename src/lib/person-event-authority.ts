/** Shared online calendar authority. Caller input never chooses household access. */
import type { Prisma } from "@prisma/client";
import type { EffectResult } from "./idempotency";
import { lockUser, lockHousehold } from "./household-lock";
export type PersonEventActor = { userId: string; familyId: string; tokenVersion: number };
export async function authorizePersonEventInTx(
  tx: Prisma.TransactionClient,
  actor: PersonEventActor,
  action: "create" | "edit",
): Promise<EffectResult | null> {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  const user = await tx.user.findUnique({ where: { id: actor.userId },
    select: { family_id: true, role: true, token_version: true } });
  if (!user || user.token_version !== actor.tokenVersion)
    return { status: 401, body: { error: "Unauthorized" } };
  if (user.family_id !== actor.familyId || !["parent", "teen", "child"].includes(user.role) ||
    (action === "edit" && user.role !== "parent"))
    return { status: 403, body: { error: "This account cannot perform this calendar action in this household" } };
  const family = await tx.family.findUnique({ where: { id: actor.familyId }, select: { id: true } });
  return family ? null : { status: 404, body: { error: "Household not found" } };
}
