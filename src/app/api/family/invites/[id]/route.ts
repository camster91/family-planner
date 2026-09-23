import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [auth, error] = await authenticateWithFamily(request)
  if (error) return error
  const parentError = requireParent(auth.user.role)
  if (parentError) return parentError

  const { id } = await params
  const result = await prisma!.familyInvite.deleteMany({
    where: {
      id,
      family_id: auth.user.family_id,
      accepted_at: null,
    },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
