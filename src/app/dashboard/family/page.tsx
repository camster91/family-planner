import { Users, UserPlus, Settings, Award, Calendar } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export default async function FamilyPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true }
  })

  const familyId = user?.family_id || undefined

  // Get family members
  const familyMembers = familyId ? await prisma!.user.findMany({
    where: { family_id: familyId },
    select: { id: true, name: true, email: true, role: true, age: true, avatar_url: true, created_at: true },
    orderBy: { role: 'desc' }
  }) : []

  // Get family stats
  const chores = familyId ? await prisma!.chore.findMany({
    where: { family_id: familyId }
  }) : []

  const events = familyId ? await prisma!.event.findMany({
    where: { family_id: familyId, start_time: { gte: new Date() } }
  }) : []

  const stats = {
    totalMembers: familyMembers?.length || 0,
    parents: familyMembers?.filter(m => m.role === 'parent').length || 0,
    children: familyMembers?.filter(m => m.role === 'child' || m.role === 'teen').length || 0,
    totalChores: chores?.length || 0,
    upcomingEvents: events?.length || 0,
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'parent': return 'bg-blue-100 text-blue-800'
      case 'teen': return 'bg-purple-100 text-purple-800'
      case 'child': return 'bg-green-100 text-green-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <div className="space-y-8">
      {/* Family header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {user?.family?.name || 'Your Family'}
          </h1>
          <p className="mt-2 text-gray-600">
            Manage your family members and settings.
          </p>
        </div>
        <div className="flex space-x-4">
          <Link
            href="/dashboard/family/invite"
            className="btn-primary inline-flex items-center"
          >
            <UserPlus className="w-5 h-5 mr-2" />
            Invite Member
          </Link>
          <Link
            href="/dashboard/family/settings"
            className="btn-secondary inline-flex items-center"
          >
            <Settings className="w-5 h-5 mr-2" />
            Family Settings
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="card text-center">
          <div className="text-2xl font-bold text-gray-900">{stats.totalMembers}</div>
          <div className="text-sm text-gray-600">Family Members</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.parents}</div>
          <div className="text-sm text-gray-600">Parents</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-green-600">{stats.children}</div>
          <div className="text-sm text-gray-600">Children</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-yellow-600">{stats.totalChores}</div>
          <div className="text-sm text-gray-600">Active Chores</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-purple-600">{stats.upcomingEvents}</div>
          <div className="text-sm text-gray-600">Upcoming Events</div>
        </div>
      </div>

      {/* Family members */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Family Members</h2>
          <div className="text-sm text-gray-600">
            {stats.totalMembers} members • {user?.role === 'parent' ? 'Admin' : 'Member'}
          </div>
        </div>

        {familyMembers && familyMembers.length > 0 ? (
          <div className="space-y-4">
            {familyMembers.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
              >
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-lg">
                      {getInitials(member.name)}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900">{member.name}</h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(member.role)}`}>
                        {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{member.email}</p>
                    {member.age && (
                      <p className="text-sm text-gray-500 mt-1">Age: {member.age}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="text-right">
                    <div className="text-sm text-gray-600">
                      Joined {new Date(member.created_at).toLocaleDateString()}
                    </div>
                    {member.id === sessionUser.id && (
                      <div className="text-xs text-blue-600 font-medium mt-1">You</div>
                    )}
                  </div>
                  {user?.role === 'parent' && member.id !== sessionUser.id && (
                    <button className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-md">
                      <Settings className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No family members yet</h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Invite family members to join your family and start organizing together.
            </p>
            <Link
              href="/dashboard/family/invite"
              className="btn-primary inline-flex items-center"
            >
              <UserPlus className="w-5 h-5 mr-2" />
              Invite Your First Member
            </Link>
          </div>
        )}
      </div>

      {/* Family management cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Family goals */}
        <div className="card">
          <div className="flex items-center mb-6">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mr-4">
              <Award className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Family Goals</h3>
              <p className="text-gray-600">Set and track family goals</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="font-medium text-gray-900">Weekly chore completion</div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div className="bg-green-600 h-2 rounded-full" style={{ width: '75%' }} />
              </div>
              <div className="text-xs text-gray-600 mt-2">75% complete • 3 days left</div>
            </div>
            <button className="w-full p-3 text-center text-blue-600 hover:bg-blue-50 rounded-lg border-2 border-dashed border-blue-200">
              + Set new goal
            </button>
          </div>
        </div>

        {/* Upcoming events */}
        <div className="card">
          <div className="flex items-center mb-6">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-4">
              <Calendar className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Upcoming Events</h3>
              <p className="text-gray-600">Next family activities</p>
            </div>
          </div>
          <div className="space-y-4">
            {events && events.slice(0, 3).map((event) => (
              <div key={event.id} className="p-3 bg-gray-50 rounded-lg">
                <div className="font-medium text-gray-900">{event.title}</div>
                <div className="text-sm text-gray-600">
                  {new Date(event.start_time).toLocaleDateString()} •{' '}
                  {new Date(event.start_time).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              </div>
            ))}
            {(!events || events.length === 0) && (
              <div className="p-3 bg-gray-50 rounded-lg text-center">
                <div className="text-gray-500">No upcoming events</div>
              </div>
            )}
            <Link
              href="/dashboard/calendar"
              className="block w-full p-3 text-center text-blue-600 hover:bg-blue-50 rounded-lg border-2 border-blue-200"
            >
              View all events
            </Link>
          </div>
        </div>

        {/* Quick actions */}
        <div className="card">
          <div className="flex items-center mb-6">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mr-4">
              <Settings className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Quick Actions</h3>
              <p className="text-gray-600">Manage your family</p>
            </div>
          </div>
          <div className="space-y-3">
            <Link
              href="/dashboard/family/invite"
              className="flex items-center p-3 text-gray-700 hover:bg-gray-50 rounded-lg"
            >
              <UserPlus className="w-5 h-5 mr-3 text-blue-600" />
              <div>
                <div className="font-medium">Invite Member</div>
                <div className="text-sm text-gray-600">Send invitation to join</div>
              </div>
            </Link>
            <Link
              href="/dashboard/family/settings"
              className="flex items-center p-3 text-gray-700 hover:bg-gray-50 rounded-lg"
            >
              <Settings className="w-5 h-5 mr-3 text-blue-600" />
              <div>
                <div className="font-medium">Family Settings</div>
                <div className="text-sm text-gray-600">Manage preferences</div>
              </div>
            </Link>
            <Link
              href="/dashboard/chores/create"
              className="flex items-center p-3 text-gray-700 hover:bg-gray-50 rounded-lg"
            >
              <Award className="w-5 h-5 mr-3 text-green-600" />
              <div>
                <div className="font-medium">Create Chore</div>
                <div className="text-sm text-gray-600">Assign new responsibility</div>
              </div>
            </Link>
            <Link
              href="/dashboard/calendar/create"
              className="flex items-center p-3 text-gray-700 hover:bg-gray-50 rounded-lg"
            >
              <Calendar className="w-5 h-5 mr-3 text-yellow-600" />
              <div>
                <div className="font-medium">Add Event</div>
                <div className="text-sm text-gray-600">Schedule activity</div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
