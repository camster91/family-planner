import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import ProgressVisualization from '@/components/analytics/ProgressVisualization'
import { BarChart3, Zap, Award } from 'lucide-react'

export default async function AnalyticsPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true }
  })

  const familyId = user?.family_id || undefined

  if (!familyId) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">No Family Yet</h2>
        <p className="text-gray-600 mt-2">Join or create a family to see analytics.</p>
      </div>
    )
  }

  // Get family members for leaderboard
  const members = await prisma!.user.findMany({
    where: { family_id: familyId },
    orderBy: { xp: 'desc' },
    select: { id: true, name: true, role: true, xp: true, level: true, streak: true, best_streak: true },
  })

  const topPerformer = members[0]
  const totalFamilyXP = members.reduce((sum, m) => sum + (m.xp || 0), 0)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Family Analytics</h1>
        <p className="mt-2 text-gray-600">Track progress, streaks, and achievements.</p>
      </div>

      {/* Gamification stats bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card bg-gradient-to-br from-indigo-50 to-purple-50">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <Award className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-gray-600">Family XP</p>
              <p className="text-2xl font-bold text-gray-900">{totalFamilyXP}</p>
            </div>
          </div>
        </div>
        <div className="card bg-gradient-to-br from-orange-50 to-yellow-50">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-orange-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-gray-600">Best Streak</p>
              <p className="text-2xl font-bold text-gray-900">{topPerformer?.best_streak || 0}d</p>
            </div>
          </div>
        </div>
        <div className="card bg-gradient-to-br from-blue-50 to-cyan-50">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-blue-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-gray-600">Top Level</p>
              <p className="text-2xl font-bold text-gray-900">Lvl {topPerformer?.level || 1}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="card">
        <div className="flex items-center mb-6">
          <BarChart3 className="w-6 h-6 text-indigo-600 mr-2" />
          <h2 className="text-xl font-semibold text-gray-900">Leaderboard</h2>
        </div>
        <div className="space-y-3">
          {members.map((member, i) => (
            <div key={member.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mr-3 ${
                  i === 0 ? 'bg-yellow-100 text-yellow-700' :
                  i === 1 ? 'bg-gray-100 text-gray-700' :
                  i === 2 ? 'bg-orange-100 text-orange-700' :
                  'bg-indigo-50 text-indigo-700'
                }`}>
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-gray-900">{member.name}</p>
                  <p className="text-sm text-gray-500">Level {member.level || 1} • {member.streak || 0} day streak</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-indigo-600">{member.xp || 0} XP</p>
                {member.streak > 0 && <span className="text-sm text-orange-500">🔥 {member.streak}d</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed analytics (client-side fetched) */}
      <ProgressVisualization />
    </div>
  )
}
