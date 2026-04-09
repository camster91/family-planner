import { BarChart3, TrendingUp, Users, Award } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import ProgressVisualization from '@/components/analytics/ProgressVisualization'
import Leaderboard from '@/components/gamification/Leaderboard'
import ActivityFeed from '@/components/activity/ActivityFeed'

export default async function AnalyticsPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true }
  })

  if (!user || !user.family_id) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="card text-center py-12">
          <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-4">No Family Yet</h2>
          <p className="text-gray-600 mb-6">
            Join or create a family to see analytics and progress tracking.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/dashboard/family/create"
              className="btn-primary"
            >
              Create Family
            </Link>
            <Link
              href="/join"
              className="btn-secondary"
            >
              Join Family
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center mb-4">
          <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg flex items-center justify-center mr-4">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Family Analytics</h1>
            <p className="text-gray-600 mt-2">
              Track your family&apos;s progress, participation, and achievements
            </p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center mr-4">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-blue-700">Progress Tracking</p>
              <p className="text-2xl font-semibold text-blue-900">Real-time</p>
            </div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center mr-4">
              <Award className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-green-700">Achievements</p>
              <p className="text-2xl font-semibold text-green-900">Unlockable</p>
            </div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-yellow-500 rounded-lg flex items-center justify-center mr-4">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-yellow-700">Family Insights</p>
              <p className="text-2xl font-semibold text-yellow-900">Shared</p>
            </div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-purple-500 rounded-lg flex items-center justify-center mr-4">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-purple-700">Weekly Trends</p>
              <p className="text-2xl font-semibold text-purple-900">Visualized</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Analytics Content */}
      <ProgressVisualization />

      {/* Leaderboard and Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Family Leaderboard</h2>
          <Leaderboard currentUserId={sessionUser.id} />
        </div>
        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Recent Activity</h2>
          <ActivityFeed />
        </div>
      </div>

      {/* How to Improve */}
      <div className="card bg-gradient-to-r from-indigo-50 to-purple-50">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Tips to Improve Family Engagement</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <span className="font-bold text-indigo-600">1</span>
            </div>
            <h4 className="font-medium text-gray-900">Set Daily Goals</h4>
            <p className="text-sm text-gray-700">
              Aim for 2-3 chores per family member daily to build consistent habits.
            </p>
          </div>
          <div className="space-y-2">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <span className="font-bold text-indigo-600">2</span>
            </div>
            <h4 className="font-medium text-gray-900">Celebrate Milestones</h4>
            <p className="text-sm text-gray-700">
              Recognize when family members reach 10, 25, or 50 completed chores.
            </p>
          </div>
          <div className="space-y-2">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <span className="font-bold text-indigo-600">3</span>
            </div>
            <h4 className="font-medium text-gray-900">Balance Difficulties</h4>
            <p className="text-sm text-gray-700">
              Mix easy, medium, and hard chores to keep everyone challenged but not overwhelmed.
            </p>
          </div>
        </div>
      </div>

      {/* Links to other features */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link
          href="/dashboard/chores"
          className="card hover:shadow-md transition cursor-pointer"
        >
          <div className="flex items-center">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mr-4">
              <span className="text-green-600 font-bold">✓</span>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Manage Chores</h3>
              <p className="text-sm text-gray-600">Create and assign new chores to keep the momentum going</p>
            </div>
          </div>
        </Link>

        <Link
          href="/dashboard/rewards"
          className="card hover:shadow-md transition cursor-pointer"
        >
          <div className="flex items-center">
            <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center mr-4">
              <span className="text-yellow-600 font-bold">⭐</span>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Redeem Rewards</h3>
              <p className="text-sm text-gray-600">Use earned points to claim exciting family rewards</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}
