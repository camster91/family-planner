import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import CalendarView from '@/components/calendar/CalendarView'

interface CalendarPageProps {
  searchParams: Promise<{ month?: string; year?: string }>
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const params = await searchParams
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Not Authenticated</h1>
          <p className="mt-2 text-gray-600">Please sign in to view the calendar.</p>
        </div>
      </div>
    )
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true },
  })

  const familyId = user?.family_id || undefined

  // Parse month/year from searchParams or default to today
  const now = new Date()
  const month = params.month ? parseInt(params.month) : now.getMonth() + 1
  const year = params.year ? parseInt(params.year) : now.getFullYear()

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

  // Fetch chores due in the month range
  const chores = familyId
    ? await prisma!.chore.findMany({
        where: {
          family_id: familyId,
          due_date: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
        include: { assignee: { select: { name: true } } },
        orderBy: { due_date: 'asc' },
      })
    : []

  // Serialize dates to ISO strings for client component
  const serializedEvents = events.map((e) => ({
    ...e,
    start_time: e.start_time.toISOString(),
    end_time: e.end_time.toISOString(),
    created_at: e.created_at.toISOString(),
  }))

  const serializedChores = chores.map((c) => ({
    ...c,
    due_date: c.due_date.toISOString(),
    created_at: c.created_at.toISOString(),
    completed_at: c.completed_at?.toISOString() ?? null,
    verified_at: c.verified_at?.toISOString() ?? null,
  }))

  return (
    <CalendarView
      events={serializedEvents as any}
      chores={serializedChores as any}
      familyId={familyId || ''}
      currentMonth={month}
      currentYear={year}
      userRole={user?.role || 'child'}
    />
  )
}
