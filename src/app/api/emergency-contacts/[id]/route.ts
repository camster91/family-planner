import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch, requireParent } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { updateEmergencyContactSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// PATCH - Update an emergency contact
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'emergency')
    if (gate) return gate

    // D1 (#102): teens and children may read emergency contacts but not change them.
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const { id } = await params
    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    // The create rules, every field optional: person_name and relationship
    // cannot be cleared; other text fields clear with "" or null.
    const parsed = updateEmergencyContactSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const existing = await prisma!.emergencyContact.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(existing.family_id, auth.user.family_id)
    if (familyError) return familyError

    // Only the keys the caller sent (zod drops unknown keys).
    const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))

    // A linked person must be a member of the caller's family (#102).
    if (data.person_id) {
      const person = await prisma!.user.findFirst({
        where: { id: data.person_id, family_id: auth.user.family_id },
        select: { id: true },
      })
      if (!person) {
        return NextResponse.json({ error: 'Person not in your family' }, { status: 400 })
      }
    }

    const updated = await prisma!.emergencyContact.update({
      where: { id },
      data,
    })

    return NextResponse.json({ contact: updated })
  } catch (err) {
    logRouteError('PATCH /api/emergency-contacts/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Remove an emergency contact
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'emergency')
    if (gate) return gate

    // D1 (#102): teens and children may read emergency contacts but not change them.
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const { id } = await params

    const existing = await prisma!.emergencyContact.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(existing.family_id, auth.user.family_id)
    if (familyError) return familyError

    await prisma!.emergencyContact.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    logRouteError('DELETE /api/emergency-contacts/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
