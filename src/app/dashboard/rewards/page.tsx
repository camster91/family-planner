import { Trophy, PlusCircle, Star } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import RewardList from '@/components/rewards/RewardList'
import ExportButton from '@/components/common/ExportButton'

export default async function RewardsPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true }
  })

  if (!user) {
    return null
  }

  const familyId = user.family_id || undefined

  // Get rewards for the family
  const rewards = familyId ? await prisma!.reward.findMany({
    where: { family_id: familyId },
    include: { claimant: { select: { name: true } } },
    orderBy: { point_cost: 'asc' }
  }) : []

  // Use stored user points (from gamification system)
  const userPoints = user.points || 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Rewards</h1>
          <p className="mt-2 text-gray-600">
            Redeem your points for awesome rewards!
          </p>
        </div>
        <div className="flex gap-2">
          {rewards && rewards.length > 0 && (
            <ExportButton data={rewards} filename="rewards" label="Export" />
          )}
          {user.role === 'parent' && (
            <Link
              href="/dashboard/rewards/create"
              className="btn-primary inline-flex items-center"
            >
              <PlusCircle className="w-5 h-5 mr-2" />
              Create Reward
            </Link>
          )}
        </div>
      </div>

      {/* Points Summary */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center mr-4">
              <Star className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Your Points</p>
              <div className="flex items-baseline">
                <span className="text-3xl font-bold text-gray-900">{userPoints}</span>
                <span className="ml-2 text-gray-600">points</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600">Family Rewards</p>
            <p className="text-2xl font-semibold text-gray-900">{rewards?.length || 0}</p>
          </div>
        </div>
      </div>

      {/* Reward List Component */}
      <RewardList
        rewards={rewards as any || []}
        userPoints={userPoints}
        userId={sessionUser.id}
        userRole={user.role}
      />

      {/* How It Works */}
      <div className="card bg-gradient-to-r from-purple-50 to-pink-50">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">How Rewards Work</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <span className="font-bold text-purple-600">1</span>
            </div>
            <h4 className="font-medium text-gray-900">Complete Chores</h4>
            <p className="text-sm text-gray-600">
              Earn points by completing chores assigned to you.
            </p>
          </div>
          <div className="space-y-2">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <span className="font-bold text-purple-600">2</span>
            </div>
            <h4 className="font-medium text-gray-900">Save Points</h4>
            <p className="text-sm text-gray-600">
              Your points add up as you complete more chores.
            </p>
          </div>
          <div className="space-y-2">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <span className="font-bold text-purple-600">3</span>
            </div>
            <h4 className="font-medium text-gray-900">Claim Rewards</h4>
            <p className="text-sm text-gray-600">
              Redeem your points for rewards created by parents.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
