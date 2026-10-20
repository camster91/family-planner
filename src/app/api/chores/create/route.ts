import { choreJson } from "@/lib/chore-json";
import { nextSelectedWeekday } from '@/lib/chore-weekdays'
import { NextRequest } from 'next/server'
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
import { lockHousehold, lockUser } from '@/lib/household-lock'
import { choreAssigneeForCreateInTx } from '@/lib/chore-member-subject'
import { HouseholdMemberIdentityConflict } from '@/lib/household-member-lifecycle'
import {
  createProfileOnlyChoreEffect,
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
  profileChoreCreateSchema,
  profileChoreProtocolRefusal,
  ProfileChoreError,
  PROFILE_CHORE_UNSUPPORTED_CODE,
} from '@/lib/chore-profile'
import { idempotencyError, readIdempotencyKey, withIdempotency } from '@/lib/idempotency'

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
      return choreJson({ error: 'Invalid JSON' }, { status: 400 })
    }
    // Profile assignment is an explicit, gated protocol-2 branch. Do not pass
    // it through the legacy schema: that would either reject a valid profile
    // target or, worse, infer an account from a member id.
    if (body && typeof body === 'object' && !Array.isArray(body) && (body.protocol !== undefined || body.selection !== undefined)) {
      if (!isProfileChoreEnabled()) {
        return choreJson(
          { error: PROFILE_CHORE_UNSUPPORTED_CODE, ...profileChoreProtocolRefusal() },
          { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
      const profile = profileChoreCreateSchema.safeParse(body)
      if (!profile.success) {
        return choreJson({ error: 'The profile chore request is not valid.' }, { status: 400 })
      }
      // Keep recurring profile writes behind their own private rollout gate.
      // This check intentionally precedes idempotency-key lookup so a cached
      // response cannot replay after the recurrence capability is withdrawn.
      if (profile.data.frequency !== 'once' && !isProfileChoreRecurrenceSupported()) {
        return choreJson(
          { error: PROFILE_CHORE_UNSUPPORTED_CODE, ...profileChoreProtocolRefusal() },
          { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
      const { key, error: keyError } = readIdempotencyKey(request)
      if (keyError) return keyError
      if (!key) return idempotencyError('IDEMPOTENCY_KEY_REQUIRED')
      const startDate = normalizeDateOnlyInput(profile.data.due_date)
      const dueDate = startDate && profile.data.frequency === 'weekly'
        ? nextSelectedWeekday(startDate, profile.data.weekly_days, true)
        : startDate
      if (!dueDate) return choreJson({ error: 'Invalid date' }, { status: 400 })
      const photo = await resolveChorePhotoForWrite(auth.user.family_id, profile.data.photo_url)
      if (!photo.ok) return choreJson({ error: photo.error }, { status: 400 })
      const response = await withIdempotency(
        prisma!,
        key,
        { scope: `user:${auth.user.id}`, familyId: auth.user.family_id, userId: auth.user.id, action: 'chore.profile.create' },
        profile.data,
        ({ recordId }) =>
          createProfileOnlyChoreEffect(
            prisma!,
            { id: auth.user.id, familyId: auth.user.family_id },
            profile.data,
            dueDate,
            photo.value ?? null,
            recordId,
          ),
        {
          // A completed receipt contains private household data. Re-check the
          // live actor under the same membership locks before replaying it.
          beforeReplay: () =>
            prisma!.$transaction(async (tx) => {
              await lockUser(tx, auth.user.id)
              await lockHousehold(tx, auth.user.family_id)
              const currentActor = await tx.user.findUnique({
                where: { id: auth.user.id },
                select: { family_id: true, role: true },
              })
              if (
                !currentActor ||
                currentActor.family_id !== auth.user.family_id ||
                currentActor.role !== 'parent'
              ) {
                return {
                  status: 404,
                  body: { error: 'PROFILE_TARGET_UNAVAILABLE' },
                }
              }
              return null
            }),
        },
      )
      return response
    }

    const parsed = createChoreSchema.safeParse(body)
    if (!parsed.success) {
      return choreJson({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { title, description, points, due_date, difficulty, frequency, photo_url, icon, routine, routine_order } =
      parsed.data
    // Take turns (O-39): the first person in the order takes the first one,
    // whatever `assigned_to` says.
    const rotation = parsed.data.rotation ?? null
    const assigned_to = rotation ? rotation[0] : parsed.data.assigned_to!

    // due_date is a date-only value: store the UTC calendar day at midnight.
    const startDate = normalizeDateOnlyInput(due_date)
    const dueDate = startDate && frequency === 'weekly' && parsed.data.weekly_days ? nextSelectedWeekday(startDate, parsed.data.weekly_days, true) : startDate
    if (!dueDate) {
      return choreJson({ error: 'Invalid date' }, { status: 400 })
    }

    // Verify the assigned user belongs to the same family
    const assignee = await prisma!.user.findUnique({
      where: { id: assigned_to },
      select: { id: true, family_id: true, name: true },
    })

    if (!assignee || assignee.family_id !== auth.user.family_id) {
      return choreJson({ error: 'Assigned user must be in your family' }, { status: 400 })
    }

    // Everyone taking turns must be in the caller's household (another
    // household's member reads the same as a missing one).
    if (rotation && !(await rotationMembersInHousehold(prisma!, auth.user.family_id, rotation))) {
      return choreJson({ error: 'Everyone taking turns must be in your family' }, { status: 400 })
    }

    // D3 (#102): a photo must be an upload owned by the caller's family.
    const photo = await resolveChorePhotoForWrite(auth.user.family_id, photo_url)
    if (!photo.ok) {
      return choreJson({ error: photo.error }, { status: 400 })
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
      // Match removal/join lock order. Validation above gives fast feedback;
      // this validation is authoritative for the write and series expansion.
      const memberIds = [...new Set([auth.user.id, assigned_to, ...(rotation ?? [])])].sort()
      for (const id of memberIds) await lockUser(tx, id)
      await lockHousehold(tx, auth.user.family_id)
      const currentActor = await tx.user.findUnique({ where: { id: auth.user.id }, select: { family_id: true, role: true } })
      if (currentActor?.family_id !== auth.user.family_id || currentActor.role !== 'parent') return 'actor-left' as const
      const currentAssignee = await tx.user.findUnique({ where: { id: assigned_to }, select: { family_id: true } })
      if (currentAssignee?.family_id !== auth.user.family_id) return 'member-left' as const
      if (rotation && !(await rotationMembersInHousehold(tx, auth.user.family_id, rotation))) return 'member-left' as const
      const created = await tx.chore.create({
        data: {
          family_id: auth.user.family_id,
          title,
          description: description || null,
          points,
          ...(await choreAssigneeForCreateInTx(tx, auth.user.family_id, assigned_to)),
          due_date: dueDate,
          difficulty,
          frequency,
          weekly_days: parsed.data.weekly_days ?? [],
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
    if (newChore === 'actor-left') return choreJson({ error: 'Only a parent of this household can create chores' }, { status: 403 })
    if (newChore === 'member-left') return choreJson({ error: 'Assigned users must still be in your family' }, { status: 400 })

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
      return choreJson({ chore: omitChorePoints(newChore) })
    }

    return choreJson({ chore: newChore })
  } catch (error) {
    if (error instanceof ProfileChoreError) {
      const status = error.code === 'PROFILE_TARGET_CONFLICT' ? 409 : error.code === 'PROFILE_TARGET_UNAVAILABLE' ? 404 : 400
      return choreJson({ error: error.code }, { status })
    }
    if (error instanceof HouseholdMemberIdentityConflict) return choreJson({ error: error.message, code: 'IDENTITY_CONFLICT' }, { status: 409 })
    logRouteError('POST /api/chores/create', error, getRequestId(request))
    return choreJson({ error: 'Internal server error' }, { status: 500 })
  }
}
