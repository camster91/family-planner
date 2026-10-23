import { choreJson } from "@/lib/chore-json";
import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { uncompleteChoreSchema } from '@/lib/validations'
import { reopenCompletedChoreInTx } from '@/lib/chore-reopen'
import { HouseholdMemberIdentityConflict } from '@/lib/household-member-lifecycle'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { profileChoreLegacyWriteRefusal } from '@/lib/chore-profile'

export const dynamic = 'force-dynamic'

/**
 * POST /api/chores/uncomplete — Undo for a chore tick (#268, #269 "undo over
 * confirm"). Puts a `completed` chore back to `pending`.
 *
 * - Parent, or the chore's assignee. A sibling cannot reopen someone else's chore.
 * - Only from `completed` (done, waiting for a parent to check). A `verified`
 *   chore has had its XP awarded by a parent, so it is 409
 *   `CHORE_ALREADY_VERIFIED` and nothing changes.
 * - Already open: a no-op success (`alreadyOpen: true`), so a repeated Undo is safe.
 * - Completing a legacy recurring one-off (no series) created the next
 *   occurrence and stored its id in `successor_id`; Undo removes exactly that
 *   row while it is still pending, so completing again does not create a
 *   duplicate. Series occurrences are deduplicated by (recurrence_id,
 *   due_date) and are left alone. A chore completed before `successor_id`
 *   existed has none, and Undo removes nothing.
 * - If a parent verifies between the check above and the update, the update
 *   loses and the route re-reads the row: 409, never a false success.
 */
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return choreJson({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = uncompleteChoreSchema.safeParse(body)
    if (!parsed.success) {
      return choreJson({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { choreId } = parsed.data

    const chore = await prisma!.chore.findUnique({ where: { id: choreId } })
    if (!chore) {
      return choreJson({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError
    if (chore.assigned_to === null && chore.assigned_member_id != null) {
      return choreJson(profileChoreLegacyWriteRefusal(), { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
    }

    if (auth.user.role !== 'parent' && chore.assigned_to !== auth.user.id) {
      return choreJson({ error: 'Only parents or the assignee can undo this chore' }, { status: 403 })
    }

    if (chore.status === 'verified') {
      return choreJson(
        { error: 'A parent has already checked this chore, so it stays done.', code: 'CHORE_ALREADY_VERIFIED' },
        { status: 409 }
      )
    }

    const outcome = await prisma!.$transaction((tx) => reopenCompletedChoreInTx(tx, chore))

    if (outcome === 'verified') {
      return choreJson(
        { error: 'A parent has already checked this chore, so it stays done.', code: 'CHORE_ALREADY_VERIFIED' },
        { status: 409 }
      )
    }
    if (outcome === 'open') {
      return choreJson({ success: true, alreadyOpen: true })
    }
    return choreJson({ success: true, choreId, status: 'pending' })
  } catch (error) {
    if (error instanceof HouseholdMemberIdentityConflict) return choreJson({ error: error.message, code: 'IDENTITY_CONFLICT' }, { status: 409 })
    logRouteError('POST /api/chores/uncomplete', error, getRequestId(request))
    return choreJson({ error: 'Internal server error' }, { status: 500 })
  }
}
