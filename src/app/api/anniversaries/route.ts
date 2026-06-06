import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// GET - List all anniversaries for the user's family, sorted by upcoming date
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const anniversaries = await prisma!.anniversary.findMany({
      where: { family_id: auth.user.family_id },
      orderBy: { date: 'asc' },
    })

    const today = new Date()
    const dates = anniversaries.map((a) => {
      const date = new Date(a.date)
      const thisYear = today.getFullYear()

      // Determine next occurrence
      const thisYearDate = new Date(thisYear, date.getMonth(), date.getDate())
      const nextOccurrence =
        thisYearDate >= today
          ? thisYearDate
          : new Date(thisYear + 1, date.getMonth(), date.getDate())

      const daysUntil = Math.ceil(
        (nextOccurrence.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      )

      return {
        id: a.id,
        name: a.name,
        type: a.type as 'birthday' | 'anniversary' | 'custom',
        date: a.date.toISOString(),
        notes: a.notes,
        person_id: a.person_id,
        days_until: daysUntil,
        next_occurrence: nextOccurrence.toISOString(),
      }
    })

    return NextResponse.json({ dates })
  } catch (err) {
    console.error('Error fetching anniversaries:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create an anniversary
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const { name, type, date, notes, person_id } = body

    if (!name || !type || !date) {
      return NextResponse.json(
        { error: 'name, type, and date are required' },
        { status: 400 }
      )
    }

    if (!['birthday', 'anniversary', 'custom'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const created = await prisma!.anniversary.create({
      data: {
        family_id: auth.user.family_id,
        name,
        type,
        date: new Date(date),
        notes: notes || null,
        person_id: person_id || null,
      },
    })

    return NextResponse.json({ date: created }, { status: 201 })
  } catch (err) {
    console.error('Error creating anniversary:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}