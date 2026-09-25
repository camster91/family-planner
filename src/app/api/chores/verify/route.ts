import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch, requireParent } from '@/lib/api-auth'
import { notificationServiceServer } from '@/lib/notifications-server'
import { verifyChoreSchema } from '@/lib/validations'
import { awardChoreXP } from '@/lib/gamification-server'

export const dynamic = 'force-dynamic'

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

    const { choreId, verificationNotes } = parsed.data

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

      const xp = chore.assignee
        ? await awardChoreXP(chore.assignee.id, chore.difficulty || 'medium', chore.points || 10, tx)
        : null

      return { verified: true as const, xp }
    })

    if (!outcome.verified) {
      return NextResponse.json({ success: true, alreadyVerified: true })
    }

    // Notifications are sent only after the transaction commits, so a rolled-back
    // verify never tells the child it succeeded. A notification failure must not
    // turn a committed verify into a 500 (which would invite a pointless retry).
    if (chore.assignee) {
      try {
        await notificationServiceServer.sendNotification({
          userId: chore.assignee.id,
          title: 'Chore Verified!',
          message: `Your chore "${chore.title}" has been verified. Great job!`,
          type: 'reward',
        })

        // Send level-up notification if applicable
        if (outcome.xp?.levelUp) {
          await notificationServiceServer.sendNotification({
            userId: chore.assignee.id,
            title: `Level Up! ${outcome.xp.newLevel}`,
            message: `You reached Level ${outcome.xp.newLevel}! Keep it up!`,
            type: 'system',
          })
        }
      } catch (notifyErr) {
        console.error('Verify notification failed:', notifyErr)
      }
    }

    return NextResponse.json({ success: true, choreId, gamified: outcome.xp !== null })
  } catch (error) {
    console.error('Error verifying chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
