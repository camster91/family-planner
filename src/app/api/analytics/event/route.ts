import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerUser } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const { event, path, metadata } = await request.json()
    if (!event || typeof event !== 'string') {
      return NextResponse.json({ error: 'Event name required' }, { status: 400 })
    }

    // Anonymous visitors are valid: a page_view must not 401 in the console.
    // Only signed-in users with a family produce a stored activity row.
    const sessionUser = await getServerUser()
    if (!sessionUser) {
      return NextResponse.json({ success: true, skipped: true, reason: 'anonymous' })
    }

    const user = await prisma!.user.findUnique({
      where: { id: sessionUser.id },
      select: { family_id: true, name: true },
    })

    // Analytics requires a family_id in the Activity model.
    // If user has no family yet, skip logging — they'll join/create one during onboarding.
    if (!user?.family_id) {
      return NextResponse.json({ success: true, skipped: true, reason: 'no_family' })
    }

    const activity = await prisma!.activity.create({
      data: {
        family: { connect: { id: user.family_id } },
        user: { connect: { id: sessionUser.id } },
        type: 'event_' + event,
        title: event,
        description: JSON.stringify({ path, metadata }),
      },
    })

    return NextResponse.json({ success: true, id: activity.id })
  } catch (error) {
    console.error('Analytics event error:', error)
    return NextResponse.json({ error: 'Failed to log event' }, { status: 500 })
  }
}
