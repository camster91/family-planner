import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// POST - Create a new family
export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const { name } = await request.json()
    if (!name) {
      return NextResponse.json({ error: 'Family name is required' }, { status: 400 })
    }

    const family = await prisma!.family.create({
      data: { name },
    })

    // Update user to join this family
    await prisma!.user.update({
      where: { id: userId },
      data: { family_id: family.id },
    })

    return NextResponse.json({ family })
  } catch (error) {
    console.error('Error creating family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update family settings
export async function PATCH(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const { familyId, name, subscription_tier } = await request.json()
    if (!familyId) {
      return NextResponse.json({ error: 'familyId is required' }, { status: 400 })
    }

    // Verify user belongs to this family
    const user = await prisma!.user.findUnique({ where: { id: userId } })
    if (!user || user.family_id !== familyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updateData: any = {}
    if (name) updateData.name = name
    if (subscription_tier) updateData.subscription_tier = subscription_tier

    const family = await prisma!.family.update({
      where: { id: familyId },
      data: updateData,
    })

    return NextResponse.json({ family })
  } catch (error) {
    console.error('Error updating family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a family
export async function DELETE(request: NextRequest) {
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

    // Verify user belongs to this family and is a parent
    const user = await prisma!.user.findUnique({ where: { id: userId } })
    if (!user || user.family_id !== familyId || user.role !== 'parent') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete the family (cascade will handle users via onDelete: Cascade)
    await prisma!.family.delete({
      where: { id: familyId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
