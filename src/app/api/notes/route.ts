import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// GET - List all pinned notes for the user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const notes = await prisma!.pinnedNote.findMany({
      where: { family_id: auth.user.family_id },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ notes })
  } catch (err) {
    console.error('Error fetching notes:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new note
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const { title, body: noteBody, color = 'yellow' } = body

    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    const validColors = ['yellow', 'pink', 'blue', 'green', 'purple']
    const noteColor = validColors.includes(color) ? color : 'yellow'

    const note = await prisma!.pinnedNote.create({
      data: {
        family_id: auth.user.family_id,
        title: title.trim(),
        body: (noteBody || '').trim(),
        color: noteColor,
        created_by: auth.user.id,
      },
    })

    return NextResponse.json({ note }, { status: 201 })
  } catch (err) {
    console.error('Error creating note:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}