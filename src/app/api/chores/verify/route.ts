import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { notificationServiceServer } from '@/lib/notifications-server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const { choreId, verificationNotes } = await request.json()

    if (!choreId) {
      return NextResponse.json({ error: 'Missing choreId' }, { status: 400 })
    }

    // Get the chore details
    const chore = await prisma!.chore.findUnique({
      where: { id: choreId },
      include: { assignee: true, creator: true }
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    // Update chore status to verified
    await prisma!.chore.update({
      where: { id: choreId },
      data: {
        status: 'verified',
        verified_at: new Date(),
      },
    })

    // Send notification about chore verification
    if (chore.assignee) {
      await notificationServiceServer.sendNotification({
        userId: chore.assignee.id,
        title: 'Chore Verified! 🎉',
        message: `Your chore "${chore.title}" has been verified by a parent.`,
        type: 'reward'
      })
    }

    return NextResponse.json({ success: true, choreId })

  } catch (error) {
    console.error('Error verifying chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
