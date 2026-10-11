/** Dormant #480 compatibility for existing account removal/deletion transactions. */
import { lockHousehold } from '@/lib/household-lock'
export class HouseholdMemberIdentityConflict extends Error {
  constructor() {
    super('Household member identity needs review before this change.')
    this.name = 'HouseholdMemberIdentityConflict'
  }
}

/** Account lock first. Lock current and historic erasure households in stable order. */
export async function lockAccountProfileHouseholds(tx: any, userId: string, familyId: string | null): Promise<void> {
  const profiles: Array<{ family_id: string }> = await tx.householdMember.findMany({
    where: { erasure_user_id: userId }, select: { family_id: true },
  })
  const families = new Set(profiles.map((p) => p.family_id))
  if (familyId) families.add(familyId)
  for (const id of [...families].sort()) await lockHousehold(tx, id)
}

/** Caller holds the account lock, then its household membership lock. */
async function exclusiveAccountProfiles(tx: any, userId: string, familyId: string | null): Promise<string[]> {
  const [mappings, links] = await Promise.all([
    tx.householdMemberLegacyMapping.findMany({ where: { user_id: userId }, select: { member_id: true, family_id: true } }),
    tx.householdMemberAccountLink.findMany({ where: { user_id: userId }, select: { member_id: true, family_id: true } }),
  ])
  const refs: Array<{ member_id: string; family_id: string }> = [...mappings, ...links]
  if (refs.some((r) => !familyId || r.family_id !== familyId)) throw new HouseholdMemberIdentityConflict()
  const ids = [...new Set(refs.map((r) => r.member_id))].sort()
  if (ids.length === 0) return ids
  // One account cannot represent two different people, even within a household.
  if (ids.length !== 1) throw new HouseholdMemberIdentityConflict()
  const [profiles, otherMappings, otherLinks] = await Promise.all([
    tx.householdMember.findMany({ where: { id: { in: ids }, family_id: familyId }, select: { id: true, erasure_user_id: true } }),
    tx.householdMemberLegacyMapping.count({ where: { member_id: { in: ids }, user_id: { not: userId } } }),
    tx.householdMemberAccountLink.count({ where: { member_id: { in: ids }, user_id: { not: userId } } }),
  ])
  if (profiles.length !== ids.length || profiles.some((p: { erasure_user_id: string | null }) => p.erasure_user_id && p.erasure_user_id !== userId) || otherMappings || otherLinks) throw new HouseholdMemberIdentityConflict()
  return ids
}

/** Removal retains household profile/history, archives it, and detaches account authority. */
export async function archiveAccountProfilesInTx(tx: any, userId: string, familyId: string, now: Date): Promise<void> {
  const ids = await exclusiveAccountProfiles(tx, userId, familyId)
  if (ids.length === 0) return
  await tx.householdMember.updateMany({
    where: { id: { in: ids }, family_id: familyId, archived_at: null },
    data: { archived_at: now, erasure_user_id: userId, revision: { increment: 1 } },
  })
  // A profile archived earlier still needs erasure provenance before detachment.
  await tx.householdMember.updateMany({
    where: { id: { in: ids }, family_id: familyId, archived_at: { not: null }, erasure_user_id: null },
    data: { erasure_user_id: userId, revision: { increment: 1 } },
  })
  await tx.householdMemberAccountLink.deleteMany({ where: { user_id: userId, family_id: familyId } })
  await tx.householdMemberLegacyMapping.deleteMany({ where: { user_id: userId, family_id: familyId } })
}

/** Permanent account erasure removes the copied profile, never merely archives it. */
export async function eraseAccountProfilesInTx(tx: any, userId: string, familyId: string | null): Promise<void> {
  const current = await exclusiveAccountProfiles(tx, userId, familyId)
  const historic: Array<{ id: string }> = await tx.householdMember.findMany({ where: { erasure_user_id: userId }, select: { id: true } })
  const ids = [...new Set([...current, ...historic.map((p) => p.id)])].sort()
  if (ids.length === 0) return
  // Archived erasure ownership is private provenance, not current household access.
  const [otherMappings, otherLinks] = await Promise.all([
    tx.householdMemberLegacyMapping.count({ where: { member_id: { in: ids }, user_id: { not: userId } } }),
    tx.householdMemberAccountLink.count({ where: { member_id: { in: ids }, user_id: { not: userId } } }),
  ])
  if (otherMappings || otherLinks) throw new HouseholdMemberIdentityConflict()
  // Explicit erasure clears only the canonical identifying subject. Preserve
  // existing legacy deletion/handover policy and never transfer earned credit.
  // The sticky tombstone prevents fixture reconciliation from adopting a later
  // legacy owner and relinking retained historic rows to a different person.
  await tx.choreAssignment.updateMany({
    where: { assigned_member_id: { in: ids } },
    data: { assigned_member_id: null, member_subject_erased: true },
  })
  await tx.chore.updateMany({
    where: { assigned_member_id: { in: ids } },
    data: { assigned_member_id: null, member_subject_erased: true },
  })
  await tx.householdMemberAccountLink.deleteMany({ where: { member_id: { in: ids }, user_id: userId } })
  await tx.householdMemberLegacyMapping.deleteMany({ where: { member_id: { in: ids }, user_id: userId } })
  await tx.householdMember.deleteMany({ where: { id: { in: ids } } })
}
