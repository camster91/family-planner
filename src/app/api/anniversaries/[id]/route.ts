import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// PATCH - Update an anniversary
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const { id, name, type, date, notes, person_id } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const existing = await prisma!.anniversary.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(existing.family_id, auth.user.family_id)
    if (familyError) return familyError

    const data: Record<string, unknown> = {}
    if (name !== undefined) data.name = name
    if (type !== undefined) {
      if (!['birthday', 'anniversary', 'custom'].includes(type)) {
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
      }
      data.type = type
    }
    if (date !== undefined) data.date = new Date(date)
    if (notes !== undefined) data.notes = notes || null
    if (person_id !== undefined) data.person_id = person_id || null

    const updated = await prisma!.anniversary.update({
      where: { id },
      data,
    })

    return NextResponse.json({ date: updated })
  } catch (err) {
    console.error('Error updating anniversary:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Remove an anniversary
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const existing = await prisma!.anniversary.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(existing.family_id, auth.user.family_id)
    if (familyError) return familyError

    await prisma!.anniversary.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error deleting anniversary:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}