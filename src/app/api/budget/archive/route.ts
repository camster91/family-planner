import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { prisma } from '@/lib/prisma'
import { FINANCE_ARCHIVE_OWNER_HEADER, financeArchiveOwner, type FinanceArchiveOwner } from '@/lib/finance-archive-contract'
import { readFinanceArchivePage, readFinanceArchiveDetails, parseArchivePaging, FinanceArchiveReadError, financeArchiveReviewEnabled } from '@/lib/finance-archive-read'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
export const dynamic = 'force-dynamic'
const privateResponse = (response: NextResponse) => { response.headers.set('Cache-Control', 'private, no-store'); response.headers.set('Vary', 'Cookie, X-Herewoven-Finance-Owner'); return response }
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, X-Herewoven-Finance-Owner' } })
export async function GET(request: NextRequest) {
  try {
    const refused = await refusePairedDevice(request)
    if (refused) return privateResponse(refused)
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return privateResponse(error)
    const parentError = requireParent(auth.user.role)
    if (parentError) return privateResponse(parentError)
    if (!financeArchiveReviewEnabled()) return reply({ code: 'UNAVAILABLE' }, 404)
    let expected: FinanceArchiveOwner
    try {
      const raw = request.headers.get(FINANCE_ARCHIVE_OWNER_HEADER)
      if (!raw || raw.length > 1024) throw new Error()
      expected = financeArchiveOwner.parse(JSON.parse(raw))
    } catch { return reply({ code: 'OWNER_CHANGED' }, 409) }
    const owner = { userId: auth.user.id, familyId: auth.user.family_id, generation: auth.payload.tv ?? 0 }
    if (expected.userId !== owner.userId || expected.familyId !== owner.familyId || expected.generation !== owner.generation) return reply({ code: 'OWNER_CHANGED' }, 409)
    const params = new URL(request.url).searchParams
    if (params.has('recordId')) {
      const id = params.get('recordId')!
      if (params.getAll('recordId').length !== 1 || [...params.keys()].some(key => key !== 'recordId') || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return reply({ code: 'INVALID_PAGE' }, 400)
      return reply(await readFinanceArchiveDetails(prisma!, owner, id))
    }
    const page = parseArchivePaging(params, owner.familyId)
    return reply(await readFinanceArchivePage(prisma!, owner, page))
  } catch (error) {
    if (error instanceof FinanceArchiveReadError) return reply({ code: error.code }, error.code === 'INVALID_PAGE' ? 400 : error.code === 'OWNER_CHANGED' ? 409 : 404)
    logRouteError('GET /api/budget/archive', error, getRequestId(request))
    return reply({ code: 'UNAVAILABLE' }, 500)
  }
}
