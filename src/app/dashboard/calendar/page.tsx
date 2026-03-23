import { PlusCircle, Calendar as CalendarIcon } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export default async function CalendarPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true }
  })

  // Get events for the family
  const events = await prisma!.event.findMany({
    where: {
      family_id: user?.family_id,
      start_time: { gte: new Date() }
    },
    include: { creator: { select: { name: true } } },
    orderBy: { start_time: 'asc' },
    take: 20
  })

  // Group events by date
  const eventsByDate: Record<string, any[]> = {}
  events?.forEach((event: any) => {
    const date = new Date(event.start_time).toDateString()
    if (!eventsByDate[date]) {
      eventsByDate[date] = []
    }
    eventsByDate[date].push(event)
  })

  // Get today's date for display
  const today = new Date()
  const todayString = today.toDateString()

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Calendar</h1>
          <p className="mt-2 text-gray-600">
            View and manage family events, appointments, and activities.
          </p>
        </div>
        <Link
          href="/dashboard/calendar/create"
          className="btn-primary inline-flex items-center"
        >
          <PlusCircle className="w-5 h-5 mr-2" />
          New Event
        </Link>
      </div>

      {/* Calendar view placeholder */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Upcoming Events</h2>
          <div className="text-sm text-gray-600">
            {events?.length || 0} upcoming events
          </div>
        </div>

        {events && events.length > 0 ? (
          <div className="space-y-6">
            {Object.entries(eventsByDate).map(([date, dateEvents]) => (
              <div key={date}>
                <div className="flex items-center mb-4">
                  <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {date === todayString ? 'Today' : new Date(date).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </h3>
                </div>
                <div className="space-y-4 ml-5 pl-5 border-l border-gray-200">
                  {dateEvents.map((event) => (
                    <div
                      key={event.id}
                      className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900">{event.title}</h4>
                          {event.description && (
                            <p className="text-sm text-gray-600 mt-1">{event.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-gray-500">
                            <div>
                              🕒 {new Date(event.start_time).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                              {event.end_time && (
                                <> - {new Date(event.end_time).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}</>
                              )}
                            </div>
                            {event.location && (
                              <div>📍 {event.location}</div>
                            )}
                            {event.creator && (
                              <div>👤 Created by {event.creator.name}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                            Event
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CalendarIcon className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No upcoming events</h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Add family events, appointments, and activities to keep everyone coordinated.
            </p>
            <Link
              href="/dashboard/calendar/create"
              className="btn-primary"
            >
              Add Your First Event
            </Link>
          </div>
        )}
      </div>

      {/* Calendar tips */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Calendar Tips</h3>
          <ul className="space-y-3">
            <li className="flex items-start">
              <div className="flex-shrink-0 mt-1">📅</div>
              <span className="ml-3 text-gray-700">Add all family members' schedules in one place</span>
            </li>
            <li className="flex items-start">
              <div className="flex-shrink-0 mt-1">🔔</div>
              <span className="ml-3 text-gray-700">Set reminders for important events and appointments</span>
            </li>
            <li className="flex items-start">
              <div className="flex-shrink-0 mt-1">👨‍👩‍👧‍👦</div>
              <span className="ml-3 text-gray-700">Color-code events by family member or type</span>
            </li>
            <li className="flex items-start">
              <div className="flex-shrink-0 mt-1">🔄</div>
              <span className="ml-3 text-gray-700">Set recurring events for weekly activities</span>
            </li>
          </ul>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Coming Soon</h3>
          <ul className="space-y-3">
            <li className="flex items-start">
              <div className="flex-shrink-0 mt-1">📱</div>
              <span className="ml-3 text-gray-700">Mobile calendar sync</span>
            </li>
            <li className="flex items-start">
              <div className="flex-shrink-0 mt-1">🌤️</div>
              <span className="ml-3 text-gray-700">Weather integration for outdoor events</span>
            </li>
            <li className="flex items-start">
              <div className="flex-shrink-0 mt-1">🗺️</div>
              <span className="ml-3 text-gray-700">Location maps and directions</span>
            </li>
            <li className="flex items-start">
              <div className="flex-shrink-0 mt-1">📧</div>
              <span className="ml-3 text-gray-700">Email event invitations</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
