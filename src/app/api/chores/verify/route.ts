import { choreCheckNotificationDispatchWindow, deliverChoreCheckNotificationEventInTx, lockChoreCheckNotificationParticipants } from "@/lib/chore-check-notification-event";
import { choreJson } from "@/lib/chore-json";
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { NextRequest } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch, requireParent } from '@/lib/api-auth'
import { notificationServiceServer } from '@/lib/notifications-server'
import { verifyChoreSchema } from '@/lib/validations'
import { awardChoreXP } from '@/lib/gamification-server'
import { isGamificationOn } from '@/lib/gamification-visibility'
import { reopenCompletedChoreInTx } from '@/lib/chore-reopen'
import { HouseholdMemberIdentityConflict } from '@/lib/household-member-lifecycle'
import { recordBetaMetric } from '@/lib/beta-metrics'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { lockHousehold } from '@/lib/household-lock'
import { eligibleChoreAssigneeInTx } from '@/lib/chore-member-subject'
import { profileSubjectForVerify, rejectProfileChoreInTx } from '@/lib/chore-profile-actions'

export const dynamic = 'force-dynamic'

/** The fields a client needs to show the chore's real state after a check. */
const CHORE_STATE_SELECT = {
  id: true,
  status: true,
  photo_verified: true,
  verified_at: true,
  verified_notes: true,
  completed_at: true,
} as const

async function choreState(choreId: string) {
  return prisma!.chore.findUnique({ where: { id: choreId }, select: CHORE_STATE_SELECT })
}

