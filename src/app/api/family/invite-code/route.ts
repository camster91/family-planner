import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { createFamilyInviteCode, INVITE_CODE_ATTEMPTS, isInviteCodeCollision } from '@/lib/family-invite'
import { auditSummary, writeAuditLog } from '@/lib/household-audit'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * POST /api/family/invite-code — "Get a new family code" (O-34).
 *
 * Replaces the household's `Family.invite_code` with a fresh
 * `createFamilyInviteCode()` value, the generator used when a household is
 * created. The old code stops working at once (`POST /api/family/join` and
 * `GET /api/family/lookup` look up the code's canonical form). Emailed
 * invites are separate one-time tokens and are not affected; people who already joined
 * stay (remove them with `DELETE /api/family/members/[id]`).
 *
 * Parents only (teen/child 403); a paired tablet is refused (403) before
 * person auth. CSRF is checked by the middleware like every mutating route.
 * Retries with a fresh code if it collides with another household's (503
 * after INVITE_CODE_ATTEMPTS). Rate limited to 10 an hour per parent.
 * Recorded in the household audit history (`invite_code.rotated`, never the
 * code) in the same transaction.
 *
 * 200 `{ inviteCode }`, Cache-Control: private, no-store.
 */
export async function POST(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const rate = await checkRateLimit(`invite-code-rotate:${auth.user.id}`, 10, 60 * 60 * 1000)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many new codes. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000) || 60) } }
      )
    }

    const familyId = auth.user.family_id
    // A unique collision with another household's code aborts the
    // transaction; retry the whole transaction with a fresh code.
    const rotateOnce = (inviteCode: string) =>
      prisma!.$transaction(async (tx) => {
        const { count } = await tx.family.updateMany({ where: { id: familyId }, data: { invite_code: inviteCode } })
        if (count !== 1) return false
        await writeAuditLog(tx, {
          familyId,
          actorUserId: auth.user.id,
          actorKind: 'person',
          action: 'invite_code.rotated',
          targetType: 'family',
          targetId: familyId,
          summary: auditSummary.inviteCodeRotated(),
        })
        return true
      })
    let inviteCode = ''
    let updated: boolean | null = null
    for (let attempt = 1; updated === null; attempt++) {
      inviteCode = createFamilyInviteCode()
      try {
        updated = await rotateOnce(inviteCode)
      } catch (err) {
        if (!isInviteCodeCollision(err)) throw err
        if (attempt >= INVITE_CODE_ATTEMPTS) {
          logRouteError('POST /api/family/invite-code', err, getRequestId(request))
          return NextResponse.json(
            { error: 'Could not make a new code. Try again.' },
            { status: 503, headers: { ...NO_STORE, 'Retry-After': '1' } }
          )
        }
      }
    }
    if (!updated) return NextResponse.json({ error: 'Family not found' }, { status: 404, headers: NO_STORE })

    return NextResponse.json({ inviteCode }, { headers: NO_STORE })
  } catch (err) {
    logRouteError('POST /api/family/invite-code', err, getRequestId(request))
    return NextResponse.json({ error: 'Could not make a new code. Try again.' }, { status: 500, headers: NO_STORE })
  }
}
