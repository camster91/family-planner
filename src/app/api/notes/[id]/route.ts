import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { mutatePersonNote } from '@/lib/person-note-mutation'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { deleteNoteSchema, updateNoteSchema } from '@/lib/validations'
import { refusePairedDevice } from '@/lib/device-route'

export const dynamic = 'force-dynamic'

// PATCH - Update a note
export async function PATCH(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

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
    const result = await mutatePersonNote(prisma!, {
      userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload?.tv ?? 0,
    }, { kind: 'edit', input: parsed.data })
    return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    logRouteError('PATCH /api/notes/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Remove a note
export async function DELETE(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

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
    const result = await mutatePersonNote(prisma!, {
      userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload?.tv ?? 0,
    }, { kind: 'delete', id: parsed.data.id })
    return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    logRouteError('DELETE /api/notes/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
