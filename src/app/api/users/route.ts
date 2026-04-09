import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { updateUserSchema } from '@/lib/validations'
import { getLevelTitle } from '@/lib/gamification'

export const dynamic = 'force-dynamic'

// GET - Get current user's full profile
export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const user = await prisma!.user.findUnique({
      where: { id: payload.userId },
      include: {
        badges: true,
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const { password: _, ...userWithoutPassword } = user

    return NextResponse.json({
      user: {
        ...userWithoutPassword,
        levelTitle: getLevelTitle(user.level),
      },
    })
  } catch (error) {
    console.error('Error fetching user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update user profile (no family_id changes allowed)
export async function PATCH(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const body = await request.json()
    const parsed = updateUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const updateData: Record<string, unknown> = {}
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name
    if (parsed.data.age !== undefined) {
      updateData.age = parsed.data.age ? parseInt(String(parsed.data.age)) : null
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const user = await prisma!.user.update({
      where: { id: payload.userId },
      data: updateData,
    })

    const { password: _, ...userWithoutPassword } = user

    return NextResponse.json({ user: userWithoutPassword })
  } catch (error) {
    console.error('Error updating user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
