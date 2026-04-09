import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch, requireParent } from '@/lib/api-auth'
import { notificationServiceServer } from '@/lib/notifications-server'
import { verifyChoreSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // Only parents can verify chores
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const body = await request.json()
    const parsed = verifyChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { choreId, verificationNotes } = parsed.data

    // Get the chore and verify family ownership
    const chore = await prisma!.chore.findUnique({
      where: { id: choreId },
      include: { assignee: true, creator: true }
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (chore.status !== 'completed') {
      return NextResponse.json({ error: 'Only completed chores can be verified' }, { status: 400 })
    }

    // Update chore status to verified
    await prisma!.chore.update({
      where: { id: choreId },
      data: {
        status: 'verified',
        verified_at: new Date(),
        verified_notes: verificationNotes || null,
      },
    })

    // Record activity
    await prisma!.activity.create({
      data: {
        family_id: auth.user.family_id,
        user_id: auth.user.id,
        type: 'chore_verified',
        title: `${auth.user.name} verified "${chore.title}"`,
        description: chore.assignee ? `Verified ${chore.assignee.name}'s chore` : undefined,
        metadata: JSON.stringify({ choreId }),
      },
    })

    // Send notification to the assignee
    if (chore.assignee) {
      await notificationServiceServer.sendNotification({
        userId: chore.assignee.id,
        title: 'Chore Verified!',
        message: `Your chore "${chore.title}" has been verified. Great job!`,
        type: 'reward',
      })
    }

    return NextResponse.json({ success: true, choreId })
  } catch (error) {
    console.error('Error verifying chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
