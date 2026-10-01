import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { isKidRole } from '@/lib/kid-access'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

const updateMedicationSchema = z
  .object(
    {
      markDoseTaken: z.boolean({ invalid_type_error: 'markDoseTaken must be a boolean' }).optional(),
      name: z.string({ invalid_type_error: 'name must be a string' }).trim().min(1, 'name is required').max(200).optional(),
      dosage: z.string({ invalid_type_error: 'dosage must be a string' }).trim().min(1, 'dosage is required').max(200).optional(),
      schedule: z.string({ invalid_type_error: 'schedule must be a string' }).trim().max(200).optional(),
      next_dose_at: z
        .string({ invalid_type_error: 'next_dose_at must be an ISO date-time or null' })
        .datetime({ offset: true, message: 'next_dose_at must be an ISO date-time or null' })
        .nullable()
        .optional(),
      // Hours from this dose to the next one, as the parent entered it.
      interval_hours: z
        .number({ invalid_type_error: 'interval_hours must be a number' })
        .finite()
        .min(1, 'interval_hours must be between 1 and 48')
        .max(48, 'interval_hours must be between 1 and 48')
        .optional(),
      notes: z.string({ invalid_type_error: 'notes must be a string' }).max(2000).nullable().optional(),
    },
    { invalid_type_error: 'Request body must be a JSON object' }
  )
  .refine((b) => !(b.interval_hours !== undefined && b.next_dose_at !== undefined), {
    message: 'Send next_dose_at or interval_hours, not both',
  })
  .refine((b) => b.interval_hours === undefined || b.markDoseTaken === true, {
    message: 'interval_hours is only allowed when logging a dose',
  })

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
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

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = updateMedicationSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const body = parsed.data

    // A teen or child may only log a dose of their own medication. Prescription
    // fields they send are ignored below; a request with no dose log is refused.
    if (isKid && !body.markDoseTaken) {
      return NextResponse.json({ error: 'Only parents can edit medications' }, { status: 403 })
    }

    const data: Record<string, unknown> = {}

    if (body.markDoseTaken) {
      // Never invent the next dose time: the schedule is free text ("Every 4-6
      // hours", "Once daily") and a guessed time could prompt an early dose.
      // Logging a dose clears any earlier next-dose time; a parent may set the
      // next one explicitly (`next_dose_at` or `interval_hours`).
      const takenAt = new Date()
      data.last_dose_at = takenAt
      data.next_dose_at = null
      if (user.role === 'parent' && body.interval_hours !== undefined) {
        data.next_dose_at = new Date(takenAt.getTime() + body.interval_hours * 60 * 60 * 1000)
      }
    }

    if (user.role === 'parent') {
      if (body.name !== undefined) data.name = body.name
      if (body.dosage !== undefined) data.dosage = body.dosage
      if (body.schedule !== undefined) data.schedule = body.schedule
      if (body.next_dose_at !== undefined) data.next_dose_at = body.next_dose_at ? new Date(body.next_dose_at) : null
      if (body.notes !== undefined) data.notes = body.notes?.trim() || null
    }

    const updated = await prisma!.medication.update({ where: { id }, data })
    return NextResponse.json({ medication: updated })
  } catch (err) {
    logRouteError('PATCH /api/medications/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
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
  } catch (err) {
    logRouteError('DELETE /api/medications/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
