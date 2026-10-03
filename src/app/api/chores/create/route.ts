import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { notificationServiceServer } from '@/lib/notifications-server'
import { createChoreSchema } from '@/lib/validations'
import { expandSeriesInTx } from '@/lib/recurringChores'
import { rotationMembersInHousehold } from '@/lib/chore-rotation'
import { normalizeDateOnlyInput } from '@/lib/dates'
import { resolveChorePhotoForWrite } from '@/lib/chore-photos'
import { isGamificationOn, omitChorePoints } from '@/lib/gamification-visibility'
import { recordChoreAssigned } from '@/lib/beta-metrics'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // Only parents can create chores (mirrors the PATCH gate — kids shouldn't
    // be able to assign work or set their own point values)
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { title, description, points, due_date, difficulty, frequency, photo_url, icon, routine, routine_order } =
      parsed.data
    // Take turns (O-39): the first person in the order takes the first one,
    // whatever `assigned_to` says.
    const rotation = parsed.data.rotation ?? null
    const assigned_to = rotation ? rotation[0] : parsed.data.assigned_to!

    // due_date is a date-only value: store the UTC calendar day at midnight.
    const dueDate = normalizeDateOnlyInput(due_date)
    if (!dueDate) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }

    // Verify the assigned user belongs to the same family
    const assignee = await prisma!.user.findUnique({
      where: { id: assigned_to },
      select: { id: true, family_id: true, name: true },
    })

    if (!assignee || assignee.family_id !== auth.user.family_id) {
      return NextResponse.json({ error: 'Assigned user must be in your family' }, { status: 400 })
    }

    // Everyone taking turns must be in the caller's household (another
    // household's member reads the same as a missing one).
    if (rotation && !(await rotationMembersInHousehold(prisma!, auth.user.family_id, rotation))) {
      return NextResponse.json({ error: 'Everyone taking turns must be in your family' }, { status: 400 })
    }

    // D3 (#102): a photo must be an upload owned by the caller's family.
    const photo = await resolveChorePhotoForWrite(auth.user.family_id, photo_url)
    if (!photo.ok) {
      return NextResponse.json({ error: photo.error }, { status: 400 })
    }

    const include = {
      assignee: { select: { id: true, name: true, avatar_url: true, role: true } },
      creator: { select: { id: true, name: true, avatar_url: true, role: true } },
    } as const

    // One transaction: the chore, its series link (a repeating chore is the
    // template of its own series, so expansion and the top-up agree on which
    // rows are templates, #184) and its first window of occurrences. Before,
    // these were three writes and a failure after the first was only logged,
    // so a "weekly" chore that never repeated was reported as created.
    const newChore = await prisma!.$transaction(async (tx) => {
      const created = await tx.chore.create({
        data: {
          family_id: auth.user.family_id,
          title,
          description: description || null,
          points,
          assigned_to,
          due_date: dueDate,
          difficulty,
          frequency,
          status: 'pending',
          created_by: auth.user.id,
          photo_url: photo.value ?? null,
          // Picture routines (#272); recurring generation copies them.
          icon: icon ?? null,
          routine: routine ?? null,
          routine_order: routine_order ?? null,
        },
        include,
      })
      if (frequency === 'once') return created
      const template = await tx.chore.update({
        where: { id: created.id },
        data: {
          recurrence_id: created.id,
          is_template: true,
          // The template is the series' first occurrence: the first turn.
          ...(rotation ? { rotation_member_ids: rotation, rotation_index: 0 } : {}),
        },
        include,
      })
      await expandSeriesInTx(tx, created.id, auth.user.family_id)
      return template
    })

    // Beta usage counts (#287): after the write; never fails the request.
    await recordChoreAssigned(prisma!, auth.user.family_id, newChore)

    // Send notification to assigned user
    if (newChore.assignee && newChore.creator) {
      try {
        await notificationServiceServer.notifyChoreAssignment(
          newChore,
          newChore.assignee,
          newChore.creator
        )
      } catch (err) {
        logRouteError('POST /api/chores/create (assignment notification)', err, getRequestId(request))
      }
    }

    // Points & streaks off (#248): the points value is stored but not echoed.
    if (!(await isGamificationOn(auth.user.family_id))) {
      return NextResponse.json({ chore: omitChorePoints(newChore) })
    }

    return NextResponse.json({ chore: newChore })
  } catch (error) {
    logRouteError('POST /api/chores/create', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
