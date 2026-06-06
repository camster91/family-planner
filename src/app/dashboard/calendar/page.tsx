import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
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

  // Serialize dates to ISO strings for client component
  const serializedEvents = events.map((e) => ({
    ...e,
    start_time: e.start_time.toISOString(),
    end_time: e.end_time.toISOString(),
    created_at: e.created_at.toISOString(),
  }))

  return (
    <CalendarPageClient
      events={serializedEvents as any}
      currentMonth={month}
      currentYear={year}
    />
  )
}