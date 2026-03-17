import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const { name, type, description } = await request.json()

    if (!name || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get user's family
    const user = await prisma!.user.findUnique({
      where: { id: userId },
      select: { family_id: true }
    })

    if (!user || !user.family_id) {
      return NextResponse.json({ error: 'User not in a family' }, { status: 400 })
    }

    try {
      // Create the list - lists table may not be in Prisma schema yet
      const list = await (prisma as any).list.create({
        data: {
          family_id: user.family_id,
          name,
          type,
          description: description || null,
          created_by: userId,
          updated_at: new Date(),
        }
      })

      return NextResponse.json({ success: true, list })
    } catch (error) {
      console.error('Error creating list:', error)
      return NextResponse.json({ error: 'Failed to create list' }, { status: 500 })
    }

  } catch (error) {
    console.error('Error creating list:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
