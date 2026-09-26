import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'
import { isKidRole } from '@/lib/kid-access'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

const SEVERITIES = ['mild', 'moderate', 'severe'] as const

export async function GET() {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await featureGate(user.family_id, 'sick-days')
  if (gate) return gate
  if (!user.family_id) return NextResponse.json({ sickDays: [] })

  // D1 (#102): a teen or child sees only their own sick days, and only their
  // own medications inside them.
  const ownOnly = isKidRole(user.role) ? { person_id: user.id } : {}
  const sickDays = await prisma!.sickDay.findMany({
    where: { family_id: user.family_id, status: 'active', ...ownOnly },
    include: {
      person: { select: { id: true, name: true, avatar_url: true } },
      medications: { where: { active: true, ...ownOnly } },
    },
    orderBy: { started_at: 'desc' },
  })

  return NextResponse.json({
    sickDays: sickDays.map((sd) => ({
      id: sd.id,
      person_id: sd.person_id,
      person_name: sd.person.name,
      person_avatar: sd.person.avatar_url,
      started_at: sd.started_at.toISOString(),
      ended_at: sd.ended_at?.toISOString() || null,
      symptoms: sd.symptoms,
      severity: sd.severity,
      status: sd.status,
      temperature_log: sd.temperature_log,
      notes: sd.notes,
      medications: sd.medications.map((m) => ({
        id: m.id,
        name: m.name,
        dosage: m.dosage,
        schedule: m.schedule,
        next_dose_at: m.next_dose_at?.toISOString() || null,
        last_dose_at: m.last_dose_at?.toISOString() || null,
        active: m.active,
        notes: m.notes,
      })),
    })),
  })
}

export async function POST(request: Request) {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await featureGate(user.family_id, 'sick-days')
  if (gate) return gate
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })

  let body: { person_id?: string; severity?: string; symptoms?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.person_id || !body.severity) {
    return NextResponse.json({ error: 'person_id and severity required' }, { status: 400 })
  }
  if (!(SEVERITIES as readonly string[]).includes(body.severity)) {
    return NextResponse.json(
      { error: `severity must be one of: ${SEVERITIES.join(', ')}` },
      { status: 400 }
    )
  }

  // The sick person must be a member of the caller's family.
  const person = await prisma!.user.findFirst({
    where: { id: body.person_id, family_id: user.family_id },
    select: { id: true },
  })
  if (!person) {
    return NextResponse.json({ error: 'Person not in your family' }, { status: 400 })
  }
  // D1 (#102): a teen or child may report only themselves as sick.
  if (isKidRole(user.role) && body.person_id !== user.id) {
    return NextResponse.json({ error: 'You can only report yourself as sick' }, { status: 403 })
  }

  const created = await prisma!.sickDay.create({
    data: {
      family_id: user.family_id,
      person_id: body.person_id,
      severity: body.severity,
      symptoms: body.symptoms?.trim() || null,
      created_by: user.id,
    },
  })
  return NextResponse.json({ sickDay: created }, { status: 201 })
}
