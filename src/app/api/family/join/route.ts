import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const { familyId, inviteCode } = await request.json()

    // Check if user already has a family
    const user = await prisma!.user.findUnique({
      where: { id: payload.userId },
      select: { family_id: true },
    })

    if (user?.family_id) {
      return NextResponse.json({ error: 'You already belong to a family. Leave your current family first.' }, { status: 400 })
    }

    let family

    if (inviteCode) {
      // Join by invite code
      family = await prisma!.family.findUnique({
        where: { invite_code: inviteCode },
        select: { id: true, name: true },
      })
    } else if (familyId) {
      // Join by direct ID
      family = await prisma!.family.findUnique({
        where: { id: familyId },
        select: { id: true, name: true },
      })
    } else {
      return NextResponse.json({ error: 'familyId or inviteCode is required' }, { status: 400 })
    }

    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    // Update user to join family
    await prisma!.user.update({
      where: { id: payload.userId },
      data: { family_id: family.id },
    })

    return NextResponse.json({ success: true, familyName: family.name })
  } catch (error) {
    console.error('Error joining family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
