import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { notificationServiceServer } from '@/lib/notifications-server'
import { completeChoreSchema } from '@/lib/validations'
// Shared date rule, so completion and the cron expander cannot disagree (#184).
import { expandSeriesInTx, nextDueDate as nextDueDateForCompletion } from '@/lib/recurringChores'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = completeChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { choreId, photoUrl } = parsed.data

    // Get the chore and verify family ownership
    const chore = await prisma!.chore.findUnique({
      where: { id: choreId },
      include: {
        assignee: { select: { id: true, name: true, avatar_url: true, role: true } },
        creator: { select: { id: true, name: true, avatar_url: true, role: true } },
      },
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    // Complete only from a state that has not already been completed OR
    // verified (#185).
    //
    // The previous predicate was `status: { not: 'completed' }`, which a
    // `verified` chore still matched — so completing a verified chore reset it
    // to `completed`, and the next verify awarded XP a second time. Combined
    // with the fact that any family member may complete, that made XP farmable:
    // complete -> verify -> complete -> verify.
    //
    // An explicit allowlist of source states closes it. `completed` and
    // `verified` are both no-ops, so a repeat click is still idempotent.
    //
    // Status change, activity and successor all commit together, so a failure
    // creating the next occurrence cannot leave the chore completed with no
    // successor (the old code committed the status update first, on its own).
    const completed = await prisma!.$transaction(async (tx) => {
      const updateResult = await tx.chore.updateMany({
        where: { id: choreId, status: { in: ['pending', 'in_progress', 'overdue'] } },
        data: {
          status: 'completed',
          completed_at: new Date(),
          ...(photoUrl ? { photo_url: photoUrl, photo_verified: false } : {}),
        },
      })

      // Either already completed/verified, or in a state that cannot be
      // completed. No XP is awarded here in either case — verify is the only
      // path that awards XP.
      if (updateResult.count === 0) return false

      await tx.activity.create({
        data: {
          family_id: auth.user.family_id,
          user_id: auth.user.id,
          type: 'chore_completed',
          title: `${auth.user.name} completed "${chore.title}"`,
        },
      })

      // Handle recurring chores — make sure the next occurrence exists.
      //
      // A series template (recurrence_id set) is topped up with the SAME series
      // logic the create route and the cron use, so its successor carries
      // `recurrence_id` and the (recurrence_id, due_date) unique constraint
      // dedups it. Previously this path inserted the next occurrence with
      // recurrence_id null, duplicating the D+1 row the create route had
      // already generated for the series.
      if (chore.frequency && chore.frequency !== 'once') {
        if (chore.recurrence_id) {
          await expandSeriesInTx(tx, chore.recurrence_id, chore.family_id)
        } else {
          // Legacy recurring row with no series: keep the old single-successor
          // behaviour. The date rule is shared with the expander (#184), and
          // the row is a one-off so the cron never re-expands it.
          const nextDueDate = nextDueDateForCompletion(new Date(chore.due_date), chore.frequency)
          if (nextDueDate) {
            await tx.chore.create({
              data: {
                family_id: chore.family_id,
                title: chore.title,
                description: chore.description,
                points: chore.points,
                assigned_to: chore.assigned_to,
                due_date: nextDueDate,
                status: 'pending',
                frequency: 'once',
                difficulty: chore.difficulty,
                created_by: chore.created_by,
              },
            })
          }
        }
      }

      return true
    })

    if (!completed) {
      return NextResponse.json({ success: true, alreadyCompleted: true })
    }

    return NextResponse.json({
      success: true,
      choreId,
    })
  } catch (error) {
    console.error('Error completing chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
