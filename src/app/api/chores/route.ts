import { deleteD1Chore, D1ChoreDeleteReceiptError } from '@/lib/cloudflare/chore-delete'
import { storageBackend } from "@/lib/storage-backend";
import { withChoreReads, type ChoreReadDb } from "@/lib/chore-read-scope";
import { readCanonicalChoreDetail } from "@/lib/chore-detail-read";
import { hydrateChoreProfileMembers, type ProfileHydrated } from "@/lib/chore-profile-read";
import { assistantSourceGuard, AssistantSourceRefused } from '@/lib/assistant-source-proof'
import { assistantDeleteTargetGuard } from '@/lib/assistant-delete-target'
import { deletePersonRecord, authorizePersonDeleteReplay } from '@/lib/person-record-delete'
import { idempotencyError, readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import {
  hiddenRoutineOccurrenceIds,
  scheduledOnceRoutineOccurrenceIds,
} from "@/lib/routine-occurrence-policy";
import { refuseScheduledRoutineLegacyWrite, RoutineScheduleLegacyWriteError } from "@/lib/routine-schedule-legacy";
import { choreJson } from "@/lib/chore-json";
import { readVisibleChoreRows } from "@/lib/chore-visible-read";
import { withRouteTelemetry } from '@/lib/route-telemetry'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { lockHousehold, lockUser } from '@/lib/household-lock'
import { canonicalChoreAssigneeInTx } from '@/lib/chore-member-subject'
import { HouseholdMemberIdentityConflict } from '@/lib/household-member-lifecycle'
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
import { profileChoreActionAvailability, profileChoreLegacyWriteRefusal, profileChoreReadRefusal, readChoreSubject } from '@/lib/chore-profile'

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
// the series' take-turns order, O-39, or null), or 404.
export const GET = withRouteTelemetry('/api/chores', handleGET)

async function handleGET(request: NextRequest) {
  return withChoreReads(db => handleReadGET(request, db));
}
async function handleReadGET(request: NextRequest, db: ChoreReadDb) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const respond = async (body: unknown, init?: ResponseInit) => {
      if (storageBackend() === 'd1') {
        const { renewD1ChoreReadOwner } = await import('@/lib/cloudflare/chore-read-owner')
        if (!await renewD1ChoreReadOwner({ userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload.tv ?? 0 })) return choreJson({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } })
      }
      return choreJson(body, { ...init, headers: { 'Cache-Control': 'private, no-store', ...init?.headers } })
    }
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (id !== null) return readCanonicalChoreDetail(id, auth.user.family_id, request)

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
      assignee: { select: { id: true, name: true, avatar_url: true, family_id: true } },
      creator: { select: { id: true, name: true, family_id: true } },
    }
    const order = paging.paged ? paging.order : 'desc'
    const take = paging.paged ? paging.limit + 1 : CHORE_UNPAGED_MAX
    // History bypasses the open-occurrence policy. Other reads fill the visible
    // cap through bounded candidate+metadata batches, including undated ranges.
    const candidates = status === 'completed' || status === 'verified'
      ? await db.chore.findMany({
          where, include, orderBy: choreOrderBy(order), take,
        })
      : await readVisibleChoreRows({
          take,
          order,
          read: (after, batchSize) => db.chore.findMany({
            where: after ? { AND: [where, afterChoreCursor(after, order)] } : where,
            include,
            orderBy: choreOrderBy(order),
            take: batchSize,
          }),
          hidden: (ids) => hiddenRoutineOccurrenceIds(prisma!, auth.user.family_id, { ids }),
        })
    // Installed unpaged clients still receive latest-visible rows oldest first.
    const rows = paging.paged ? candidates : candidates.reverse()

    const hasMore = paging.paged && rows.length > paging.limit
    const chores = hasMore ? rows.slice(0, paging.limit) : rows
    const page = paging.paged
      ? { nextCursor: hasMore ? encodeChoreCursor(chores[chores.length - 1]) : null }
      : {}

    const profileRead = profileChoreReadRefusal(request)
    const hasProfileRows = chores.some((row) => row.assigned_to === null && row.assigned_member_id != null)
    const rowsWithProfileMembers: ProfileHydrated<(typeof chores)[number]>[] = chores.some((row) => row.assigned_member_id != null)
      ? await hydrateChoreProfileMembers(prisma!, auth.user.family_id, chores)
      : chores.map((row) => ({ ...row, assigneeMember: undefined }))
    if (hasProfileRows && profileRead) return respond(profileRead.body, { status: profileRead.status, headers: { 'Cache-Control': 'private, no-store' } })
    if (hasProfileRows && rowsWithProfileMembers.some((row) => row.assigned_to === null && row.assigned_member_id != null && !readChoreSubject(row, auth.user.family_id))) {
      return respond(profileChoreLegacyWriteRefusal(), { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
    }
    const scheduledOnceIds = await scheduledOnceRoutineOccurrenceIds(
      prisma!, auth.user.family_id,
      rowsWithProfileMembers.filter((row) => row.assigned_to === null && row.assigned_member_id != null).map((row) => row.id),
    )
    const exposedChores = rowsWithProfileMembers.map((row) => {
      const { assigneeMember: _member, ...stored } = row
      const safe = { ...stored,
        assignee: row.assignee?.family_id === auth.user.family_id ? row.assignee : null,
        creator: row.creator?.family_id === auth.user.family_id ? { id: row.creator.id, name: row.creator.name } : null,
      }
      if (row.assigned_to === null && row.assigned_member_id != null) {
        const subject = readChoreSubject(row, auth.user.family_id)
        if (!subject) return safe
        const actionAvailability = profileChoreActionAvailability(row, scheduledOnceIds.has(row.id) ? "scheduled-once" : "legacy")
        return { ...safe, subject, ...(actionAvailability ? { actionAvailability } : {}) }
      }
      return safe
    })

    // Points & streaks off for this family (#248): the chore's points value is
    // not sent. It is still stored, and verify still awards XP from it.
    if (!(await isGamificationOn(auth.user.family_id))) {
      return respond({ chores: exposedChores.map(omitChorePoints), ...page })
    }

    return respond({ chores: exposedChores, ...page })
  } catch (error) {
    logRouteError('GET /api/chores', error, getRequestId(request))
    return choreJson({ error: 'Internal server error' }, { status: 500 })
  }
}

