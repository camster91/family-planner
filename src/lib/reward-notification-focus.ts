/** Exact claim/approval destination. A URL never grants access or an action.
 * No names, unrelated history, XP balance, provider data or fake User subjects.
 */
import type { PrismaClient } from "@prisma/client";
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
export type RewardNotificationFocus = {
  id: string; sourceGeneration: string; name: string; description: string | null; cost: number; icon: string | null;
  status: "claimed" | "approved" | "redeemed"; active: boolean;
  claimedById: string | null; claimedByName: null;
};
export async function readRewardNotificationFocus(
  db: Pick<PrismaClient, "$transaction">,
  owner: { userId: string; familyId: string; role: string; tokenVersion: number },
  target: unknown,
): Promise<RewardNotificationFocus | null> {
  if (typeof target !== "string" || !MEMBER_ID_PATTERN.test(target)
      || !["parent", "teen", "child"].includes(owner.role)
      || !Number.isSafeInteger(owner.tokenVersion) || owner.tokenVersion < 0) return null;
  return db.$transaction(async tx => {
    await lockUser(tx, owner.userId);
    await lockHousehold(tx, owner.familyId);
    const users = await tx.$queryRaw<Array<{ family_id: string | null; role: string; token_version: number }>>`
      SELECT "family_id", "role", "token_version" FROM "User" WHERE "id" = ${owner.userId} FOR SHARE`;
    const user = users[0];
    if (users.length !== 1 || user.family_id !== owner.familyId || user.role !== owner.role || user.token_version !== owner.tokenVersion) return null;
    const families = await tx.$queryRaw<Array<{ features: unknown }>>`
      SELECT "features" FROM "Family" WHERE "id" = ${owner.familyId} FOR SHARE`;
    // Effective rewards gate also checks its Points & streaks dependency.
    if (families.length !== 1 || !isFeatureEnabled(normalizeFeatures(families[0].features), "rewards")) return null;
    const targets = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Reward" WHERE "id" = ${target} AND "family_id" = ${owner.familyId}
      AND (${owner.role === "parent"} OR "claimed_by" = ${owner.userId})
      AND "status" IN ('claimed', 'approved', 'redeemed') FOR SHARE`;
    if (targets.length !== 1) return null;
    const row = await tx.reward.findFirst({
      where: { id: target, family_id: owner.familyId,
        ...(owner.role === "parent" ? {} : { claimed_by: owner.userId }),
        status: { in: ["claimed", "approved", "redeemed"] } },
      select: { id: true, notification_generation: true, name: true, description: true, cost: true, icon: true, status: true, is_active: true, claimed_by: true },
    });
    if (!row || !Number.isSafeInteger(row.cost) || row.cost < 0
        || !["claimed", "approved", "redeemed"].includes(row.status)) return null;
    return { id: row.id, sourceGeneration: row.notification_generation, name: row.name, description: row.description, cost: row.cost, icon: row.icon,
      status: row.status as RewardNotificationFocus["status"], active: row.is_active,
      claimedById: row.claimed_by, claimedByName: null };
  }, { timeout: 5000, maxWait: 5000 });
}
