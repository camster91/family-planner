import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { auditSummary, writeAuditLog } from '@/lib/household-audit'

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
  const familyId = auth.user.family_id
  // The revoke and its household audit row (#285) commit together.
  const count = await prisma!.$transaction(async (tx) => {
    const invite = await tx.familyInvite.findFirst({
      where: { id, family_id: familyId, accepted_at: null },
      select: { id: true, role: true },
    })
    if (!invite) return 0
    const result = await tx.familyInvite.deleteMany({
      where: {
        id,
        family_id: familyId,
        accepted_at: null,
      },
    })
    if (result.count === 0) return 0
    await writeAuditLog(tx, {
      familyId,
      actorUserId: auth.user.id,
      actorKind: 'person',
      action: 'invite.revoked',
      targetType: 'invite',
      targetId: invite.id,
      summary: auditSummary.inviteRevoked(invite.role),
    })
    return result.count
  })

  if (count === 0) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