/** `GET /api/chores?id=`: one chore of the caller's household (another household's reads as missing). */

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
      return choreJson({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = updateChoreSchema.safeParse(body)
    if (!parsed.success) {
      return choreJson({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { choreId, ...updates } = parsed.data

    // due_date is a date-only value (UTC midnight). Accept `YYYY-MM-DD` or a
    // timestamp, but always store the UTC calendar day, never a time of day.
    let dueDate: Date | undefined
    if (updates.due_date !== undefined) {
      const normalized = normalizeDateOnlyInput(updates.due_date)
      if (!normalized) {
        return choreJson({ error: 'Invalid date' }, { status: 400 })
      }
      dueDate = normalized
    }

    const chore = await prisma!.chore.findUnique({
      where: { id: choreId },
      select: { family_id: true, assigned_to: true, assigned_member_id: true, member_subject_erased: true, photo_url: true, frequency: true, weekly_days: true, recurrence_id: true },
    })

    if (!chore) {
      return choreJson({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (chore.member_subject_erased && updates.assigned_to !== undefined && updates.assigned_to !== chore.assigned_to) {
      return choreJson(
        { error: 'An erased chore subject cannot be reassigned', code: 'IDENTITY_CONFLICT' },
        { status: 409, headers: { 'Cache-Control': 'private, no-store' } }
      )
    }

    if (chore.assigned_to === null && chore.assigned_member_id != null) {
      return choreJson(profileChoreLegacyWriteRefusal(), { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
    }

    if (auth.user.role !== 'parent' && chore.assigned_to !== auth.user.id) {
      return choreJson({ error: 'Only parents or the assignee can edit chores' }, { status: 403 })
    }

    // Fields a non-parent assignee must not change (#185).
    //
    // The assignee may edit their own chore, but `points` decides how much XP
    // verify awards and `assigned_to` decides who receives it. Letting a child
    // set either meant they could inflate points before verification, or point
    // the chore at any user id they could guess. Both are privilege boundaries,
    // not cosmetic edits. `difficulty` feeds the XP multiplier the same way,
    // so it is parent-only too.
    // `rotation` (take turns, O-39) decides who gets every future copy, so it
    // is parent-only like `assigned_to`.
    const PARENT_ONLY_FIELDS = ['points', 'difficulty', 'assigned_to', 'frequency', 'weekly_days', 'rotation'] as const
    if (auth.user.role !== 'parent') {
      const attempted = PARENT_ONLY_FIELDS.filter((f) => updates[f] !== undefined)
      if (attempted.length > 0) {
        return choreJson(
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
          return choreJson(
            { error: 'Assignee must be a member of your family' },
            { status: 400 }
          )
        }
      }
    }

    // Everyone taking turns must be in the caller's household (O-39); another
    // household's member reads the same as a missing one.
    const rotation = updates.rotation
    if (rotation && !(await rotationMembersInHousehold(prisma!, auth.user.family_id, rotation))) {
      return choreJson({ error: 'Everyone taking turns must be in your family' }, { status: 400 })
    }

    // D3 (#102): a new photo must be an upload owned by the caller's family.
    // Re-sending the chore's current value (an edit form posting back what it
    // loaded, including a legacy file with no Upload row) is left unchanged.
    const photo = await resolveChorePhotoForWrite(auth.user.family_id, updates.photo_url, chore.photo_url)
    if (!photo.ok) {
      return choreJson({ error: photo.error }, { status: 400 })
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
    // Lock actor first and renew session/membership after any wait for
    // recurrence expansion or another household write.
    // Take turns (O-39) applies to the whole series, after any frequency
    // change in the same request (so "once -> weekly, take turns" works).
    const frequency = updates.frequency
    let updated
    try {
      updated = await prisma!.$transaction(async (tx) => {
        await lockUser(tx, auth.user.id)
        await lockHousehold(tx, chore.family_id)
        const caller = await tx.user.findFirst({ where: { id: auth.user.id, family_id: chore.family_id }, select: { id: true, role: true, token_version: true } })
        if (caller && caller.token_version !== (auth.payload.tv ?? 0)) throw new ChoreSessionChangedError()
        const current = await tx.chore.findFirst({ where: { id: choreId, family_id: chore.family_id }, select: { assigned_to: true, assigned_member_id: true, member_subject_erased: true, frequency: true, recurrence_id: true, weekly_days: true } })
        if (!caller || !current || caller.role !== auth.user.role || (caller.role !== 'parent' && current.assigned_to !== caller.id)) throw new HouseholdMemberIdentityConflict()
        if (current.assigned_to === null && current.assigned_member_id != null) throw new HouseholdMemberIdentityConflict()
        if (current.member_subject_erased && updates.assigned_to !== undefined && updates.assigned_to !== current.assigned_to) throw new HouseholdMemberIdentityConflict()
        await refuseScheduledRoutineLegacyWrite(tx, chore.family_id, choreId, updates.apply_to_series === true || frequency !== undefined || rotation !== undefined)
        if (updates.assigned_to !== undefined) {
          // The selected account may have left while this request waited.
          const assignee = await tx.user.findFirst({ where: { id: updates.assigned_to, family_id: chore.family_id }, select: { id: true } })
          if (!assignee) throw new HouseholdMemberIdentityConflict()
          if (current.assigned_member_id) Object.assign(data, await canonicalChoreAssigneeInTx(tx, chore.family_id, updates.assigned_to))
        }
        if (Object.keys(data).length > 0) await tx.chore.update({ where: { id: choreId }, data })
        if (frequency !== undefined) {
          await applyFrequencyEditInTx(
            tx,
            { id: choreId, family_id: chore.family_id, frequency: current.frequency, recurrence_id: current.recurrence_id, weekly_days: current.weekly_days },
            frequency,
            { applyToSeries: updates.apply_to_series === true, weeklyDays: updates.weekly_days }
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
      if (err instanceof ChoreSessionChangedError) return choreJson({ error: 'Unauthorized' }, { status: 401 })
      if (err instanceof RoutineScheduleLegacyWriteError) return choreJson({ error: err.message, code: err.code }, { status: 409 })
      if (err instanceof HouseholdMemberIdentityConflict) return choreJson({ error: err.message, code: 'IDENTITY_CONFLICT' }, { status: 409 })
      if (err instanceof RotationNeedsSeriesError) {
        return choreJson({ error: err.message }, { status: 400 })
      }
      throw err
    }

    if (!(await isGamificationOn(auth.user.family_id))) {
      return choreJson({ chore: omitChorePoints(updated) })
    }

    return choreJson({ chore: updated })
  } catch (error) {
    logRouteError('PATCH /api/chores', error, getRequestId(request))
    return choreJson({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Take turns on a chore that does not repeat; rolls the edit back. */
class RotationNeedsSeriesError extends Error {
  constructor() {
    super('Taking turns needs a chore that repeats')
  }
}

/** A session revoked while this request waited cannot perform a chore write. */
class ChoreSessionChangedError extends Error {}

// DELETE - Delete one occurrence (family-scoped). A series anchor is a
// protected lifecycle boundary: stopping is the existing parent-only PATCH
// frequency=once flow, so a legacy row delete cannot orphan its copies.
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return choreJson({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = deleteChoreSchema.safeParse(body);
    if (!parsed.success) {
      return choreJson({ error: "choreId is required" }, { status: 400 });
    }

    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      generation: auth.payload?.tv ?? 0,
    };
    const kind = "chore_delete" as const;
    const sourceGuard = assistantSourceGuard(request, actor, kind);
    const targetGuard = assistantDeleteTargetGuard(
      request,
      actor,
      kind,
      parsed.data.choreId,
      Boolean(sourceGuard),
    );
    if (storageBackend() === 'd1') {
      const result = await deleteD1Chore(actor, parsed.data.choreId, key, { sourceGuard, targetGuard })
      return choreJson(result.body, { status: result.status, headers: result.replayed ? { 'Idempotency-Replayed': 'true' } : undefined })
    }
    return await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${actor.userId}`,
        userId: actor.userId,
        familyId: actor.familyId,
        action: "chore.delete",
      },
      parsed.data,
      ({ recordId }) =>
        deletePersonRecord(
          prisma!,
          actor,
          kind,
          parsed.data.choreId,
          recordId,
          sourceGuard,
          targetGuard,
        ),
      { beforeReplay: () => authorizePersonDeleteReplay(prisma!, actor, kind) },
    );
  } catch (error) {
    if (error instanceof D1ChoreDeleteReceiptError) return idempotencyError(error.code);
    if (error instanceof AssistantSourceRefused) return error.response();
    if (error instanceof RoutineScheduleLegacyWriteError)
      return choreJson(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    logRouteError("DELETE /api/chores", error, getRequestId(request));
    return choreJson({ error: "Internal server error" }, { status: 500 });
  }
}
