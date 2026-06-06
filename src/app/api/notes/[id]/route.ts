import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// PATCH - Update a note
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const { id, title, body: noteBody, color } = body

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 })
    }

    const note = await prisma!.pinnedNote.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(note.family_id, auth.user.family_id)
    if (familyError) return familyError

    const data: Record<string, unknown> = {}
    if (title !== undefined) data.title = title.trim()
    if (noteBody !== undefined) data.body = noteBody.trim()
    if (color !== undefined) {
      const validColors = ['yellow', 'pink', 'blue', 'green', 'purple']
      data.color = validColors.includes(color) ? color : 'yellow'
    }

    const updated = await prisma!.pinnedNote.update({
      where: { id },
      data,
    })

    return NextResponse.json({ note: updated })
  } catch (err) {
    console.error('Error updating note:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Remove a note
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const { id } = body

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 })
    }

    const note = await prisma!.pinnedNote.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(note.family_id, auth.user.family_id)
    if (familyError) return familyError

    await prisma!.pinnedNote.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error deleting note:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}