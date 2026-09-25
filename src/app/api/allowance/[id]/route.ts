import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

const ALLOWANCE_STATUSES = ['pending', 'paid', 'cancelled'] as const
type AllowanceStatus = (typeof ALLOWANCE_STATUSES)[number]

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
      paid_at: status === 'paid' ? new Date() : undefined,
    },
  })
  return NextResponse.json({ allowance: updated })
}
