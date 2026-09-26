import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await featureGate(user.family_id, 'pickups')
  if (gate) return gate
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })

  const existing = await prisma!.pickup.findUnique({
    where: { id },
    select: { family_id: true },
  })
  if (!existing || existing.family_id !== user.family_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: { completed?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const updated = await prisma!.pickup.update({
    where: { id },
    data: {
      completed: typeof body.completed === 'boolean' ? body.completed : undefined,
      completed_at: typeof body.completed === 'boolean' ? (body.completed ? new Date() : null) : undefined,
    },
  })
  return NextResponse.json({ pickup: updated })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await featureGate(user.family_id, 'pickups')
  if (gate) return gate
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })

  const existing = await prisma!.pickup.findUnique({
    where: { id },
    select: { family_id: true },
  })
  if (!existing || existing.family_id !== user.family_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  // D9 (#102): any member may create or complete a pickup; deleting one is
  // parent-only.
  if (user.role !== 'parent') {
    return NextResponse.json({ error: 'Parents only' }, { status: 403 })
  }

  await prisma!.pickup.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
