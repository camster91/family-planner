import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// POST - Upload photo proof for a completed chore
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = params

    const chore = await prisma!.chore.findUnique({
      where: { id },
      select: { family_id: true, assigned_to: true, status: true }
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (chore.assigned_to !== auth.user.id) {
      return NextResponse.json(
        { error: 'Only the assigned person can upload photo proof' },
        { status: 403 }
      )
    }

    if (chore.status === 'verified') {
      return NextResponse.json(
        { error: 'Cannot upload photo for an already verified chore' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { photoUrl } = body as { photoUrl: string }

    if (!photoUrl || typeof photoUrl !== 'string') {
      return NextResponse.json({ error: 'photoUrl is required' }, { status: 400 })
    }

    const updated = await prisma!.chore.update({
      where: { id },
      data: {
        photo_url: photoUrl,
        photo_verified: false,
        status: 'completed',
        completed_at: new Date(),
      },
      include: {
        assignee: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({
      success: true,
      chore: updated,
      message: 'Photo proof uploaded successfully!',
    })
  } catch (error) {
    console.error('Error uploading photo proof:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Parent approves / rejects photo proof
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    if (auth.user.role !== 'parent') {
      return NextResponse.json(
        { error: 'Only parents can approve photo proof' },
        { status: 403 }
      )
    }

    const { id } = params

    const chore = await prisma!.chore.findUnique({
      where: { id },
      select: { family_id: true, photo_url: true }
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    const body = await request.json()
    const { approved, notes } = body as { approved: boolean; notes?: string }

    if (approved) {
      const updated = await prisma!.chore.update({
        where: { id },
        data: {
          status: 'verified',
          photo_verified: true,
          verified_at: new Date(),
          verified_notes: notes || null,
        },
        include: {
          assignee: { select: { id: true, name: true } },
        },
      })
      return NextResponse.json({ success: true, chore: updated, approved: true })
    } else {
      const updated = await prisma!.chore.update({
        where: { id },
        data: {
          status: 'pending',
          photo_verified: false,
          photo_url: null,
          verified_notes: notes || null,
        },
        include: {
          assignee: { select: { id: true, name: true } },
        },
      })
      return NextResponse.json({ success: true, chore: updated, approved: false, rejected: true })
    }
  } catch (error) {
    console.error('Error reviewing photo proof:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
