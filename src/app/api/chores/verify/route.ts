import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
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
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = verifyChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
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
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (decision === 'reject') {
      return await rejectChore(auth.user, choreId, auth.user.family_id, verificationNotes, getRequestId(request))
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
      await lockHousehold(tx, auth.user.family_id)
      const caller = await tx.user.findUnique({
        where: { id: auth.user.id },
        select: { id: true, name: true, role: true, family_id: true },
      })
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

      await tx.activity.create({
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

      return {
        kind: 'verified' as const,
        xp,
        assignee: assignee ? { id: assignee.id, title: fresh.title, familyId: fresh.family_id } : null,
      }
    })

    if (outcome.kind === 'forbidden') {
      return NextResponse.json({ error: 'Only parents can perform this action' }, { status: 403 })
    }
    if (outcome.kind === 'notFound') {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }
    if (outcome.kind === 'alreadyVerified') {
      return NextResponse.json({ success: true, alreadyVerified: true, chore: await choreState(choreId) })
    }
    if (outcome.kind === 'notCompleted') {
      return NextResponse.json({ error: 'Only completed chores can be verified' }, { status: 400 })
    }
    if (outcome.kind === 'lost') {
      // The conditional update lost: re-read before answering. Already
      // verified (a repeat, or another parent approved) is an idempotent
      // success; anything else (another parent sent it back, or the child
      // undid the tick) is a conflict, never a false "verified".
      const current = await choreState(choreId)
      if (current?.status === 'verified') {
        return NextResponse.json({ success: true, alreadyVerified: true, chore: current })
      }
      return NextResponse.json(
        {
          error: 'This chore changed while you were checking it and is no longer waiting to be checked.',
          code: 'CHORE_NOT_COMPLETED',
          chore: current,
        },
        { status: 409 }
      )
    }

    // Beta usage counts (#287): after the commit; never fails the request.
    await recordBetaMetric(prisma!, auth.user.family_id, 'chore_verified')

    // Notifications are sent only after the transaction commits, so a rolled-back
    // verify never tells the child it succeeded. A notification failure must not
    // turn a committed verify into a 500 (which would invite a pointless retry).
    if (outcome.assignee) {
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

    return NextResponse.json({
      success: true,
      choreId,
      gamified: outcome.xp !== null,
      chore: await choreState(choreId),
    })
  } catch (error) {
    if (error instanceof HouseholdMemberIdentityConflict) return NextResponse.json({ error: error.message, code: 'IDENTITY_CONFLICT' }, { status: 409 })
    logRouteError('POST /api/chores/verify', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

type VerifyCaller = { id: string; name: string; family_id: string }
type CheckedChore = {
  id: string
  family_id: string
  title: string
  status: string
  assigned_to: string
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
}

/** Send a completed chore back to the child (decision 'reject'). No XP moves. */
async function rejectChore(
  caller: VerifyCaller,
  choreId: string,
  familyId: string,
  notes: string | undefined,
  requestId: string
) {
  const reason = notes ? notes : null
  const reopened = await prisma!.$transaction(async (tx) => {
    // Rejection has the same serialization boundary as approval/removal. The
    // initial route read cannot decide whether the member is still eligible or
    // whether the chore is still completed.
    await lockHousehold(tx, familyId)
    const freshCaller = await tx.user.findUnique({
      where: { id: caller.id },
      select: { id: true, name: true, role: true, family_id: true },
    })
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
    if (chore.status === 'verified') return { kind: 'verified' as const }

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
    await tx.activity.create({
      data: {
        family_id: caller.family_id,
        user_id: freshCaller.id,
        type: 'chore_rejected',
        title: `${freshCaller.name} sent back "${chore.title}"`,
        metadata: JSON.stringify({ choreId: chore.id }),
      },
    })
    return {
      kind: 'reopened' as const,
      assignee: assignee ? { id: assignee.id, title: chore.title, familyId: chore.family_id } : null,
    }
  })

  if (reopened.kind === 'forbidden') {
    return NextResponse.json({ error: 'Only parents can perform this action' }, { status: 403 })
  }
  if (reopened.kind === 'notFound') {
    return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
  }
  if (reopened.kind === 'verified') {
    return NextResponse.json(
      { error: 'This chore has already been checked, so it stays done.', code: 'CHORE_ALREADY_VERIFIED' },
      { status: 409 }
    )
  }
  if (reopened.kind === 'open') {
    return NextResponse.json({ success: true, alreadyOpen: true, chore: await choreState(choreId) })
  }

  if (reopened.assignee) {
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

  return NextResponse.json({ success: true, choreId, rejected: true, chore: await choreState(choreId) })
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
  if (chore.member_subject_erased) return null
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
