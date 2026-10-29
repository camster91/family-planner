import { storageBackend } from "@/lib/storage-backend";
import { transitionD1AccountChore } from "@/lib/cloudflare/chore-state";
import { recordBetaMetric } from "@/lib/beta-metrics";
import { choreJson } from "@/lib/chore-json";
import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { completeChoreSchema } from '@/lib/validations'
import { resolveChorePhotoForWrite } from '@/lib/chore-photos'
import { COMPLETABLE_CHORE_SELECT, completeChore } from '@/lib/chore-complete'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { profileChoreLegacyWriteRefusal } from '@/lib/chore-profile'

import { HouseholdMemberIdentityConflict } from '@/lib/household-member-lifecycle'
import { RoutineOccurrenceUnavailableError } from '@/lib/routine-occurrence-policy'

export const dynamic = 'force-dynamic'

/**
 * POST /api/chores/complete. PostgreSQL uses `completeChore`, shared with
 * the paired tablet. The D1 account adapter preserves its open-state, repeat
 * no-op and recurrence rules in one native batch. Device credentials retain
 * their separate protocol; only a parent's verification awards XP.
 */
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    let body: any
    try {
      body = await request.json()
    } catch {
      return choreJson({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = completeChoreSchema.safeParse(body)
    if (!parsed.success) {
      return choreJson({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { choreId, photoUrl } = parsed.data

    if (storageBackend() === 'd1') {
      const result = await transitionD1AccountChore({ userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload.tv ?? 0 }, { kind: 'complete', choreId, photoUrl })
      if (result.completed) await recordBetaMetric(prisma!, auth.user.family_id, 'chore_completed', { now: result.completedAt })
      return choreJson(result.body, { status: result.status })
    }

    const chore = await prisma!.chore.findUnique({ where: { id: choreId }, select: COMPLETABLE_CHORE_SELECT })
    if (!chore) {
      return choreJson({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError
    if (chore.assigned_to === null && chore.assigned_member_id != null) {
      return choreJson(profileChoreLegacyWriteRefusal(), { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
    }

    // D3 (#102): a completion photo must be an upload owned by the caller's
    // family. Checked before the transaction so a bad photo changes nothing.
    const photo = await resolveChorePhotoForWrite(auth.user.family_id, photoUrl, chore.photo_url)
    if (!photo.ok) {
      return choreJson({ error: photo.error }, { status: 400 })
    }

    const completed = await completeChore(
      prisma!,
      chore,
      { id: auth.user.id, name: auth.user.name },
      { photoValue: photo.value }
    )

    if (!completed) {
      return choreJson({ success: true, alreadyCompleted: true })
    }

    return choreJson({
      success: true,
      choreId,
    })
  } catch (error) {
    if (error instanceof RoutineOccurrenceUnavailableError) return choreJson({ error: { code: error.code, message: error.message } }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
    if (error instanceof HouseholdMemberIdentityConflict) return choreJson({ error: error.message, code: 'IDENTITY_CONFLICT' }, { status: 409 })
    logRouteError('POST /api/chores/complete', error, getRequestId(request))
    return choreJson({ error: 'Internal server error' }, { status: 500 })
  }
}
