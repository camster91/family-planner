import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { MemberRemovalError, removeHouseholdMember } from '@/lib/member-removal'
import { apiError, logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/family/members/[id] — "Remove from household" (O-34).
 *
 * A parent detaches another member of their own household: the member keeps
 * their account, loses the household, and every session they hold is revoked
 * (`token_version` bump). Household content stays; their open chores go to
 * the removing parent. Full sequence and rules: src/lib/member-removal.ts.
 *
 * - teen/child 403; a paired tablet 403 `DEVICE_WRITE_NOT_ALLOWED` before
 *   person auth; CSRF by the middleware.
 * - 400 `CANNOT_REMOVE_SELF` (a parent leaves by deleting their account).
 * - 404 `MEMBER_NOT_FOUND` for a missing id and for another household's
 *   member alike.
 * - 409 `LAST_PARENT` if the household would have no parent left.
 * - 429 after 30 removals an hour by one parent.
 *
 * 200 `{ success: true, removedId, tabletsRevoked }`.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request)
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const rate = await checkRateLimit(`member-remove:${auth.user.id}`, 30, 60 * 60 * 1000)
    if (!rate.allowed) {
      return apiError(429, 'RATE_LIMITED', 'Too many removals. Please try again later.', {
        requestId,
        headers: { 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000) || 60) },
      })
    }

    const { id } = await params
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
      return apiError(404, 'MEMBER_NOT_FOUND', 'That person is not in your household.', { requestId })
    }

    const result = await removeHouseholdMember({ actorId: auth.user.id, familyId: auth.user.family_id, targetId: id })
    return NextResponse.json({ success: true, removedId: result.removedId, tabletsRevoked: result.tabletsRevoked })
  } catch (err) {
    if (err instanceof MemberRemovalError) return apiError(err.status, err.code, err.message, { requestId })
    logRouteError('DELETE /api/family/members/[id]', err, requestId)
    return apiError(500, 'INTERNAL_ERROR', 'Could not remove this member. Try again.', { requestId })
  }
}
