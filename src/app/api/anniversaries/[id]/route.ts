import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch, requireParent } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { canEditOwnedRecord } from '@/lib/role-capabilities'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

// PATCH - Update an anniversary. The id comes from the path segment only;
// any `id` in the body is ignored.
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'anniversaries')
    if (gate) return gate

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const { id } = await params
    const { name, type, date, notes, person_id } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const existing = await prisma!.anniversary.findUnique({
      where: { id },
      select: { family_id: true, created_by: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(existing.family_id, auth.user.family_id)
    if (familyError) return familyError

    // D9 (#102): parents edit any anniversary of the household; a teen or
    // child edits only anniversaries they created (created_by = self). Rows
    // created before created_by existed have NULL there, so ownership cannot
    // be proven and they stay parent-edit-only. Creating is open to every
    // member; delete is parent-only (below).
    if (!canEditOwnedRecord(auth.user.role, auth.user.id, existing.created_by)) {
      return NextResponse.json(
        { error: 'You can only edit dates you added' },
        { status: 403 }
      )
    }

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
    if (person_id !== undefined) {
      // A linked person must be a member of the caller's family (#102).
      if (person_id) {
        const person = await prisma!.user.findFirst({
          where: { id: person_id, family_id: auth.user.family_id },
          select: { id: true },
        })
        if (!person) {
          return NextResponse.json({ error: 'Person not in your family' }, { status: 400 })
        }
      }
      data.person_id = person_id || null
    }

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

// DELETE - Remove an anniversary (id from the path segment)
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'anniversaries')
    if (gate) return gate

    const { id } = await params

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

    // D9 (#102): deleting an anniversary is parent-only.
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    await prisma!.anniversary.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error deleting anniversary:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}