import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function GET() {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ sickDays: [] })

  const sickDays = await prisma!.sickDay.findMany({
    where: { family_id: user.family_id, status: 'active' },
    include: {
      person: { select: { id: true, name: true, avatar_url: true } },
      medications: { where: { active: true } },
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
