import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// PATCH - Update an emergency contact
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = await params
    const body = await request.json()

    const existing = await prisma!.emergencyContact.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(existing.family_id, auth.user.family_id)
    if (familyError) return familyError

    const data: Record<string, unknown> = {}
    const allowed = [
      'person_id', 'person_name', 'relationship',
      'blood_type', 'allergies', 'medications', 'medical_conditions',
      'doctor_name', 'doctor_phone', 'dentist_name', 'dentist_phone',
      'insurance_provider', 'insurance_id',
      'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation',
      'notes',
    ]
    for (const key of allowed) {
      if (key in body) {
        data[key] = body[key] ?? null
      }
    }

    if (data.relationship && !['self', 'child', 'spouse', 'parent', 'other'].includes(data.relationship as string)) {
      return NextResponse.json({ error: 'Invalid relationship' }, { status: 400 })
    }

    const updated = await prisma!.emergencyContact.update({
      where: { id },
      data,
    })

    return NextResponse.json({ contact: updated })
  } catch (err) {
    console.error('Error updating emergency contact:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Remove an emergency contact
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

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
    console.error('Error deleting emergency contact:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
