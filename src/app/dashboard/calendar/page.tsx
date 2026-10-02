import { after } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { attachEventSources } from '@/lib/calendar-import/source'
import { isCalendarSyncEnabled } from '@/lib/calendar-sync/config'
import { refreshStaleConnections } from '@/lib/calendar-sync/sync'
import { canImportEvents, isEventImportConfigured } from '@/lib/event-import'
import { calendarMonthQueryWindow } from '@/lib/dates'
import { isParentRole } from '@/lib/role-capabilities'
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

  // Month/year come from the URL. With none (or a hand-edited/truncated value
  // like ?month=abc or ?month=13) the server falls back to its own UTC month;
  // the client then moves to the viewer's local month if that differs (O-31).
  const now = new Date()
  const monthParam = Number(params.month)
  const yearParam = Number(params.year)
  const validMonth = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12
  const validYear = Number.isInteger(yearParam) && yearParam >= 1970 && yearParam <= 9999
  const month = validMonth ? monthParam : now.getUTCMonth() + 1
  const year = validYear ? yearParam : now.getUTCFullYear()

  // The UTC month widened by a day on each side, so an event that is in the
  // viewer's local month but the next/previous UTC month (a Toronto Oct 31
  // 8:30 PM event is stored as Nov 1 00:30Z) is fetched. The client keeps only
  // events in its local month.
  const range = calendarMonthQueryWindow(year, month)

  const events = familyId
    ? await prisma!.event.findMany({
        where: {
          family_id: familyId,
          start_time: {
            gte: range.start,
            lt: range.end,
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
      // Without a month in the URL the client picks the viewer's local month.
      monthFromUrl={validMonth}
      // Review-first import (#270): hidden unless the provider key is set and the viewer may import.
      importEnabled={isEventImportConfigured() && canImportEvents(user?.role)}
      // Edit and delete are parent-only in the API; a teen (O-37) only views and adds.
      canEditEvents={isParentRole(user?.role)}
    />
  )
}