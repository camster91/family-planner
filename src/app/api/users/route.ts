import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { updateUserSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET - Get current user's full profile
export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const user = await prisma!.user.findUnique({
      where: { id: payload.userId },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const { password: _, ...userWithoutPassword } = user

    return NextResponse.json({ user: userWithoutPassword })
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

// DELETE - Delete the current user's account (GDPR Article 17 — right to erasure)
// Parents cannot delete their account if they are the last parent in the family —
// the family must have at least one parent at all times. Children can always
// delete themselves.
export async function DELETE(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const user = await prisma!.user.findUnique({
      where: { id: payload.userId },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // If user is a parent, check that at least one other parent exists in the family
    if (user.family_id && user.role === 'parent') {
      const otherParents = await prisma!.user.count({
        where: {
          family_id: user.family_id,
          role: 'parent',
          id: { not: user.id },
        },
      })
      if (otherParents === 0) {
        return NextResponse.json(
          { error: 'Cannot delete the only parent in the family. Add another parent first or transfer ownership.' },
          { status: 400 }
        )
      }
    }

    // Cascading delete: per Prisma schema, Family has all the user relations
    // (chores, lists, etc.) with onDelete: Cascade or SetNull. The user
    // record itself is removed; their authored content (chores they created,
    // messages they sent) is either cascaded or set to null per the schema.
    await prisma!.user.delete({
      where: { id: user.id },
    })

    // Clear session cookie
    const response = NextResponse.json({ success: true })
    response.cookies.set('session_token', '', {
      path: '/',
      maxAge: 0,
    })

    return response
  } catch (error) {
    console.error('Error deleting user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}