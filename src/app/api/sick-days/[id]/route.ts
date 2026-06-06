import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })

  const existing = await prisma!.sickDay.findUnique({
    where: { id },
    select: { family_id: true, temperature_log: true },
  })
  if (!existing || existing.family_id !== user.family_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: {
    addTemperature?: { value: number; unit: string }
    endedAt?: string
    symptoms?: string
    severity?: string
    notes?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}

  if (body.addTemperature) {
    const log = (existing.temperature_log as Array<{ value: number; unit: string; at: string }> | null) || []
    log.push({ value: body.addTemperature.value, unit: body.addTemperature.unit, at: new Date().toISOString() })
    data.temperature_log = log
  }

  if (body.endedAt) {
    data.ended_at = new Date(body.endedAt)
    data.status = 'recovered'
  }

  if (body.symptoms !== undefined) data.symptoms = body.symptoms
  if (body.severity !== undefined) data.severity = body.severity
  if (body.notes !== undefined) data.notes = body.notes

  const updated = await prisma!.sickDay.update({ where: { id }, data })
  return NextResponse.json({ sickDay: updated })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })

  const existing = await prisma!.sickDay.findUnique({
    where: { id },
    select: { family_id: true },
  })
  if (!existing || existing.family_id !== user.family_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma!.sickDay.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
