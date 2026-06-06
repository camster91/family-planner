import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { createFamilySchema, updateFamilySchema, deleteFamilySchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// POST - Create a new family
export async function POST(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const body = await request.json()
    const parsed = createFamilySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    // Check if user already has a family
    const existingUser = await prisma!.user.findUnique({
      where: { id: payload.userId },
      select: { family_id: true },
    })

    if (existingUser?.family_id) {
      return NextResponse.json({ error: 'You already belong to a family' }, { status: 400 })
    }

    // Create family and assign user to it atomically
    const family = await prisma!.$transaction(async (tx) => {
      const newFamily = await tx.family.create({
        data: { name: parsed.data.name },
      })
      await tx.user.update({
        where: { id: payload.userId },
        data: { family_id: newFamily.id },
      })
      return newFamily
    })

    return NextResponse.json({ family })
  } catch (error) {
    console.error('Error creating family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET - Get current user's family details
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const family = await prisma!.family.findUnique({
      where: { id: auth.user.family_id },
      select: {
        id: true,
        name: true,
        invite_code: true,
        subscription_tier: true,
        created_at: true,
        features: true,
        _count: {
          select: { members: true },
        },
      },
    })

    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    return NextResponse.json({
      family: {
        id: family.id,
        name: family.name,
        invite_code: family.invite_code,
        subscription_tier: family.subscription_tier,
        created_at: family.created_at,
        member_count: family._count.members,
        features: family.features,
      },
      role: auth.user.role,
    })
  } catch (error) {
    console.error('Error fetching family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update family settings (parents only, must be in that family)
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const body = await request.json()
    const parsed = updateFamilySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    if (parsed.data.familyId !== auth.user.family_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updateData: Record<string, unknown> = {}
    if (parsed.data.name) updateData.name = parsed.data.name
    if (parsed.data.subscription_tier) updateData.subscription_tier = parsed.data.subscription_tier

    const family = await prisma!.family.update({
      where: { id: parsed.data.familyId },
      data: updateData,
    })

    return NextResponse.json({ family })
  } catch (error) {
    console.error('Error updating family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a family (parents only)
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const body = await request.json()
    const parsed = deleteFamilySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'familyId is required' }, { status: 400 })
    }

    if (parsed.data.familyId !== auth.user.family_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma!.family.delete({
      where: { id: parsed.data.familyId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
