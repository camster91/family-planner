import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// GET - List all emergency contacts for the user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const contacts = await prisma!.emergencyContact.findMany({
      where: { family_id: auth.user.family_id },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ contacts })
  } catch (err) {
    console.error('Error fetching emergency contacts:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create an emergency contact (any family member)
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const {
      person_id, person_name, relationship,
      blood_type, allergies, medications, medical_conditions,
      doctor_name, doctor_phone, dentist_name, dentist_phone,
      insurance_provider, insurance_id,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
      notes,
    } = body

    if (!person_name || !relationship) {
      return NextResponse.json(
        { error: 'person_name and relationship are required' },
        { status: 400 }
      )
    }

    if (!['self', 'child', 'spouse', 'parent', 'other'].includes(relationship)) {
      return NextResponse.json({ error: 'Invalid relationship' }, { status: 400 })
    }

    const created = await prisma!.emergencyContact.create({
      data: {
        family_id: auth.user.family_id,
        person_id: person_id || null,
        person_name,
        relationship,
        blood_type: blood_type || null,
        allergies: allergies || null,
        medications: medications || null,
        medical_conditions: medical_conditions || null,
        doctor_name: doctor_name || null,
        doctor_phone: doctor_phone || null,
        dentist_name: dentist_name || null,
        dentist_phone: dentist_phone || null,
        insurance_provider: insurance_provider || null,
        insurance_id: insurance_id || null,
        emergency_contact_name: emergency_contact_name || null,
        emergency_contact_phone: emergency_contact_phone || null,
        emergency_contact_relation: emergency_contact_relation || null,
        notes: notes || null,
      },
    })

    return NextResponse.json({ contact: created }, { status: 201 })
  } catch (err) {
    console.error('Error creating emergency contact:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
