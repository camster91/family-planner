import { accountErasureHistoryHouseholds } from '@/lib/account-erasure-history'
import { rewriteRoutineSubjectsInTx, routineSubjectHouseholds } from '@/lib/routine-subject-lifecycle'
/** Dormant #480 compatibility for existing account removal/deletion transactions. */
import { lockHousehold } from '@/lib/household-lock'
export class HouseholdMemberIdentityConflict extends Error {
  constructor() {
    super('Household member identity needs review before this change.')
    this.name = 'HouseholdMemberIdentityConflict'
  }
}

/** Account lock first. Lock current and historic erasure households in stable order. */
export async function lockAccountProfileHouseholds(tx: any, userId: string, familyId: string | null): Promise<string[]> {
  const profiles: Array<{ family_id: string }> = await tx.householdMember.findMany({
    where: { erasure_user_id: userId }, select: { family_id: true },
  })
  const families = new Set([...profiles.map((p) => p.family_id), ...await routineSubjectHouseholds(tx, userId), ...await accountErasureHistoryHouseholds(tx, userId)])
  if (familyId) families.add(familyId)
  const ordered = [...families].sort()
  for (const id of ordered) await lockHousehold(tx, id)
  return ordered
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
  // Account-only future aliases also need to invalidate prepared review when
  // membership changes; no subject is transferred to the removing parent.
  await rewriteRoutineSubjectsInTx(tx, familyId, { kind: 'invalidate', userId, memberIds: ids })
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
  const historic: Array<{ id: string; family_id: string }> = await tx.householdMember.findMany({
    where: { erasure_user_id: userId },
    select: { id: true, family_id: true },
  })
  const ids = [...new Set([...current, ...historic.map((p) => p.id)])].sort()
  // Future definitions can name an account without a canonical profile. Redact
  // all currently/historically locked households, independent of rollout flags.
  const routineSubjectsByFamily = new Map<string, string[]>((await routineSubjectHouseholds(tx, userId)).map((id) => [id, []]))
  if (familyId) routineSubjectsByFamily.set(familyId, [...current])
  for (const profile of historic) routineSubjectsByFamily.set(profile.family_id, [...(routineSubjectsByFamily.get(profile.family_id) ?? []), profile.id])
  for (const [subjectFamilyId, memberIds] of routineSubjectsByFamily) {
    await rewriteRoutineSubjectsInTx(tx, subjectFamilyId, { kind: 'erase', userId, memberIds: [...new Set(memberIds)] })
  }
  if (ids.length === 0) return
  // Archived erasure ownership is private provenance, not current household access.
  const [otherMappings, otherLinks] = await Promise.all([
    tx.householdMemberLegacyMapping.count({ where: { member_id: { in: ids }, user_id: { not: userId } } }),
    tx.householdMemberAccountLink.count({ where: { member_id: { in: ids }, user_id: { not: userId } } }),
  ])
  if (otherMappings || otherLinks) throw new HouseholdMemberIdentityConflict()
  // Audit attribution is separate from the authenticated actor. Clear only
  // the identifying subject, keep the row and mark its subject as erased.
  // Scope each update by the member's household so a malformed/foreign id
  // cannot cause a cross-household redaction. This runs before the NO ACTION
  // member foreign keys are removed below.
  const subjectsByFamily = new Map<string, string[]>()
  if (familyId && current.length > 0) subjectsByFamily.set(familyId, [...current])
  for (const profile of historic) {
    const familySubjects = subjectsByFamily.get(profile.family_id) ?? []
    familySubjects.push(profile.id)
    subjectsByFamily.set(profile.family_id, familySubjects)
  }
  for (const [subjectFamilyId, subjectIds] of subjectsByFamily) {
    const subjectWhere = { family_id: subjectFamilyId, subject_member_id: { in: [...new Set(subjectIds)] } }
    await tx.activity.updateMany({
      where: subjectWhere,
      data: { subject_member_id: null, subject_member_erased: true },
    })
    await tx.deviceAuditEvent.updateMany({
      where: subjectWhere,
      data: { subject_member_id: null, subject_member_erased: true },
    })
  }
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
