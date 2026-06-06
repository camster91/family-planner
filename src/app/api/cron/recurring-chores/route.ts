import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { expandAllRecurringChores } from '@/lib/recurringChores'

export const dynamic = 'force-dynamic'

// POST /api/cron/recurring-chores — expand recurring chores for all families
// Requires x-cron-secret header matching CRON_SECRET env var
export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
    }

    const providedSecret = request.headers.get('x-cron-secret')
    if (!providedSecret || providedSecret !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Expand recurring chores for all families
    const families = await prisma!.family.findMany({ select: { id: true } })
    const results: Array<{ familyId: string; inserted: number }> = []

    for (const family of families) {
      const inserted = await expandAllRecurringChores(family.id)
      if (inserted > 0) {
        results.push({ familyId: family.id, inserted })
      }
    }

    return NextResponse.json({
      success: true,
      families: results.length,
      details: results,
    })
  } catch (error) {
    console.error('Error running recurring chores cron:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}