import { Calendar, CheckCircle, MessageSquare, TrendingUp, Users, BarChart3 } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import AdminControls from '@/components/admin/AdminControls'

export default async function DashboardPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null // Should be handled by layout
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true }
  })

  // Get chore stats
  const chores = await prisma!.chore.findMany({
    where: { family_id: user?.family_id, assigned_to: sessionUser.id }
  })

  // Get upcoming events
  const events = await prisma!.event.findMany({
    where: { family_id: user?.family_id, start_time: { gte: new Date() } },
    orderBy: { start_time: 'asc' },
    take: 5
  })

  // Get unread messages
  const messages = await prisma!.message.findMany({
    where: {
      family_id: user?.family_id,
      NOT: { read_by: { has: sessionUser.id } }
    },
    take: 10
  })

  // Calculate user points from completed chores
  const completedChores = await prisma!.chore.findMany({
    where: { assigned_to: sessionUser.id, status: 'completed' },
    select: { points: true }
  })

  const userPoints = completedChores?.reduce((total, chore) => total + chore.points, 0) || 0

  // Get rewards to see what can be claimed
  const rewards = await prisma!.reward.findMany({
    where: { family_id: user?.family_id, claimed_by: null },
    select: { point_cost: true },
    orderBy: { point_cost: 'asc' }
  })

  const nextReward = rewards?.[0]?.point_cost || 100
  const pointsProgress = Math.min((userPoints / nextReward) * 100, 100)

  const stats = {
    totalChores: chores?.length || 0,
    completedChores: chores?.filter(c => c.status === 'completed' || c.status === 'verified').length || 0,
    pendingChores: chores?.filter(c => c.status === 'pending' || c.status === 'in_progress').length || 0,
    upcomingEvents: events?.length || 0,
    userPoints,
    pointsProgress,
    nextReward,
    unreadMessages: messages?.length || 0,
  }

  const completionRate = stats.totalChores > 0
    ? Math.round((stats.completedChores / stats.totalChores) * 100)
    : 0

  return (
    <div className="space-y-8">
      {/* Welcome header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          Welcome back, {user?.name}!
        </h1>
        <p className="mt-2 text-gray-600">
          {user?.family_id
            ? `Here's what's happening with your family today.`
            : `Get started by creating or joining a family.`
          }
        </p>
      </div>

      {/* Family status */}
      {!user?.family_id && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-center">
            <Users className="w-8 h-8 text-blue-600 mr-4" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">No Family Yet</h3>
              <p className="text-gray-600 mt-1">
                Create a new family or join an existing one to start using Family Planner.
              </p>
              <div className="mt-4 flex space-x-4">
                <Link
                  href="/dashboard/family/create"
                  className="btn-primary"
                >
                  Create Family
                </Link>
                <Link
                  href="/dashboard/family/join"
                  className="btn-secondary"
                >
                  Join Family
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Completion Rate</p>
              <p className="text-2xl font-semibold text-gray-900">{completionRate}%</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-600 h-2 rounded-full"
                style={{ width: `${completionRate}%` }}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0 w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <span className="text-xl font-bold text-yellow-600">⭐</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Your Points</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.userPoints}</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>Progress to next reward</span>
              <span>{stats.userPoints}/{stats.nextReward}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-yellow-500 h-2 rounded-full"
                style={{ width: `${stats.pointsProgress}%` }}
              />
            </div>
            <Link
              href="/dashboard/rewards"
              className="mt-2 inline-block text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              {stats.pointsProgress >= 100 ? 'Claim reward! →' : 'View rewards →'}
            </Link>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Pending Chores</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.pendingChores}</p>
            </div>
          </div>
          <Link
            href="/dashboard/chores"
            className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            View all chores →
          </Link>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0 w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <Calendar className="w-6 h-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Upcoming Events</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.upcomingEvents}</p>
            </div>
          </div>
          <Link
            href="/dashboard/calendar"
            className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            View calendar →
          </Link>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent chores */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Recent Chores</h2>
            <Link
              href="/dashboard/chores"
              className="text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              View all
            </Link>
          </div>
          <div className="space-y-4">
            {chores?.slice(0, 5).map((chore) => (
              <div key={chore.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{chore.title}</p>
                  <p className="text-sm text-gray-600">
                    Due {new Date(chore.due_date).toLocaleDateString()}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  chore.status === 'completed' || chore.status === 'verified'
                    ? 'bg-green-100 text-green-800'
                    : chore.status === 'in_progress'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {chore.status.replace('_', ' ')}
                </span>
              </div>
            ))}
            {(!chores || chores.length === 0) && (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No chores assigned yet</p>
                <Link
                  href="/dashboard/chores/create"
                  className="mt-4 inline-block text-blue-600 hover:text-blue-500 font-medium"
                >
                  Create your first chore
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming events */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Upcoming Events</h2>
            <Link
              href="/dashboard/calendar"
              className="text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              View all
            </Link>
          </div>
          <div className="space-y-4">
            {events?.map((event) => (
              <div key={event.id} className="p-3 bg-gray-50 rounded-lg">
                <div className="flex items-start">
                  <div className="flex-shrink-0 mt-1">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                  </div>
                  <div className="ml-3">
                    <p className="font-medium text-gray-900">{event.title}</p>
                    <p className="text-sm text-gray-600">
                      {new Date(event.start_time).toLocaleDateString()} •{' '}
                      {new Date(event.start_time).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                    {event.location && (
                      <p className="text-sm text-gray-500 mt-1">📍 {event.location}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {(!events || events.length === 0) && (
              <div className="text-center py-8">
                <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No upcoming events</p>
                <Link
                  href="/dashboard/calendar/create"
                  className="mt-4 inline-block text-blue-600 hover:text-blue-500 font-medium"
                >
                  Add an event
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Progress Analytics Preview */}
      <div className="card bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center mr-4">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Track Your Family's Progress</h3>
              <p className="text-sm text-gray-600">See detailed analytics, trends, and achievements</p>
            </div>
          </div>
          <Link
            href="/dashboard/analytics"
            className="btn-primary"
          >
            View Analytics
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-indigo-600">Weekly Trends</div>
            <p className="text-sm text-gray-600 mt-2">See chore completion and points earned over time</p>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">Top Performers</div>
            <p className="text-sm text-gray-600 mt-2">Discover who's contributing the most in your family</p>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-pink-600">Achievement Tracking</div>
            <p className="text-sm text-gray-600 mt-2">Monitor streaks and celebrate family milestones</p>
          </div>
        </div>
      </div>

      {/* Quick tips */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6">
        <div className="flex items-center mb-4">
          <TrendingUp className="w-6 h-6 text-blue-600 mr-3" />
          <h3 className="text-lg font-semibold text-gray-900">Quick Tips</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Assign Chores</h4>
            <p className="text-sm text-gray-600">
              Create age-appropriate chores and assign them to family members to build responsibility.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Schedule Events</h4>
            <p className="text-sm text-gray-600">
              Add family events to the shared calendar so everyone knows what's happening.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Communicate</h4>
            <p className="text-sm text-gray-600">
              Use the family messaging system to share announcements and stay connected.
            </p>
          </div>
        </div>
      </div>

      {/* Admin controls (only visible to parents) */}
      <AdminControls />
    </div>
  )
}
