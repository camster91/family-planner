import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'
import { isKidRole } from '@/lib/kid-access'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await featureGate(user.family_id, 'sick-days')
  if (gate) return gate
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })

  const existing = await prisma!.medication.findUnique({
    where: { id },
    select: { family_id: true, created_by: true, person_id: true },
  })
  if (!existing || existing.family_id !== user.family_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  // D1 (#102): a teen or child can only see their own medications, so another
  // member's medication is "not found" for them, the same as a foreign one.
  const isKid = isKidRole(user.role)
  if (isKid && existing.person_id !== user.id) {
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

  // A teen or child may only log a dose of their own medication. Prescription
  // fields they send are ignored below; a request with no dose log is refused.
  if (isKid && !body.markDoseTaken) {
    return NextResponse.json({ error: 'Only parents can edit medications' }, { status: 403 })
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
  const gate = await featureGate(user.family_id, 'sick-days')
  if (gate) return gate
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
