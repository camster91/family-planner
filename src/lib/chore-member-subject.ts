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
  const assignee = await eligibleChoreAssigneeInTx(tx, familyId, userId, {
    requireCanonical: true,
  });
  if (!assignee?.assigned_member_id)
    throw new HouseholdMemberIdentityConflict();
  return {
    assigned_to: userId,
    assigned_member_id: assignee.assigned_member_id,
  };
}

/** Legacy rows remain supported until explicit mappings exist; inactive owners never receive new work. */
export async function choreAssigneeForCreateInTx(
  tx: Prisma.TransactionClient,
  familyId: string,
  userId: string,
  options: { requireCanonical?: boolean; historical?: boolean } = {},
): Promise<{ assigned_to: string; assigned_member_id?: string }> {
  const assignee = await eligibleChoreAssigneeInTx(
    tx,
    familyId,
    userId,
    options,
  );
  if (!assignee) throw new HouseholdMemberIdentityConflict();
  return assignee;
}

/** For automatic series top-up only: an inactive participant is skipped, a contradictory identity is refused. */
export async function eligibleChoreAssigneeInTx(
  tx: Prisma.TransactionClient,
  familyId: string,
  userId: string,
  options: { requireCanonical?: boolean; historical?: boolean } = {},
): Promise<{ assigned_to: string; assigned_member_id?: string } | null> {
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
  if (refs.some((r) => r.family_id !== familyId) || ids.length > 1)
    throw new HouseholdMemberIdentityConflict();
  if (!account) return null;
  if (ids.length === 0) {
    if (options.requireCanonical) throw new HouseholdMemberIdentityConflict();
    return { assigned_to: userId };
  }
  const id = ids[0];
  const [member, otherMappings, otherLinks] = await Promise.all([
    tx.householdMember.findFirst({
      where: {
        id,
        family_id: familyId,
      },
      select: { id: true, archived_at: true, erasure_user_id: true },
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
  if (member.erasure_user_id || (member.archived_at && !options.historical))
    return null;
  return { assigned_to: userId, assigned_member_id: id };
}
