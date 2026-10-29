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

type Assignee = { assigned_to: string; assigned_member_id?: string };
type Reference = { member_id: string; family_id: string };
type MemberState = { id: string; archived_at: Date | null; erasure_user_id: string | null };
function referenceMemberId(familyId: string, refs: readonly Reference[]): string | null {
  const ids = [...new Set(refs.map(ref => ref.member_id))];
  if (refs.some(ref => ref.family_id !== familyId) || ids.length > 1)
    throw new HouseholdMemberIdentityConflict();
  return ids[0] ?? null;
}
function projectAssignee(userId: string, accountPresent: boolean, memberId: string | null,
  member: MemberState | null, hasOtherAccount: boolean,
  options: { requireCanonical?: boolean; historical?: boolean } = {}): Assignee | null {
  if (!accountPresent) return null;
  if (!memberId) {
    if (options.requireCanonical) throw new HouseholdMemberIdentityConflict();
    return { assigned_to: userId };
  }
  if (!member || hasOtherAccount) throw new HouseholdMemberIdentityConflict();
  if (member.erasure_user_id || (member.archived_at && !options.historical)) return null;
  return { assigned_to: userId, assigned_member_id: memberId };
}

/** Source-owned eligibility reads; callers own locking or native atomic witnesses. */
export type ChoreAssigneeReadDb = {
  user: Pick<Prisma.TransactionClient["user"], "findFirst">;
  householdMemberLegacyMapping: Pick<Prisma.TransactionClient["householdMemberLegacyMapping"], "findMany" | "count">;
  householdMemberAccountLink: Pick<Prisma.TransactionClient["householdMemberAccountLink"], "findMany" | "count">;
  householdMember: Pick<Prisma.TransactionClient["householdMember"], "findFirst">;
};
/** For automatic series top-up only: an inactive participant is skipped, a contradictory identity is refused. */
export async function eligibleChoreAssigneeInTx(
  tx: Prisma.TransactionClient,
  familyId: string,
  userId: string,
  options: { requireCanonical?: boolean; historical?: boolean } = {},
): Promise<{ assigned_to: string; assigned_member_id?: string } | null> {
  await lockHousehold(tx, familyId);
  return eligibleChoreAssigneeFromReads(tx, familyId, userId, options);
}
export async function eligibleChoreAssigneeFromReads(
  tx: ChoreAssigneeReadDb, familyId: string, userId: string,
  options: { requireCanonical?: boolean; historical?: boolean } = {},
): Promise<{ assigned_to: string; assigned_member_id?: string } | null> {
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
  const id = referenceMemberId(familyId, [...mappings, ...links]);
  if (!account || !id) return projectAssignee(userId, !!account, id, null, false, options);
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
  return projectAssignee(userId, true, id, member, !!(otherMappings || otherLinks), options);
}

export type ChoreAssigneeEligibility =
  | { kind: "eligible"; assignee: Assignee }
  | { kind: "inactive" }
  | { kind: "conflict" };
/** Bounded catalog reads only. Caller retains the household lifecycle transaction;
 * writers must still resolve their exact canonical target, never trust this map.
 */
export async function readChoreAssigneesInTx(tx: Prisma.TransactionClient, familyId: string,
  userIds: readonly string[]): Promise<Map<string, ChoreAssigneeEligibility>> {
  const ids = [...new Set(userIds)];
  if (ids.length > 1000) throw new HouseholdMemberIdentityConflict();
  const result = new Map<string, ChoreAssigneeEligibility>();
  if (!ids.length) return result;
  await lockHousehold(tx, familyId);
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const [accounts, mappings, links] = await Promise.all([
      tx.user.findMany({ where: { id: { in: batch }, family_id: familyId }, select: { id: true } }),
      // Global reference checks deliberately retain contradictory foreign links.
      tx.householdMemberLegacyMapping.findMany({ where: { user_id: { in: batch } }, select: { user_id: true, member_id: true, family_id: true } }),
      tx.householdMemberAccountLink.findMany({ where: { user_id: { in: batch } }, select: { user_id: true, member_id: true, family_id: true } }),
    ]);
    const refs = [...mappings, ...links];
    const memberIds = [...new Set(refs.map(ref => ref.member_id))];
    const [members, memberMappings, memberLinks] = memberIds.length ? await Promise.all([
      tx.householdMember.findMany({ where: { id: { in: memberIds }, family_id: familyId }, select: { id: true, archived_at: true, erasure_user_id: true } }),
      tx.householdMemberLegacyMapping.findMany({ where: { member_id: { in: memberIds } }, select: { member_id: true, user_id: true } }),
      tx.householdMemberAccountLink.findMany({ where: { member_id: { in: memberIds } }, select: { member_id: true, user_id: true } }),
    ]) : [[], [], []];
    const allMemberRefs = [...memberMappings, ...memberLinks];
    const accountIds = new Set(accounts.map(account => account.id));
    const byMember = new Map(members.map(member => [member.id, member]));
    for (const userId of batch) {
      try {
        const id = referenceMemberId(familyId, refs.filter(ref => ref.user_id === userId));
        const other = !!id && allMemberRefs.some(ref => ref.member_id === id && ref.user_id !== userId);
        const assignee = projectAssignee(userId, accountIds.has(userId), id, id ? byMember.get(id) ?? null : null, other);
        result.set(userId, assignee ? { kind: "eligible", assignee } : { kind: "inactive" });
      } catch (caught) {
        if (!(caught instanceof HouseholdMemberIdentityConflict)) throw caught;
        result.set(userId, { kind: "conflict" });
      }
    }
  }
  return result;
}
