import { PlusCircle, Gift } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import RewardList from '@/components/rewards/RewardList'

export default async function RewardsPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true }
  })

  const familyId = user?.family_id || undefined

  // Get rewards for the family
  const rewards = familyId ? await prisma!.reward.findMany({
    where: { family_id: familyId },
    include: {
      creator: { select: { name: true } },
      claimer: { select: { name: true } },
    },
    orderBy: { created_at: 'desc' }
  }) : []

  // Get user's XP
  const userXp = user?.xp || 0

  // Stats
  const stats = {
    total: rewards.length,
    available: rewards.filter(r => r.status === 'available').length,
    claimed: rewards.filter(r => r.status === 'claimed').length,
    redeemed: rewards.filter(r => r.status === 'redeemed').length,
  }

  const isParent = user?.role === 'parent'

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Rewards</h1>
          <p className="mt-2 text-gray-600">
            Claim rewards with your earned XP!
          </p>
        </div>
        {isParent && (
          <Link
            href="/dashboard/rewards/create"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            <PlusCircle className="w-5 h-5 mr-2" />
            Add Reward
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Gift className="w-5 h-5 text-blue-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-gray-600">Total</p>
              <p className="text-xl font-semibold">{stats.total}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <span className="text-lg">✨</span>
            </div>
            <div className="ml-3">
              <p className="text-sm text-gray-600">Available</p>
              <p className="text-xl font-semibold">{stats.available}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0 w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
              <span className="text-lg">⏳</span>
            </div>
            <div className="ml-3">
              <p className="text-sm text-gray-600">Claimed</p>
              <p className="text-xl font-semibold">{stats.claimed}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0 w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <span className="text-lg">🏆</span>
            </div>
            <div className="ml-3">
              <p className="text-sm text-gray-600">Redeemed</p>
              <p className="text-xl font-semibold">{stats.redeemed}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Your XP */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-2xl mr-3">⭐</span>
            <div>
              <p className="text-sm text-gray-600">Your XP Balance</p>
              <p className="text-2xl font-bold text-indigo-600">{userXp} XP</p>
            </div>
          </div>
          <Link href="/dashboard/analytics" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
            View Leaderboard →
          </Link>
        </div>
      </div>

      {/* Reward list */}
      <RewardList
        rewards={rewards}
        userId={sessionUser.id}
        userXp={userXp}
        isParent={isParent}
      />
    </div>
  )
}
