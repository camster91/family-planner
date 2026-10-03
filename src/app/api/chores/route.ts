import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { deleteChoreSchema, updateChoreSchema } from '@/lib/validations'
import { normalizeDateOnlyInput } from '@/lib/dates'
import { resolveChorePhotoForWrite } from '@/lib/chore-photos'
import { isGamificationOn, omitChorePoints } from '@/lib/gamification-visibility'
import { apiError, logRouteError } from '@/lib/api-error'
import {
  CHORE_UNPAGED_MAX,
  afterChoreCursor,
  choreOrderBy,
  encodeChoreCursor,
  parseChoreDateRange,
  parseChorePaging,
} from '@/lib/chore-paging'
import { getRequestId } from '@/lib/request-id'
import { applyFrequencyEditInTx } from '@/lib/recurringChores'
import { applyRotationEditInTx, rotationMembersInHousehold } from '@/lib/chore-rotation'

export const dynamic = 'force-dynamic'

// GET - List chores for the user's family.
// Opt-in paging (O-19): `?limit=1..200[&cursor=][&order=asc|desc]` returns
// `{ chores, nextCursor }` ordered by due date then id (`desc`: newest first;
// default `asc`). Without `limit` the response shape is unchanged
// (installed Android builds): chores ordered by due date, no `nextCursor`, but
// capped at the latest CHORE_UNPAGED_MAX by due date.
// Optional `from` / `to` (`YYYY-MM-DD`, inclusive) filter on the due date.
// `?id=<id>` returns `{ chore, template, rotation }` for one chore of the
// household (`template`: `{ id, frequency, rotation_member_ids }` of its
// series' template when the chore is a generated copy, else null; `rotation`:
// the series' take-turns order, O-38, or null), or 404.
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (id !== null) return getOneChore(id, auth.user.family_id)

    const status = searchParams.get('status')
    const assigned_to = searchParams.get('assigned_to')
    const paging = parseChorePaging(searchParams)
    if (!paging.ok) return apiError(400, 'INVALID_QUERY', paging.error, { requestId: getRequestId(request) })
    const range = parseChoreDateRange(searchParams)
    if (!range.ok) return apiError(400, 'INVALID_QUERY', range.error, { requestId: getRequestId(request) })

    const where: Record<string, unknown> = { family_id: auth.user.family_id }
    if (status) where.status = status
    if (assigned_to) where.assigned_to = assigned_to
    if (range.from || range.toExclusive) {
      where.due_date = {
        ...(range.from ? { gte: range.from } : {}),
        ...(range.toExclusive ? { lt: range.toExclusive } : {}),
      }
    }
    if (paging.paged && paging.cursor) where.AND = [afterChoreCursor(paging.cursor, paging.order)]

    const include = {
      assignee: { select: { id: true, name: true, avatar_url: true } },
      creator: { select: { id: true, name: true } },
    }
    const rows = paging.paged
      ? await prisma!.chore.findMany({
          where,
          include,
          orderBy: choreOrderBy(paging.order),
          take: paging.limit + 1,
        })
      : // Unpaged: the latest CHORE_UNPAGED_MAX by due date, returned oldest first.
        (
          await prisma!.chore.findMany({
            where,
            include,
            orderBy: [{ due_date: 'desc' }, { id: 'desc' }],
            take: CHORE_UNPAGED_MAX,
          })
        ).reverse()

    const hasMore = paging.paged && rows.length > paging.limit
    const chores = hasMore ? rows.slice(0, paging.limit) : rows
    const page = paging.paged
      ? { nextCursor: hasMore ? encodeChoreCursor(chores[chores.length - 1]) : null }
      : {}

    // Points & streaks off for this family (#248): the chore's points value is
    // not sent. It is still stored, and verify still awards XP from it.
    if (!(await isGamificationOn(auth.user.family_id))) {
      return NextResponse.json({ chores: chores.map(omitChorePoints), ...page })
    }

    return NextResponse.json({ chores, ...page })
  } catch (error) {
    logRouteError('GET /api/chores', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** `GET /api/chores?id=`: one chore of the caller's household (another household's reads as missing). */
async function getOneChore(id: string, familyId: string) {
  const chore = await prisma!.chore.findFirst({
    where: { id, family_id: familyId },
    include: {
      assignee: { select: { id: true, name: true, avatar_url: true } },
      creator: { select: { id: true, name: true } },
    },
  })
  if (!chore) return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
  // A generated copy is stored as 'once'; the edit form shows its series' frequency.
  const template =
    chore.recurrence_id && chore.recurrence_id !== chore.id
      ? await prisma!.chore.findFirst({
          where: { id: chore.recurrence_id, family_id: familyId },
          select: { id: true, frequency: true, rotation_member_ids: true },
        })
      : null
  // Take turns (O-38) is a series setting: on the template itself, or on the
  // template of a generated copy.
  const seriesRotation =
    (template ? template.rotation_member_ids : chore.recurrence_id === chore.id ? chore.rotation_member_ids : null) ?? []
  const gamified = await isGamificationOn(familyId)
  return NextResponse.json({
    chore: gamified ? chore : omitChorePoints(chore),
    template: template ?? null,
    rotation: seriesRotation.length > 0 ? seriesRotation : null,
  })
}

// PATCH - Update a chore (family-scoped, parent or assignee). Details only:
// `updateChoreSchema` drops `status` and the verify fields, so status changes
// only through the shared helpers (`completeChore` behind /api/chores/complete,
// `reopenCompletedChoreInTx` behind /uncomplete and the verify reject; route
// inventory F-6, #289; pinned by __tests__/status-single-path.test.ts).
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = updateChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { choreId, ...updates } = parsed.data

    // due_date is a date-only value (UTC midnight). Accept `YYYY-MM-DD` or a
    // timestamp, but always store the UTC calendar day, never a time of day.
    let dueDate: Date | undefined
    if (updates.due_date !== undefined) {
      const normalized = normalizeDateOnlyInput(updates.due_date)
      if (!normalized) {
        return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
      }
      dueDate = normalized
    }

    const chore = await prisma!.chore.findUnique({
      where: { id: choreId },
      select: { family_id: true, assigned_to: true, photo_url: true, frequency: true, recurrence_id: true },
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (auth.user.role !== 'parent' && chore.assigned_to !== auth.user.id) {
      return NextResponse.json({ error: 'Only parents or the assignee can edit chores' }, { status: 403 })
    }

    // Fields a non-parent assignee must not change (#185).
    //
    // The assignee may edit their own chore, but `points` decides how much XP
    // verify awards and `assigned_to` decides who receives it. Letting a child
    // set either meant they could inflate points before verification, or point
    // the chore at any user id they could guess. Both are privilege boundaries,
    // not cosmetic edits. `difficulty` feeds the XP multiplier the same way,
    // so it is parent-only too.
    // `rotation` (take turns, O-38) decides who gets every future copy, so it
    // is parent-only like `assigned_to`.
    const PARENT_ONLY_FIELDS = ['points', 'difficulty', 'assigned_to', 'frequency', 'rotation'] as const
    if (auth.user.role !== 'parent') {
      const attempted = PARENT_ONLY_FIELDS.filter((f) => updates[f] !== undefined)
      if (attempted.length > 0) {
        return NextResponse.json(
          { error: `Only parents can change: ${attempted.join(', ')}` },
          { status: 403 }
        )
      }
    }

    // A new assignee must be a member of the same family, whatever the caller's
    // role. Without this a parent could accidentally (or a crafted request could
    // deliberately) assign a chore to a user in another household.
    if (updates.assigned_to !== undefined) {
      if (updates.assigned_to !== chore.assigned_to) {
        const assignee = await prisma!.user.findFirst({
          where: { id: updates.assigned_to, family_id: auth.user.family_id },
          select: { id: true },
        })
        if (!assignee) {
          return NextResponse.json(
            { error: 'Assignee must be a member of your family' },
            { status: 400 }
          )
        }
      }
    }

    // Everyone taking turns must be in the caller's household (O-38); another
    // household's member reads the same as a missing one.
    const rotation = updates.rotation
    if (rotation && !(await rotationMembersInHousehold(prisma!, auth.user.family_id, rotation))) {
      return NextResponse.json({ error: 'Everyone taking turns must be in your family' }, { status: 400 })
    }

    // D3 (#102): a new photo must be an upload owned by the caller's family.
    // Re-sending the chore's current value (an edit form posting back what it
    // loaded, including a legacy file with no Upload row) is left unchanged.
    const photo = await resolveChorePhotoForWrite(auth.user.family_id, updates.photo_url, chore.photo_url)
    if (!photo.ok) {
      return NextResponse.json({ error: photo.error }, { status: 400 })
    }

    const data: Record<string, unknown> = {}
    if (updates.title !== undefined) data.title = updates.title
    if (updates.description !== undefined) data.description = updates.description
    if (updates.points !== undefined) data.points = updates.points
    if (updates.assigned_to !== undefined) data.assigned_to = updates.assigned_to
    if (dueDate !== undefined) data.due_date = dueDate
    if (updates.difficulty !== undefined) data.difficulty = updates.difficulty
    // `frequency` is applied below by `applyFrequencyEditInTx`, which also
    // starts, re-times or stops the recurring series.
    if (photo.value !== undefined) data.photo_url = photo.value
    // Picture routines (#272): null clears. Like the title, the assignee may
    // change them; they carry no XP or privilege.
    if (updates.icon !== undefined) data.icon = updates.icon
    if (updates.routine !== undefined) data.routine = updates.routine
    if (updates.routine_order !== undefined) data.routine_order = updates.routine_order

    const include = {
      assignee: { select: { id: true, name: true, avatar_url: true } },
      creator: { select: { id: true, name: true } },
    } as const
    // One transaction: the edit and any series change (once -> repeating
    // starts a series; a template set to 'once' stops it, O-33) commit together.
    // Take turns (O-38) applies to the whole series, after any frequency
    // change in the same request (so "once -> weekly, take turns" works).
    const frequency = updates.frequency
    let updated
    try {
      updated =
        frequency === undefined && rotation === undefined
          ? await prisma!.chore.update({ where: { id: choreId }, data, include })
          : await prisma!.$transaction(async (tx) => {
              if (Object.keys(data).length > 0) await tx.chore.update({ where: { id: choreId }, data })
              if (frequency !== undefined) {
                await applyFrequencyEditInTx(
                  tx,
                  { id: choreId, family_id: chore.family_id, frequency: chore.frequency, recurrence_id: chore.recurrence_id },
                  frequency,
                  { applyToSeries: updates.apply_to_series === true }
                )
              }
              if (rotation !== undefined) {
                const row = await tx.chore.findUniqueOrThrow({ where: { id: choreId }, select: { recurrence_id: true } })
                const template = row.recurrence_id
                  ? await tx.chore.findFirst({
                      where: { id: row.recurrence_id, family_id: chore.family_id, is_template: true },
                      select: { id: true },
                    })
                  : null
                if (template) {
                  await applyRotationEditInTx(tx, template.id, chore.family_id, rotation ?? [])
                } else if (rotation) {
                  throw new RotationNeedsSeriesError()
                }
              }
              return tx.chore.findUniqueOrThrow({ where: { id: choreId }, include })
            })
    } catch (err) {
      if (err instanceof RotationNeedsSeriesError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }

    if (!(await isGamificationOn(auth.user.family_id))) {
      return NextResponse.json({ chore: omitChorePoints(updated) })
    }

    return NextResponse.json({ chore: updated })
  } catch (error) {
    logRouteError('PATCH /api/chores', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Take turns on a chore that does not repeat; rolls the edit back. */
class RotationNeedsSeriesError extends Error {
  constructor() {
    super('Taking turns needs a chore that repeats')
  }
}

// DELETE - Delete a chore (family-scoped)
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = deleteChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'choreId is required' }, { status: 400 })
    }

    // Verify the chore belongs to the user's family
    const chore = await prisma!.chore.findUnique({
      where: { id: parsed.data.choreId },
      select: { family_id: true, assigned_to: true },
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (auth.user.role !== 'parent' && chore.assigned_to !== auth.user.id) {
      return NextResponse.json({ error: 'Only parents or the assignee can delete chores' }, { status: 403 })
    }

    await prisma!.chore.delete({
      where: { id: parsed.data.choreId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logRouteError('DELETE /api/chores', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
