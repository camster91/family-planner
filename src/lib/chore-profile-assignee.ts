/** Automatic top-up authority for existing email-free profile series. */
import type { Prisma } from "@prisma/client";
import {
  isProfileAgeAllowed,
  profileRoleSchema,
} from "@/lib/member-subject-contract";
import {
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
} from "@/lib/profile-chore-gates";

/** One canonical eligibility projection; readers must load it under the same
 * household lifecycle transaction, not synthesize it from client choices.
 */
export const PROFILE_CHORE_ELIGIBILITY_SELECT = {
  id: true, family_id: true, role: true, age: true,
  archived_at: true, erasure_user_id: true,
  legacy_mapping: { select: { user_id: true } },
  account_link: { select: { user_id: true } },
} as const satisfies Prisma.HouseholdMemberSelect;
type ProfileSnapshot = Prisma.HouseholdMemberGetPayload<{ select: typeof PROFILE_CHORE_ELIGIBILITY_SELECT }>;

/** Eligibility only: this snapshot is not account/auth authority or a write grant. */
export function profileChoreAssigneeFromSnapshot(
  member: ProfileSnapshot | null, familyId: string, memberId: string, repeating = true,
): { assigned_to: null; assigned_member_id: string } | null {
  if (!isProfileChoreEnabled() || (repeating && !isProfileChoreRecurrenceSupported())) return null;
  const role = member ? profileRoleSchema.safeParse(member.role) : null;
  if (!member || member.id !== memberId || member.family_id !== familyId ||
    member.archived_at !== null || member.erasure_user_id !== null ||
    member.legacy_mapping !== null || member.account_link !== null ||
    !role?.success || !isProfileAgeAllowed(role.data, member.age)) return null;
  return { assigned_to: null, assigned_member_id: memberId };
}

/** Caller holds the household lock. Never creates or links a login identity. */
export async function eligibleProfileChoreAssigneeInTx(
  tx: Prisma.TransactionClient,
  familyId: string,
  memberId: string,
  repeating = true,
): Promise<{ assigned_to: null; assigned_member_id: string } | null> {
  if (
    !isProfileChoreEnabled() ||
    (repeating && !isProfileChoreRecurrenceSupported())
  )
    return null;
  const member = await tx.householdMember.findFirst({
    where: { id: memberId, family_id: familyId },
    select: PROFILE_CHORE_ELIGIBILITY_SELECT,
  });
  return profileChoreAssigneeFromSnapshot(member, familyId, memberId, repeating);
}
