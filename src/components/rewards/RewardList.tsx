'use client'

import { useState, useCallback } from 'react'
import { Trophy, Gift, Star } from 'lucide-react'
import { Reward } from '@/types'
import { useToast } from '@/components/ui/toast'

interface RewardListProps {
  rewards: (Reward & { claimant?: { name: string } })[]
  userPoints: number
  userId: string
  userRole: string
  onRewardClaimed?: () => void
}

export default function RewardList({ rewards, userPoints, userId, userRole, onRewardClaimed }: RewardListProps) {
  const [localRewards, setLocalRewards] = useState(rewards)
  const [localPoints, setLocalPoints] = useState(userPoints)
  const [claimingRewardId, setClaimingRewardId] = useState<string | null>(null)
  const { addToast } = useToast()

  const availableRewards = localRewards.filter(reward => !reward.claimed_by)
  const claimedRewards = localRewards.filter(reward => reward.claimed_by === userId)

  const handleClaimReward = useCallback(async (rewardId: string, pointCost: number) => {
    if (localPoints < pointCost) {
      addToast({
        type: 'error',
        title: 'Not enough points',
        message: `You need ${pointCost - localPoints} more points to claim this reward.`,
      })
      return
    }

    setClaimingRewardId(rewardId)
    try {
      const res = await fetch('/api/rewards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to claim reward')

      // Update local state
      setLocalRewards(prev => prev.map(r =>
        r.id === rewardId ? { ...r, claimed_by: userId, claimed_at: new Date().toISOString() } : r
      ))
      setLocalPoints(prev => prev - pointCost)

      addToast({
        type: 'achievement',
        title: 'Reward Claimed!',
        message: `You spent ${pointCost} points. Enjoy your reward!`,
        duration: 4000,
      })

      onRewardClaimed?.()
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to claim reward',
        message: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setClaimingRewardId(null)
    }
  }, [localPoints, userId, addToast, onRewardClaimed])

  return (
    <div className="space-y-8">
      {/* Points display */}
      <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-blue-100 text-sm">Your Points</p>
            <p className="text-4xl font-bold">{localPoints.toLocaleString()}</p>
          </div>
          <Star className="w-12 h-12 text-blue-200" />
        </div>
      </div>

      {/* Available Rewards */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Gift className="w-5 h-5 text-green-600" />
          <h2 className="text-xl font-semibold text-gray-900">Available Rewards</h2>
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
            {availableRewards.length}
          </span>
        </div>

        {availableRewards.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableRewards.map((reward) => {
              const canAfford = localPoints >= reward.point_cost
              const isClaiming = claimingRewardId === reward.id

              return (
                <div
                  key={reward.id}
                  className={`card border-2 transition-all duration-200 ${
                    canAfford
                      ? 'border-green-200 hover:border-green-300 hover:shadow-md'
                      : 'border-gray-200 opacity-75'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{reward.title}</h3>
                      {reward.description && (
                        <p className="text-sm text-gray-600 mt-1">{reward.description}</p>
                      )}
                    </div>
                    <div className={`px-3 py-1 rounded-lg font-bold text-sm ${
                      canAfford ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {reward.point_cost} pts
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-100">
                    {canAfford ? (
                      <button
                        onClick={() => handleClaimReward(reward.id, reward.point_cost)}
                        disabled={isClaiming}
                        className="btn-primary w-full"
                      >
                        {isClaiming ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                            Claiming...
                          </span>
                        ) : (
                          'Claim Reward'
                        )}
                      </button>
                    ) : (
                      <div className="text-center">
                        <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                          <div
                            className="bg-blue-500 rounded-full h-2 transition-all"
                            style={{ width: `${Math.min((localPoints / reward.point_cost) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500">
                          {reward.point_cost - localPoints} more points needed
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12 bg-gray-50 rounded-xl">
            <Gift className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Rewards Available</h3>
            <p className="text-gray-600">
              {userRole === 'parent' ? 'Create some rewards for your family!' : 'Ask a parent to create some rewards!'}
            </p>
          </div>
        )}
      </div>

      {/* Claimed Rewards */}
      {claimedRewards.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Trophy className="w-5 h-5 text-amber-600" />
            <h2 className="text-xl font-semibold text-gray-900">Your Claimed Rewards</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {claimedRewards.map((reward) => (
              <div key={reward.id} className="card bg-amber-50 border border-amber-200">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-gray-900">{reward.title}</h3>
                    {reward.description && (
                      <p className="text-sm text-gray-600 mt-1">{reward.description}</p>
                    )}
                  </div>
                  <div className="bg-amber-100 text-amber-800 px-3 py-1 rounded-lg font-bold text-sm">
                    {reward.point_cost} pts
                  </div>
                </div>
                <div className="flex items-center text-sm text-gray-500">
                  <Trophy className="w-4 h-4 mr-2 text-amber-500" />
                  Claimed on {new Date(reward.claimed_at!).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
