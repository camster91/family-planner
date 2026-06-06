import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })

  const existing = await prisma!.medication.findUnique({
    where: { id },
    select: { family_id: true, created_by: true },
  })
  if (!existing || existing.family_id !== user.family_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: {
    markDoseTaken?: boolean
    name?: string
    dosage?: string
    schedule?: string
    next_dose_at?: string | null
    notes?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}

  if (body.markDoseTaken) {
    data.last_dose_at = new Date()
    data.next_dose_at = new Date(Date.now() + 12 * 60 * 60 * 1000)
  }

  if (user.role === 'parent') {
    if (body.name !== undefined) data.name = body.name.trim()
    if (body.dosage !== undefined) data.dosage = body.dosage.trim()
    if (body.schedule !== undefined) data.schedule = body.schedule.trim()
    if (body.next_dose_at !== undefined) data.next_dose_at = body.next_dose_at ? new Date(body.next_dose_at) : null
    if (body.notes !== undefined) data.notes = body.notes?.trim() || null
  }

  const updated = await prisma!.medication.update({ where: { id }, data })
  return NextResponse.json({ medication: updated })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })
  if (user.role !== 'parent') return NextResponse.json({ error: 'Parents only' }, { status: 403 })

  const existing = await prisma!.medication.findUnique({
    where: { id },
    select: { family_id: true },
  })
  if (!existing || existing.family_id !== user.family_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma!.medication.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
