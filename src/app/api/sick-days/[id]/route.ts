import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

const SEVERITIES = ['mild', 'moderate', 'severe'] as const
const TEMPERATURE_UNITS = ['C', 'F'] as const

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = (await getServerUser()) as SessionUser | null
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const gate = await featureGate(user.family_id, 'sick-days')
    if (gate) return gate
    if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })
    const familyId = user.family_id

    const existing = await prisma!.sickDay.findUnique({
      where: { id },
      select: { family_id: true },
    })
    if (!existing || existing.family_id !== familyId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    let body: {
      addTemperature?: { value?: unknown; unit?: unknown }
      endedAt?: unknown
      symptoms?: unknown
      severity?: unknown
      notes?: unknown
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const data: Record<string, unknown> = {}

    let temperatureEntry: { value: number; unit: string; at: string } | null = null
    if (body.addTemperature !== undefined) {
      const t = body.addTemperature
      if (
        !t ||
        typeof t !== 'object' ||
        typeof t.value !== 'number' ||
        !Number.isFinite(t.value) ||
        typeof t.unit !== 'string' ||
        !(TEMPERATURE_UNITS as readonly string[]).includes(t.unit)
      ) {
        return NextResponse.json(
          { error: 'addTemperature requires a numeric value and unit C or F' },
          { status: 400 }
        )
      }
      temperatureEntry = { value: t.value, unit: t.unit, at: new Date().toISOString() }
    }

    if (body.endedAt !== undefined && body.endedAt !== null && body.endedAt !== '') {
      const endedAt = typeof body.endedAt === 'string' ? new Date(body.endedAt) : null
      if (!endedAt || Number.isNaN(endedAt.getTime())) {
        return NextResponse.json({ error: 'endedAt must be a valid date' }, { status: 400 })
      }
      data.ended_at = endedAt
      data.status = 'recovered'
    }

    if (body.symptoms !== undefined) {
      if (body.symptoms !== null && typeof body.symptoms !== 'string') {
        return NextResponse.json({ error: 'symptoms must be a string' }, { status: 400 })
      }
      data.symptoms = body.symptoms
    }
    if (body.severity !== undefined) {
      if (typeof body.severity !== 'string' || !(SEVERITIES as readonly string[]).includes(body.severity)) {
        return NextResponse.json(
          { error: `severity must be one of: ${SEVERITIES.join(', ')}` },
          { status: 400 }
        )
      }
      data.severity = body.severity
    }
    if (body.notes !== undefined) {
      if (body.notes !== null && typeof body.notes !== 'string') {
        return NextResponse.json({ error: 'notes must be a string' }, { status: 400 })
      }
      data.notes = body.notes
    }

    const updated = await prisma!.$transaction(async (tx) => {
      if (temperatureEntry) {
        // Atomic jsonb append: a read-modify-write in application code would
        // drop readings when two caregivers log a temperature concurrently.
        const entry = JSON.stringify([temperatureEntry])
        await tx.$executeRaw`
          UPDATE "SickDay"
          SET temperature_log = CASE
                WHEN jsonb_typeof(temperature_log) = 'array' THEN temperature_log || ${entry}::jsonb
                ELSE ${entry}::jsonb
              END,
              updated_at = NOW()
          WHERE id = ${id} AND family_id = ${familyId}
        `
      }
      return tx.sickDay.update({ where: { id }, data })
    })
    return NextResponse.json({ sickDay: updated })
  } catch (error) {
    console.error('Error updating sick day:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await featureGate(user.family_id, 'sick-days')
  if (gate) return gate
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
