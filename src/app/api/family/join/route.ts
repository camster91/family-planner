import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const { familyId } = await request.json()
    if (!familyId) {
      return NextResponse.json({ error: 'familyId is required' }, { status: 400 })
    }

    // Check if user already has a family
    const user = await prisma!.user.findUnique({
      where: { id: userId },
      select: { family_id: true },
    })

    if (user?.family_id) {
      return NextResponse.json({ error: 'You already belong to a family. Leave your current family first.' }, { status: 400 })
    }

    // Verify family exists
    const family = await prisma!.family.findUnique({
      where: { id: familyId },
      select: { id: true, name: true },
    })

    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    // Update user to join family
    await prisma!.user.update({
      where: { id: userId },
      data: { family_id: familyId },
    })

    return NextResponse.json({ success: true, familyName: family.name })
  } catch (error) {
    console.error('Error joining family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
