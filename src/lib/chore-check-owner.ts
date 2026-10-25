/** Current original parent scope, used before effects and after private reads.
 * An owner object is an authenticated caller's precondition, not a credential.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import type { ChoreCheckOwner } from "@/lib/chore-check-command-shared";
export async function choreCheckOwnerAvailableInTx(tx: Prisma.TransactionClient, owner: ChoreCheckOwner): Promise<boolean> {
  await lockUser(tx, owner.userId);
  await lockHousehold(tx, owner.familyId);
  const users = await tx.$queryRaw<Array<{ family_id: string | null; role: string; token_version: number }>>`
    SELECT "family_id", "role", "token_version" FROM "User" WHERE "id" = ${owner.userId} FOR SHARE`;
  const user = users[0];
  if (users.length !== 1 || user.family_id !== owner.familyId || user.role !== "parent" || user.token_version !== owner.generation) return false;
  const families = await tx.$queryRaw<Array<{ features: unknown }>>`
    SELECT "features" FROM "Family" WHERE "id" = ${owner.familyId} FOR SHARE`;
  return families.length === 1 && isFeatureEnabled(normalizeFeatures(families[0].features), "chores");
}
export function renewChoreCheckOwner(db: Pick<PrismaClient, "$transaction">, owner: ChoreCheckOwner) {
  return db.$transaction(tx => choreCheckOwnerAvailableInTx(tx, owner), { timeout: 5000, maxWait: 5000 });
}
