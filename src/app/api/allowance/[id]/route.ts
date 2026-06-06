import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })

  const existing = await prisma!.allowance.findUnique({
    where: { id },
    select: { family_id: true, status: true },
  })
  if (!existing || existing.family_id !== user.family_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: { status?: 'pending' | 'paid' | 'cancelled' }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.status) return NextResponse.json({ error: 'status required' }, { status: 400 })

  const updated = await prisma!.allowance.update({
    where: { id },
    data: {
      status: body.status,
      paid_at: body.status === 'paid' ? new Date() : undefined,
    },
  })
  return NextResponse.json({ allowance: updated })
}
