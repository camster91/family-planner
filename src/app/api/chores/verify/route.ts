import { prisma } from '@/lib/prisma'
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

    // XP and notifications go only to an assignee who is still in the chore's
    // household. A member removed while their chore waited for a check (O-34)
    // must not keep earning XP or reading household chore titles.
    const assignee = chore.assignee && chore.assignee.family_id === chore.family_id ? chore.assignee : null

    if (decision === 'reject') {
      return await rejectChore(auth.user, { ...chore, assignee }, verificationNotes, getRequestId(request))
    }

    // 'verified' is accepted so re-verifying is idempotent (the updateMany
    // below is a no-op and the alreadyVerified branch returns success).
    if (chore.status !== 'completed' && chore.status !== 'verified') {
      return NextResponse.json({ error: 'Only completed chores can be verified' }, { status: 400 })
    }

    // Status change, activity and XP award commit together. Previously the
    // status was committed first and an XP failure was only logged, so the
    // chore ended up verified with no XP and could never be re-verified to
    // retry. Now any failure rolls everything back and the request returns 500,
    // leaving the chore `completed` so verify can simply be retried.
    const outcome = await prisma!.$transaction(async (tx) => {
      // Idempotent update — only updates if not already verified
      const updateResult = await tx.chore.updateMany({
        where: { id: choreId, status: 'completed' },
        data: {
          status: 'verified',
          verified_at: new Date(),
          verified_notes: verificationNotes || null,
          // The parent looked at it; a completion photo counts as checked too.
          ...(chore.photo_url ? { photo_verified: true } : {}),
        },
      })

      if (updateResult.count === 0) {
        return { verified: false as const }
      }

      await tx.activity.create({
        data: {
          family_id: auth.user.family_id,
          user_id: auth.user.id,
          type: 'chore_verified',
          title: `${auth.user.name} verified "${chore.title}"`,
          description: chore.assignee ? `Verified ${chore.assignee.name}'s chore` : undefined,
          metadata: JSON.stringify({ choreId }),
        },
      })

      const xp = assignee
        ? await awardChoreXP(assignee.id, chore.difficulty || 'medium', chore.points || 10, tx)
        : null

      return { verified: true as const, xp }
    })

    if (!outcome.verified) {
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
    if (assignee) {
      try {
        await notificationServiceServer.sendNotification({
          familyId: chore.family_id,
          userId: assignee.id,
          title: 'Chore Verified!',
          message: `Your chore "${chore.title}" has been verified. Great job!`,
          type: 'reward',
        })

        // Send level-up notification if applicable. XP still accrues with
        // Points & streaks off (#248), but the level-up message is not sent.
        if (outcome.xp?.levelUp && (await isGamificationOn(auth.user.family_id))) {
          await notificationServiceServer.sendNotification({
            familyId: chore.family_id,
            userId: assignee.id,
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
  due_date: Date
  frequency: string | null
  recurrence_id: string | null
  completed_at: Date | null
  assignee: { id: string; name: string } | null
}

/** Send a completed chore back to the child (decision 'reject'). No XP moves. */
async function rejectChore(
  caller: VerifyCaller,
  chore: CheckedChore,
  notes: string | undefined,
  requestId: string
) {
  if (chore.status === 'verified') {
    return NextResponse.json(
      { error: 'This chore has already been checked, so it stays done.', code: 'CHORE_ALREADY_VERIFIED' },
      { status: 409 }
    )
  }

  const reason = notes ? notes : null
  const reopened = await prisma!.$transaction(async (tx) => {
    const outcome = await reopenCompletedChoreInTx(tx, chore, {
      photo_verified: false,
      verified_at: null,
      verified_notes: reason,
      // Sent back while its assignee is no longer in the household (O-34):
      // hand the reopened chore to the parent who sent it back.
      ...(chore.assignee ? {} : { assigned_to: caller.id }),
    })
    if (outcome !== 'reopened') return outcome
    await tx.activity.create({
      data: {
        family_id: caller.family_id,
        user_id: caller.id,
        type: 'chore_rejected',
        title: `${caller.name} sent back "${chore.title}"`,
        metadata: JSON.stringify({ choreId: chore.id }),
      },
    })
    return 'reopened' as const
  })

  if (reopened === 'verified') {
    return NextResponse.json(
      { error: 'This chore has already been checked, so it stays done.', code: 'CHORE_ALREADY_VERIFIED' },
      { status: 409 }
    )
  }
  if (reopened === 'open') {
    return NextResponse.json({ success: true, alreadyOpen: true, chore: await choreState(chore.id) })
  }

  if (chore.assignee) {
    try {
      await notificationServiceServer.sendNotification({
        familyId: chore.family_id,
        userId: chore.assignee.id,
        title: 'Have another go',
        message: reason ? `"${chore.title}": ${reason}` : `"${chore.title}" needs another go.`,
        type: 'chore',
      })
    } catch (notifyErr) {
      logRouteError('POST /api/chores/verify (reject notification)', notifyErr, requestId)
    }
  }

  return NextResponse.json({ success: true, choreId: chore.id, rejected: true, chore: await choreState(chore.id) })
}
