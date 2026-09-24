import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { notificationServiceServer } from '@/lib/notifications-server'
import { completeChoreSchema } from '@/lib/validations'
// Shared date rule, so completion and the cron expander cannot disagree (#184).
import { nextDueDate as nextDueDateForCompletion } from '@/lib/recurringChores'

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
    const updateResult = await prisma!.chore.updateMany({
      where: { id: choreId, status: { in: ['pending', 'in_progress', 'overdue'] } },
      data: {
        status: 'completed',
        completed_at: new Date(),
        ...(photoUrl ? { photo_url: photoUrl, photo_verified: false } : {}),
      },
    })

    if (updateResult.count === 0) {
      // Either already completed/verified, or in a state that cannot be
      // completed. No XP is awarded here in either case — verify is the only
      // path that awards XP.
      return NextResponse.json({ success: true, alreadyCompleted: true })
    }

    // Record activity and create next occurrence atomically
    await prisma!.$transaction(async (tx) => {
      await tx.activity.create({
        data: {
          family_id: auth.user.family_id,
          user_id: auth.user.id,
          type: 'chore_completed',
          title: `${auth.user.name} completed "${chore.title}"`,
        },
      })

      // Handle recurring chores — create the next occurrence.
      //
      // The date rule is shared with the expander (#184). Previously this path
      // advanced monthly with `setMonth(+1)` while the expander used
      // `setDate(+30)`, so the two produced different dates for the same chore.
      //
      // The row is inserted with `frequency: 'once'` for the same reason the
      // expander does: a generated occurrence is a one-off, and only the
      // template the user created recurs. Leaving `frequency` on instances is
      // what let the cron re-expand its own output and multiply the series.
      if (chore.frequency && chore.frequency !== 'once') {
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
              // One-off occurrence, so the cron never re-expands it.
              frequency: 'once',
              difficulty: chore.difficulty,
              created_by: chore.created_by,
            },
          })
        }
      }
    })

    return NextResponse.json({
      success: true,
      choreId,
    })
  } catch (error) {
    console.error('Error completing chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
