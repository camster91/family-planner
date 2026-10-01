import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { createNoteSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple']

// GET - List all pinned notes for the user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'notes')
    if (gate) return gate

    const notes = await prisma!.pinnedNote.findMany({
      where: { family_id: auth.user.family_id },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ notes })
  } catch (err) {
    logRouteError('GET /api/notes', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new note
export async function POST(request: NextRequest) {
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
    const parsed = createNoteSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { title, body: noteBody, color } = parsed.data

    const noteColor = typeof color === 'string' && NOTE_COLORS.includes(color) ? color : 'yellow'

    const note = await prisma!.pinnedNote.create({
      data: {
        family_id: auth.user.family_id,
        title,
        body: (noteBody || '').trim(),
        color: noteColor,
        created_by: auth.user.id,
      },
    })

    return NextResponse.json({ note }, { status: 201 })
  } catch (err) {
    logRouteError('POST /api/notes', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}