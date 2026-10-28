import { storageBackend } from "@/lib/storage-backend";
import { authenticateWithFamily } from "@/lib/api-auth";
import { withChoreReads, type ChoreReadDb } from "@/lib/chore-read-scope";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { choreJson } from "@/lib/chore-json";
import { hiddenRoutineOccurrenceIds, scheduledOnceRoutineOccurrenceIds } from "@/lib/routine-occurrence-policy";
import { hydrateChoreProfileMembers, type ProfileHydrated } from "@/lib/chore-profile-read";
import { profileChoreActionAvailability, profileChoreReadRefusal, readChoreSubject } from "@/lib/chore-profile";
import { isGamificationOn, omitChorePoints } from "@/lib/gamification-visibility";
/** Internal canonical read. Caller supplies freshly authorized household; the
 * owned context path additionally renews original authority after these waits.
 */
export async function readCanonicalChoreDetail(id: string, familyId: string, request: NextRequest) {
  return withChoreReads(db => readChoreDetailFromReads(db, id, familyId, request));
}
async function readChoreDetailFromReads(db: ChoreReadDb, id: string, familyId: string, request: NextRequest) {
  const original = storageBackend() === "d1" ? await authenticateWithFamily(request) : null;
  if (original?.[1]) return original[1];
  if (original && original[0].user.family_id !== familyId) return choreJson({ error: 'Unauthorized' }, { status: 401 });
  const chore = await db.chore.findFirst({
    where: { id, family_id: familyId },
    include: {
      assignee: { select: { id: true, name: true, avatar_url: true, family_id: true } },
      creator: { select: { id: true, name: true, family_id: true } },
    },
  })
  if (!chore || (await hiddenRoutineOccurrenceIds(prisma!, familyId, { ids: [id] })).includes(id)) return choreJson({ error: 'Chore not found' }, { status: 404 })
  // A generated copy is stored as 'once'; the edit form shows its series' frequency.
  const template =
    chore.recurrence_id && chore.recurrence_id !== chore.id
      ? await db.chore.findFirst({
          where: { id: chore.recurrence_id, family_id: familyId },
          select: { id: true, frequency: true, weekly_days: true, rotation_member_ids: true },
        })
      : null
  // Take turns (O-39) is a series setting: on the template itself, or on the
  // template of a generated copy.
  const seriesRotation =
    (template ? template.rotation_member_ids : chore.recurrence_id === chore.id ? chore.rotation_member_ids : null) ?? []
  const profileRead = profileChoreReadRefusal(request)
  const hydrated: ProfileHydrated<typeof chore> = chore.assigned_member_id != null
    ? (await hydrateChoreProfileMembers(prisma!, familyId, [chore]))[0]
    : { ...chore, assigneeMember: undefined }
  if (chore.assigned_to === null && chore.assigned_member_id != null && profileRead) {
    return choreJson(profileRead.body, { status: profileRead.status, headers: { 'Cache-Control': 'private, no-store' } })
  }
  const subject = readChoreSubject(hydrated, familyId)
  if (!subject) {
    if (chore.assigned_to === null && chore.assigned_member_id != null) {
      return choreJson(profileRead?.body ?? { error: 'PROFILE_CHORE_SUBJECT_UNREADABLE' }, { status: profileRead?.status ?? 409 })
    }
    return choreJson({ error: 'Chore subject unavailable' }, { status: 409 })
  }
  const safeChore = (() => {
    const { assigneeMember: _member, ...stored } = hydrated
    const safe = { ...stored,
      assignee: hydrated.assignee?.family_id === familyId ? hydrated.assignee : null,
      creator: hydrated.creator?.family_id === familyId ? { id: hydrated.creator.id, name: hydrated.creator.name } : null,
    }
    return subject.kind === 'profile' ? { ...safe, subject } : safe
  })()
  const gamified = await isGamificationOn(familyId)
  const scheduledOnceIds = subject.kind === 'profile'
    ? await scheduledOnceRoutineOccurrenceIds(prisma!, familyId, [chore.id])
    : new Set<string>()
  const actionAvailability = subject.kind === 'profile' ? profileChoreActionAvailability(hydrated, scheduledOnceIds.has(chore.id) ? "scheduled-once" : "legacy") : null
  const projectedChore = subject.kind === 'profile' && actionAvailability ? { ...safeChore, actionAvailability } : safeChore
  if (original) {
    const auth = original[0];
    const { renewD1ChoreReadOwner } = await import("@/lib/cloudflare/chore-read-owner");
    if (!await renewD1ChoreReadOwner({ userId: auth.user.id, familyId, role: auth.user.role, generation: auth.payload.tv ?? 0 })) return choreJson({ error: 'Unauthorized' }, { status: 401 });
  }
  return choreJson({
    chore: gamified ? projectedChore : omitChorePoints(projectedChore),
    template: template ?? null,
    rotation: seriesRotation.length > 0 ? seriesRotation : null,
  })
}