/**
 * POST /api/chores/verify — a parent checks a chore a child marked done.
 *
 * Body: `{ choreId, decision?: 'approve' | 'reject', verificationNotes? }`.
 * - `approve` (the default, so older clients sending only `choreId` still work):
 *   `completed` → `verified`, awards XP. Re-verifying is an idempotent success.
 * - `reject`: `completed` → `pending` (the child can tick it again), the note is
 *   stored in `verified_notes` and sent to the child. A chore that is already
 *   verified is 409 `CHORE_ALREADY_VERIFIED`; an open chore is a no-op success.
 *
 * Every response carries `chore` (id, status, photo_verified, verified_at,
 * verified_notes, completed_at) so the page can show the server's state.
 */
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // Only parents can verify chores
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    let body: any
    try {
      body = await request.json()
    } catch {
      return choreJson({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = verifyChoreSchema.safeParse(body)
    if (!parsed.success) {
      return choreJson({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { choreId, decision, verificationNotes } = parsed.data

    // Get the chore and verify family ownership
    const chore = await prisma!.chore.findUnique({
      where: { id: choreId },
      include: {
        assignee: { select: { id: true, name: true, avatar_url: true, role: true, family_id: true } },
        creator: { select: { id: true, name: true, avatar_url: true, role: true } },
      },
    })

    if (!chore) {
      return choreJson({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    const notificationWindowMs = choreCheckNotificationDispatchWindow()
    if (decision === 'reject') {
      return await rejectChore(auth.user, choreId, auth.user.family_id, verificationNotes, getRequestId(request), {
        notificationWindowMs, tokenVersion: auth.payload.tv ?? 0, assigneeId: chore.assigned_to,
      })
    }

    // Status change, activity and XP award commit together. Previously the
    // status was committed first and an XP failure was only logged, so the
    // chore ended up verified with no XP and could never be re-verified to
    // retry. Now any failure rolls everything back and the request returns 500,
    // leaving the chore `completed` so verify can simply be retried.
    const outcome = await prisma!.$transaction(async (tx) => {
      // Member removal and verification both serialize on the household lock.
      // Everything below is re-read after acquiring it: the preflight row above
      // is only for the legacy not-found/family response and is not authority
      // for XP, activity text, or notifications.
      if (notificationWindowMs !== null) await lockChoreCheckNotificationParticipants(tx, auth.user.id, auth.user.family_id, chore.assigned_to)
      else await lockHousehold(tx, auth.user.family_id)
      const caller = await tx.user.findUnique({
        where: { id: auth.user.id },
        select: { id: true, name: true, role: true, family_id: true, token_version: true },
      })
      if (notificationWindowMs !== null && caller && caller.token_version !== (auth.payload.tv ?? 0)) return { kind: 'unauthorized' as const }
      if (!caller || caller.family_id !== auth.user.family_id || caller.role !== 'parent') {
        return { kind: 'forbidden' as const }
      }

      const fresh = await tx.chore.findUnique({
        where: { id: choreId },
        include: {
          assignee: { select: { id: true, name: true, avatar_url: true, role: true, family_id: true } },
          creator: { select: { id: true, name: true, avatar_url: true, role: true } },
        },
      })
      if (!fresh || fresh.family_id !== auth.user.family_id) {
        return { kind: 'notFound' as const }
      }
      if (notificationWindowMs !== null && fresh.assigned_to !== chore.assigned_to) return { kind: 'changed' as const }
      if (fresh.status === 'verified') {
        return { kind: 'alreadyVerified' as const }
      }
      if (fresh.status !== 'completed') {
        // Preserve the existing distinction between a request that was never
        // eligible (400) and one whose eligible row changed after preflight
        // (409 with the fresh state).
        return chore.status === 'completed' || chore.status === 'verified'
          ? { kind: 'lost' as const }
          : { kind: 'notCompleted' as const }
      }

      // Profile-only chores deliberately use the device/profile audit path.
      // They must never fall through to the User/XP/notification path when a
      // profile is stale, erased, or otherwise no longer eligible.
      if (fresh.assigned_to === null && fresh.assigned_member_id != null) {
        const subject = await profileSubjectForVerify(tx, choreId, auth.user.family_id)
        if (!subject) return { kind: 'profileUnavailable' as const }
        const updateResult = await tx.chore.updateMany({
          where: { id: choreId, family_id: auth.user.family_id, assigned_member_id: subject.memberId, status: 'completed' },
          data: {
            status: 'verified',
            verified_at: new Date(),
            verified_notes: verificationNotes || null,
            ...(fresh.photo_url ? { photo_verified: true } : {}),
          },
        })
        if (updateResult.count === 0) return { kind: 'lost' as const }
        await tx.activity.create({
          data: {
            family_id: auth.user.family_id,
            user_id: caller.id,
            subject_member_id: subject.memberId,
            subject_member_erased: false,
            type: 'chore_verified',
            title: `${caller.name} verified "${fresh.title}"`,
            description: `Verified ${subject.name}'s chore`,
            metadata: JSON.stringify({ choreId, subjectMemberId: subject.memberId }),
          },
        })
        return { kind: 'profileVerified' as const, xp: null, assignee: null }
      }

      // XP and notifications go only to an assignee who is still in the
      // household. The membership check is fresh and shares the lock with
      // removal, so a removed member cannot be rewarded by this request.
      const assignee = await currentChoreAssigneeInTx(tx, fresh)

      // Idempotent update — only updates if not already verified
      const updateResult = await tx.chore.updateMany({
        where: { id: choreId, family_id: auth.user.family_id, status: 'completed' },
        data: {
          status: 'verified',
          verified_at: new Date(),
          verified_notes: verificationNotes || null,
          // The parent looked at it; a completion photo counts as checked too.
          ...(fresh.photo_url ? { photo_verified: true } : {}),
        },
      })

      if (updateResult.count === 0) {
        return { kind: 'lost' as const }
      }

      const activity = await tx.activity.create({
        data: {
          family_id: auth.user.family_id,
          user_id: caller.id,
          type: 'chore_verified',
          title: `${caller.name} verified "${fresh.title}"`,
          description: assignee ? `Verified ${assignee.name}'s chore` : undefined,
          metadata: JSON.stringify({ choreId }),
        },
      })

      const xp = assignee
        ? await awardChoreXP(assignee.id, fresh.difficulty || 'medium', fresh.points || 10, tx)
        : null

      const notifiedInTx = notificationWindowMs !== null && assignee !== null
      if (notifiedInTx && assignee && notificationWindowMs !== null) {
        await deliverChoreCheckNotificationEventInTx(tx, { userId: caller.id, familyId: auth.user.family_id, role: 'parent', tokenVersion: auth.payload.tv ?? 0 }, {
          choreId: fresh.id, generation: fresh.responsibility_generation, recipientId: assignee.id, title: fresh.title,
          decision: 'approve', notes: verificationNotes || null, activityId: activity.id, activityAt: activity.created_at,
          deliverBefore: new Date(activity.created_at.getTime() + notificationWindowMs),
          levelUpNewLevel: xp?.levelUp ? xp.newLevel : null,
        })
      }
      return {
        kind: 'verified' as const,
        notifiedInTx,
        xp,
        assignee: assignee ? { id: assignee.id, title: fresh.title, familyId: fresh.family_id } : null,
      }
    })

    if (outcome.kind === 'unauthorized') return choreJson({ error: 'Unauthorized' }, { status: 401 })
    if (outcome.kind === 'changed') return choreJson({ error: 'This chore changed. Review its current assignment before checking it.', code: 'CHORE_CHANGED', chore: await choreState(choreId) }, { status: 409 })
    if (outcome.kind === 'forbidden') {
      return choreJson({ error: 'Only parents can perform this action' }, { status: 403 })
    }
    if (outcome.kind === 'notFound') {
      return choreJson({ error: 'Chore not found' }, { status: 404 })
    }
    if (outcome.kind === 'profileUnavailable') {
      return choreJson({ error: 'This profile chore is no longer available for verification.', code: 'MEMBER_PROTOCOL_UNAVAILABLE' }, { status: 409 })
    }
    if (outcome.kind === 'alreadyVerified') {
      return choreJson({ success: true, alreadyVerified: true, chore: await choreState(choreId) })
    }
    if (outcome.kind === 'notCompleted') {
      return choreJson({ error: 'Only completed chores can be verified' }, { status: 400 })
    }
    if (outcome.kind === 'lost') {
      // The conditional update lost: re-read before answering. Already
      // verified (a repeat, or another parent approved) is an idempotent
      // success; anything else (another parent sent it back, or the child
      // undid the tick) is a conflict, never a false "verified".
      const current = await choreState(choreId)
      if (current?.status === 'verified') {
        return choreJson({ success: true, alreadyVerified: true, chore: current })
      }
      return choreJson(
        {
          error: 'This chore changed while you were checking it and is no longer waiting to be checked.',
          code: 'CHORE_NOT_COMPLETED',
          chore: current,
        },
        { status: 409 }
      )
    }

    // Beta usage counts (#287): after the commit; never fails the request.
    if (outcome.kind !== 'profileVerified') {
      await recordBetaMetric(prisma!, auth.user.family_id, 'chore_verified')
    }

    // Default mode retains the best-effort post-commit sender. Opted-in notices
    // already committed atomically and skip this path; rolled-back rows never
    // become visible and a second legacy sender cannot duplicate them.
    if (outcome.assignee && !('notifiedInTx' in outcome && outcome.notifiedInTx === true)) {
      try {
        await notificationServiceServer.sendNotification({
          familyId: outcome.assignee.familyId,
          userId: outcome.assignee.id,
          title: 'Chore Verified!',
          message: `Your chore "${outcome.assignee.title}" has been verified. Great job!`,
          type: 'reward',
        })

        // Send level-up notification if applicable. XP still accrues with
        // Points & streaks off (#248), but the level-up message is not sent.
        if (outcome.xp?.levelUp && (await isGamificationOn(auth.user.family_id))) {
          await notificationServiceServer.sendNotification({
            familyId: outcome.assignee.familyId,
            userId: outcome.assignee.id,
            title: `Level Up! ${outcome.xp.newLevel}`,
            message: `You reached Level ${outcome.xp.newLevel}! Keep it up!`,
            // Earned by chores, so "Chores and rewards" mutes it (#286).
            type: 'reward',
          })
        }
      } catch (notifyErr) {
        logRouteError('POST /api/chores/verify (approve notification)', notifyErr, getRequestId(request))
      }
    }

    return choreJson({
      success: true,
      choreId,
      gamified: outcome.xp !== null,
      chore: await choreState(choreId),
    })
  } catch (error) {
    if (error instanceof HouseholdMemberIdentityConflict) return choreJson({ error: error.message, code: 'IDENTITY_CONFLICT' }, { status: 409 })
    logRouteError('POST /api/chores/verify', error, getRequestId(request))
    return choreJson({ error: 'Internal server error' }, { status: 500 })
  }
}

type VerifyCaller = { id: string; name: string; family_id: string }
type CheckedChore = {
  id: string
  family_id: string
  title: string
  status: string
  assigned_to: string | null
  assigned_member_id: string | null
  member_subject_erased: boolean
  due_date: Date
  frequency: string | null
  recurrence_id: string | null
  completed_at: Date | null
  photo_url: string | null
  difficulty: string | null
  points: number | null
  assignee: { id: string; name: string; family_id: string | null } | null
  assigneeMember?: {
    id: string
    family_id: string
    name: string
    role: string
    age: number | null
    archived_at: Date | null
    erasure_user_id: string | null
    legacy_mapping: { user_id: string } | null
    account_link: { user_id: string } | null
  } | null
}

/** Send a completed chore back to the child (decision 'reject'). No XP moves. */
async function rejectChore(
  caller: VerifyCaller,
  choreId: string,
  familyId: string,
  notes: string | undefined,
  requestId: string,
  notification: { notificationWindowMs: number | null; tokenVersion: number; assigneeId: string | null },
) {
  const reason = notes ? notes : null
  const reopened = await prisma!.$transaction(async (tx) => {
    // Rejection has the same serialization boundary as approval/removal. The
    // initial route read cannot decide whether the member is still eligible or
    // whether the chore is still completed.
    if (notification.notificationWindowMs !== null) await lockChoreCheckNotificationParticipants(tx, caller.id, familyId, notification.assigneeId)
    else await lockHousehold(tx, familyId)
    const freshCaller = await tx.user.findUnique({
      where: { id: caller.id },
      select: { id: true, name: true, role: true, family_id: true, token_version: true },
    })
    if (notification.notificationWindowMs !== null && freshCaller && freshCaller.token_version !== notification.tokenVersion) return { kind: 'unauthorized' as const }
    if (!freshCaller || freshCaller.family_id !== familyId || freshCaller.role !== 'parent') {
      return { kind: 'forbidden' as const }
    }
    const chore = await tx.chore.findUnique({
      where: { id: choreId },
      include: {
        assignee: { select: { id: true, name: true, avatar_url: true, role: true, family_id: true } },
        creator: { select: { id: true, name: true, avatar_url: true, role: true } },
      },
    })
    if (!chore || chore.family_id !== familyId) return { kind: 'notFound' as const }
    if (notification.notificationWindowMs !== null && chore.assigned_to !== notification.assigneeId) return { kind: 'changed' as const }
    if (chore.status === 'verified') return { kind: 'verified' as const }

    if (chore.assigned_to === null && chore.assigned_member_id != null) {
      const profileOutcome = await rejectProfileChoreInTx(tx, { choreId, familyId, notes: reason })
      if (profileOutcome === 'profile_unavailable') return { kind: 'profileUnavailable' as const }
      if (profileOutcome === 'not_found') return { kind: 'notFound' as const }
      if (profileOutcome === 'verified') return { kind: 'verified' as const }
      if (profileOutcome === 'open') return { kind: 'open' as const }
      if (profileOutcome !== 'reopened') return { kind: 'open' as const }
      await tx.activity.create({
        data: {
          family_id: familyId,
          user_id: freshCaller.id,
          subject_member_id: chore.assigned_member_id,
          subject_member_erased: false,
          type: 'chore_rejected',
          title: `${freshCaller.name} sent back "${chore.title}"`,
          metadata: JSON.stringify({ choreId: chore.id, subjectMemberId: chore.assigned_member_id }),
        },
      })
      return { kind: 'reopened' as const, assignee: null }
    }

    const assignee = chore.status === 'completed' ? await currentChoreAssigneeInTx(tx, chore as CheckedChore) : null
    const checkedChore = chore as CheckedChore
    const outcome = await reopenCompletedChoreInTx(tx, checkedChore, {
      photo_verified: false,
      verified_at: null,
      verified_notes: reason,
      // Sent back while its assignee is no longer in the household (O-34):
      // hand the reopened chore to the parent who sent it back.
      ...(assignee ? {} : { assigned_to: freshCaller.id }),
    })
    if (outcome !== 'reopened') return { kind: outcome as 'verified' | 'open' }
    const activity = await tx.activity.create({
      data: {
        family_id: caller.family_id,
        user_id: freshCaller.id,
        type: 'chore_rejected',
        title: `${freshCaller.name} sent back "${chore.title}"`,
        metadata: JSON.stringify({ choreId: chore.id }),
      },
    })
    const notifiedInTx = notification.notificationWindowMs !== null && assignee !== null
    if (notifiedInTx && assignee && notification.notificationWindowMs !== null) {
      await deliverChoreCheckNotificationEventInTx(tx, { userId: freshCaller.id, familyId, role: 'parent', tokenVersion: notification.tokenVersion }, {
        choreId: chore.id, generation: chore.responsibility_generation, recipientId: assignee.id, title: chore.title,
        decision: 'reject', notes: reason, activityId: activity.id, activityAt: activity.created_at,
        deliverBefore: new Date(activity.created_at.getTime() + notification.notificationWindowMs),
      })
    }
    return {
      kind: 'reopened' as const,
      notifiedInTx,
      assignee: assignee ? { id: assignee.id, title: chore.title, familyId: chore.family_id } : null,
    }
  })

  if (reopened.kind === 'unauthorized') return choreJson({ error: 'Unauthorized' }, { status: 401 })
  if (reopened.kind === 'changed') return choreJson({ error: 'This chore changed. Review its current assignment before checking it.', code: 'CHORE_CHANGED' }, { status: 409 })
  if (reopened.kind === 'forbidden') {
    return choreJson({ error: 'Only parents can perform this action' }, { status: 403 })
  }
  if (reopened.kind === 'notFound') {
    return choreJson({ error: 'Chore not found' }, { status: 404 })
  }
  if (reopened.kind === 'profileUnavailable') {
    return choreJson({ error: 'This profile chore is no longer available for verification.', code: 'MEMBER_PROTOCOL_UNAVAILABLE' }, { status: 409 })
  }
  if (reopened.kind === 'verified') {
    return choreJson(
      { error: 'This chore has already been checked, so it stays done.', code: 'CHORE_ALREADY_VERIFIED' },
      { status: 409 }
    )
  }
  if (reopened.kind === 'open') {
    return choreJson({ success: true, alreadyOpen: true, chore: await choreState(choreId) })
  }

  if (reopened.assignee && !('notifiedInTx' in reopened && reopened.notifiedInTx === true)) {
    try {
      await notificationServiceServer.sendNotification({
        familyId: reopened.assignee.familyId,
        userId: reopened.assignee.id,
        title: 'Have another go',
        message: reason ? `"${reopened.assignee.title}": ${reason}` : `"${reopened.assignee.title}" needs another go.`,
        type: 'chore',
      })
    } catch (notifyErr) {
      logRouteError('POST /api/chores/verify (reject notification)', notifyErr, requestId)
    }
  }

  return choreJson({ success: true, choreId, rejected: true, chore: await choreState(choreId) })
}

/**
 * Resolve the recipient only while the household lock is held. Legacy chores
 * continue to use their current account; canonical chores additionally require
 * the mapping/link/profile to agree and the profile to remain active. An
 * archived or erased canonical subject can stay in completed history but must
 * not receive a fresh reward or notification.
 */
async function currentChoreAssigneeInTx(tx: Prisma.TransactionClient, chore: CheckedChore) {
  // Account ownership is deliberately not a fallback after canonical erasure:
  // eraseAccountProfilesInTx clears the canonical id but leaves this sticky
  // tombstone so retained history cannot be relinked to a live account.
  if (chore.member_subject_erased || chore.assigned_to === null) return null
  const resolved = await eligibleChoreAssigneeInTx(tx, chore.family_id, chore.assigned_to, {
    requireCanonical: Boolean(chore.assigned_member_id),
  })
  if (chore.assigned_member_id && resolved?.assigned_member_id !== chore.assigned_member_id) {
    if (resolved) throw new HouseholdMemberIdentityConflict()
    return null
  }
  if (!resolved || !chore.assignee || chore.assignee.family_id !== chore.family_id) return null
  return chore.assignee
}
