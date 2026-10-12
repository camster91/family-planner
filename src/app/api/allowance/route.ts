import { NextRequest, NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { refusePairedDevice } from '@/lib/device-refusal'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { createAllowanceSchema } from '@/lib/validations'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { createPersonAllowance } from '@/lib/person-allowance-create'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function GET(request: NextRequest) {
  const deviceRefusal = await refusePairedDevice(request)
  if (deviceRefusal) return deviceRefusal

  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await featureGate(user.family_id, 'allowance')
  if (gate) return gate
  if (!user.family_id) return NextResponse.json({ items: [] })
  // D5 (#102): parents see the household's allowance. A teen or child sees
  // only the rows paid to them, read-only (POST/PATCH stay parent-only).
  const ownOnly = user.role === 'parent' ? {} : { to_user_id: user.id }

  const items = await prisma!.allowance.findMany({
    where: { family_id: user.family_id, ...ownOnly },
    include: {
      from_user: { select: { id: true, name: true } },
      to_user: { select: { id: true, name: true, avatar_url: true } },
    },
    orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    take: 100,
  })

  return NextResponse.json({
    items: items.map((a) => ({
      id: a.id,
      amount: a.amount,
      reason: a.reason,
      status: a.status as 'pending' | 'paid' | 'cancelled',
      scheduled_for: a.scheduled_for?.toISOString() || null,
      paid_at: a.paid_at?.toISOString() || null,
      from_user_id: a.from_user_id,
      to_user_id: a.to_user_id,
      from_name: a.from_user.name,
      to_name: a.to_user.name,
      to_avatar: a.to_user.avatar_url,
      created_at: a.created_at.toISOString(),
    })),
  })
}

export async function POST(request: Request) {
  try {
    const deviceRefusal = await refusePairedDevice(request as NextRequest)
    if (deviceRefusal) return deviceRefusal

    const user = (await getServerUser()) as SessionUser | null
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const gate = await featureGate(user.family_id, 'allowance')
    if (gate) return gate
    if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })
    const familyId = user.family_id
    if (user.role !== 'parent') {
      return NextResponse.json({ error: 'Only parents can create allowance' }, { status: 403 })
    }

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createAllowanceSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const body = parsed.data

    // Verify the target user is in the same family
    const target = await prisma!.user.findUnique({
      where: { id: body.to_user_id },
      select: { family_id: true },
    })
    if (!target || target.family_id !== familyId) {
      return NextResponse.json({ error: 'Target user not in your family' }, { status: 400 })
    }

    const response = await withIdempotency(
      prisma!,
      key,
      { scope: `user:${user.id}`, familyId, userId: user.id, action: 'allowance.create' },
      body,
      ({ recordId }) => createPersonAllowance(prisma!, body, { familyId, userId: user.id }, recordId),
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    logRouteError('POST /api/allowance', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
