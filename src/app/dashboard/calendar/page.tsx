import { after } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { attachEventSources } from '@/lib/calendar-import/source'
import { isCalendarSyncEnabled } from '@/lib/calendar-sync/config'
import { refreshStaleConnections } from '@/lib/calendar-sync/sync'
import { canImportEvents, isEventImportConfigured } from '@/lib/event-import'
import CalendarPageClient from './CalendarPageClient'

interface CalendarPageProps {
  searchParams: Promise<{ month?: string; year?: string }>
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const params = await searchParams
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true, role: true },
  })

  const familyId = user?.family_id || undefined

  // Two-way Google/Microsoft sync (#264): opportunistic, after the response is
  // sent, at most once per connection per 5 minutes (DB-backed lease). No
  // scheduler (AGENTS.md). Dormant unless calendar sync is configured.
  if (familyId && isCalendarSyncEnabled()) {
    const syncFamilyId = familyId
    after(() => refreshStaleConnections(syncFamilyId))
  }

  // Parse month/year from searchParams or default to today
  const now = new Date()
  // A hand-edited or truncated URL (?month=abc, ?month=13) falls back to the
  // current month instead of building an Invalid Date query and a 500 page.
  const monthParam = Number(params.month)
  const yearParam = Number(params.year)
  const month = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : now.getMonth() + 1
  const year = Number.isInteger(yearParam) && yearParam >= 1970 && yearParam <= 9999 ? yearParam : now.getFullYear()

  // Calculate month boundaries
  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999)

  // Fetch events for the month range
  const events = familyId
    ? await prisma!.event.findMany({
        where: {
          family_id: familyId,
          start_time: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
        include: { creator: { select: { name: true } } },
        orderBy: { start_time: 'asc' },
      })
    : []

  // Imported events (#232) get their subscription name for the "From …" badge.
  const withSources = familyId ? await attachEventSources(prisma!, familyId, events) : []

  // Serialize dates to ISO strings for client component
  const serializedEvents = withSources.map((e) => ({
    ...e,
    start_time: e.start_time.toISOString(),
    end_time: e.end_time.toISOString(),
    created_at: e.created_at.toISOString(),
    updated_at: e.updated_at ? e.updated_at.toISOString() : null,
    source_occurrence_start: e.source_occurrence_start ? e.source_occurrence_start.toISOString() : null,
  }))

  return (
    <CalendarPageClient
      events={serializedEvents as any}
      currentMonth={month}
      currentYear={year}
      // Review-first import (#270): hidden unless the provider key is set and the viewer may import.
      importEnabled={isEventImportConfigured() && canImportEvents(user?.role)}
    />
  )
}