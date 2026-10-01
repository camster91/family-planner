import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch, requireParent } from '@/lib/api-auth'
import { canEditOwnedRecord } from '@/lib/role-capabilities'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { deleteNoteSchema, updateNoteSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple']

// PATCH - Update a note
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'notes')
    if (gate) return gate

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = updateNoteSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { id, title, body: noteBody, color } = parsed.data

    const note = await prisma!.pinnedNote.findUnique({
      where: { id },
      select: { family_id: true, created_by: true },
    })

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(note.family_id, auth.user.family_id)
    if (familyError) return familyError

    // D9 (#102): a teen or child may edit only notes they created.
    if (!canEditOwnedRecord(auth.user.role, auth.user.id, note.created_by)) {
      return NextResponse.json({ error: 'You can only edit notes you created' }, { status: 403 })
    }

    const data: Record<string, unknown> = {}
    if (title !== undefined) data.title = title
    if (noteBody !== undefined) data.body = (noteBody ?? '').trim()
    if (color !== undefined) {
      data.color = typeof color === 'string' && NOTE_COLORS.includes(color) ? color : 'yellow'
    }

    const updated = await prisma!.pinnedNote.update({
      where: { id },
      data,
    })

    return NextResponse.json({ note: updated })
  } catch (err) {
    logRouteError('PATCH /api/notes/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Remove a note
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'notes')
    if (gate) return gate

    // D9 (#102): deleting a note is parent-only.
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = deleteNoteSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { id } = parsed.data

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
    logRouteError('DELETE /api/notes/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}