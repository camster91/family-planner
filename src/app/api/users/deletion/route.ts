import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { getDeletionOptions } from '@/lib/account-deletion'
import { refusePairedDevice } from '@/lib/device-route'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

/**
 * GET /api/users/deletion — what the signed-in member may delete, for the
 * Settings dialog (docs/product/ACCOUNT_DELETION.md): their own account, or,
 * for the only parent, the whole household. Own household only: the name and
 * member/parent counts of the caller's household, nothing about anyone else.
 * Read-only; the deletion routes re-check every rule themselves. A paired
 * shared tablet is refused before person auth, like both DELETE routes.
 */
export async function GET(request: NextRequest) {
  const refused = await refusePairedDevice(request)
  if (refused) return refused
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const options = await getDeletionOptions(payload.userId)
    if (!options) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    return NextResponse.json(options, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    logRouteError('GET /api/users/deletion', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
