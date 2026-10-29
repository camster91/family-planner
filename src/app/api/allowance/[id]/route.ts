import { NextRequest, NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { refusePairedDevice } from '@/lib/device-refusal'
import { prisma } from '@/lib/prisma'
import { storageBackend } from '@/lib/storage-backend'
import { authenticateWithFamily } from '@/lib/api-auth'
import { updateD1Allowance } from '@/lib/cloudflare/allowance'
import { D1PersonReceiptError } from '@/lib/cloudflare/person-effect'
import { idempotencyError } from '@/lib/idempotency'
import { getD1Database } from '@/lib/cloudflare/database'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

const ALLOWANCE_STATUSES = ['pending', 'paid', 'cancelled'] as const
type AllowanceStatus = (typeof ALLOWANCE_STATUSES)[number]

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (storageBackend() === 'd1') {
      const { id } = await params
      const [auth, error] = await authenticateWithFamily(request as NextRequest)
      if (error) return error
      const gate = await featureGate(auth.user.family_id, 'allowance')
      if (gate) return gate
      if (auth.user.role !== 'parent') return NextResponse.json({ error: 'Only parents can update allowance' }, { status: 403 })
      let body: { status?: unknown }
      try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
      if (!body || typeof body.status !== 'string' || !ALLOWANCE_STATUSES.includes(body.status as AllowanceStatus))
        return NextResponse.json({ error: `status must be one of: ${ALLOWANCE_STATUSES.join(', ')}` }, { status: 400 })
      const result = await updateD1Allowance({ userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload.tv ?? 0 }, id, body.status, await getD1Database())
      return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } })
    }
    const deviceRefusal = await refusePairedDevice(request as NextRequest)
    if (deviceRefusal) return deviceRefusal

    const { id } = await params
    const user = (await getServerUser()) as SessionUser | null
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const gate = await featureGate(user.family_id, 'allowance')
    if (gate) return gate
    if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })
    if (user.role !== 'parent') {
      return NextResponse.json({ error: 'Only parents can update allowance' }, { status: 403 })
    }

    const existing = await prisma!.allowance.findUnique({
      where: { id },
      select: { family_id: true, status: true },
    })
    if (!existing || existing.family_id !== user.family_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    let body: { status?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    if (!body || typeof body.status !== 'string' || !ALLOWANCE_STATUSES.includes(body.status as AllowanceStatus)) {
      return NextResponse.json(
        { error: `status must be one of: ${ALLOWANCE_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }
    const status = body.status as AllowanceStatus

    const updated = await prisma!.allowance.update({
      where: { id },
      data: {
        status,
        // Paid now, or not paid: moving a paid allowance back to pending or
        // cancelled clears the old payment date instead of leaving it behind.
        paid_at: status === 'paid' ? new Date() : null,
      },
    })
    return NextResponse.json({ allowance: updated })
  } catch (err) {
    if (err instanceof D1PersonReceiptError) return idempotencyError(err.code)
    logRouteError('PATCH /api/allowance/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
