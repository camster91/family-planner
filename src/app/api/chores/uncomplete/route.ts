import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { uncompleteChoreSchema } from '@/lib/validations'

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
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = uncompleteChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { choreId } = parsed.data

    const chore = await prisma!.chore.findUnique({ where: { id: choreId } })
    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (auth.user.role !== 'parent' && chore.assigned_to !== auth.user.id) {
      return NextResponse.json({ error: 'Only parents or the assignee can undo this chore' }, { status: 403 })
    }

    if (chore.status === 'verified') {
      return NextResponse.json(
        { error: 'A parent has already checked this chore, so it stays done.', code: 'CHORE_ALREADY_VERIFIED' },
        { status: 409 }
      )
    }

    const outcome = await prisma!.$transaction(async (tx) => {
      // Read the recorded successor in the same transaction as the reopen.
      const before = await tx.chore.findUnique({ where: { id: choreId }, select: { successor_id: true } })
      const result = await tx.chore.updateMany({
        where: { id: choreId, status: 'completed' },
        data: { status: 'pending', completed_at: null, successor_id: null },
      })
      if (result.count === 0) {
        // Lost the race (or nothing to undo): report what the row is now, so a
        // parent's verify that landed in between is a 409, not a false success.
        const current = await tx.chore.findUnique({ where: { id: choreId }, select: { status: true } })
        return current?.status === 'verified' ? 'verified' : 'open'
      }

      // A legacy recurring one-off created its next occurrence on completion
      // and recorded its id. Remove exactly that row while it is still an
      // untouched pending one-off of this household; anything else stays.
      if (before?.successor_id) {
        await tx.chore.deleteMany({
          where: { id: before.successor_id, family_id: chore.family_id, status: 'pending', recurrence_id: null },
        })
      }
      return 'reopened'
    })

    if (outcome === 'verified') {
      return NextResponse.json(
        { error: 'A parent has already checked this chore, so it stays done.', code: 'CHORE_ALREADY_VERIFIED' },
        { status: 409 }
      )
    }
    if (outcome === 'open') {
      return NextResponse.json({ success: true, alreadyOpen: true })
    }
    return NextResponse.json({ success: true, choreId, status: 'pending' })
  } catch (error) {
    console.error('Error reopening chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
