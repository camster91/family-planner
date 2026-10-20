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
    select: {
      id: true,
      family_id: true,
      role: true,
      age: true,
      archived_at: true,
      erasure_user_id: true,
      legacy_mapping: { select: { user_id: true } },
      account_link: { select: { user_id: true } },
    },
  });
  const role = member ? profileRoleSchema.safeParse(member.role) : null;
  if (
    !member ||
    member.id !== memberId ||
    member.family_id !== familyId ||
    member.archived_at !== null ||
    member.erasure_user_id !== null ||
    member.legacy_mapping !== null ||
    member.account_link !== null ||
    !role?.success ||
    !isProfileAgeAllowed(role.data, member.age)
  )
    return null;
  return { assigned_to: null, assigned_member_id: memberId };
}
