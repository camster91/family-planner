/** Compatibility for existing canonical chores; does not activate new profile-only writes. */
import type { Prisma } from "@prisma/client";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";
import { lockHousehold } from "@/lib/household-lock";

/** Acquires/reuses the household lock; callers needing account locks take those first. */
export async function canonicalChoreAssigneeInTx(
  tx: Prisma.TransactionClient,
  familyId: string,
  userId: string,
): Promise<{ assigned_to: string; assigned_member_id: string }> {
  await lockHousehold(tx, familyId);
  const [account, mappings, links] = await Promise.all([
    tx.user.findFirst({
      where: { id: userId, family_id: familyId },
      select: { id: true },
    }),
    tx.householdMemberLegacyMapping.findMany({
      where: { user_id: userId },
      select: { member_id: true, family_id: true },
    }),
    tx.householdMemberAccountLink.findMany({
      where: { user_id: userId },
      select: { member_id: true, family_id: true },
    }),
  ]);
  const refs = [...mappings, ...links];
  const ids = [...new Set(refs.map((r) => r.member_id))];
  if (
    !account ||
    refs.some((r) => r.family_id !== familyId) ||
    ids.length !== 1
  )
    throw new HouseholdMemberIdentityConflict();
  const id = ids[0];
  const [member, otherMappings, otherLinks] = await Promise.all([
    tx.householdMember.findFirst({
      where: {
        id,
        family_id: familyId,
        archived_at: null,
        erasure_user_id: null,
      },
      select: { id: true },
    }),
    tx.householdMemberLegacyMapping.count({
      where: { member_id: id, user_id: { not: userId } },
    }),
    tx.householdMemberAccountLink.count({
      where: { member_id: id, user_id: { not: userId } },
    }),
  ]);
  if (!member || otherMappings || otherLinks)
    throw new HouseholdMemberIdentityConflict();
  return { assigned_to: userId, assigned_member_id: id };
}
