'use client'

import { useState } from 'react'
import { Trophy, Gift, CheckCircle, AlertCircle } from 'lucide-react'
import { Reward } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { notificationService } from '@/lib/notifications'

interface RewardListProps {
  rewards: (Reward & { claimant?: { name: string } })[]
  userPoints: number
  userId: string
  userRole: string
}

export default function RewardList({ rewards, userPoints, userId, userRole }: RewardListProps) {
  const [claimingRewardId, setClaimingRewardId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const supabase = createClient()

  const availableRewards = rewards.filter(reward => !reward.claimed_by)
  const claimedRewards = rewards.filter(reward => reward.claimed_by === userId)

  const handleClaimReward = async (rewardId: string, pointCost: number) => {
    if (userPoints < pointCost) {
      setError(`You need ${pointCost - userPoints} more points to claim this reward`)
      return
    }

    setClaimingRewardId(rewardId)
    setError(null)
    setSuccess(null)

    try {
      const { error: updateError } = await supabase
        .from('rewards')
        .update({
          claimed_by: userId,
          claimed_at: new Date().toISOString(),
        })
        .eq('id', rewardId)

      if (updateError) throw updateError

      // Send notification to parents
      const { data: parents } = await supabase
        .from('users')
        .select('id')
        .eq('role', 'parent')
        .eq('family_id', (await supabase.auth.getUser()).data.user?.id ? 
          await supabase.from('users').select('family_id').eq('id', userId).single().then(r => r.data?.family_id) : null)

      if (parents && parents.length > 0) {
        const reward = rewards.find(r => r.id === rewardId)
        const { data: { user } } = await supabase.auth.getUser()
        const userName = user?.user_metadata?.name || 'A family member'
        
        await Promise.all(parents.map(parent => 
          notificationService.sendNotification({
            userId: parent.id,
            title: 'Reward Claimed! 🎉',
            message: `${userName} claimed "${reward?.title}" for ${pointCost} points`,
            type: 'reward'
          })
        ))
      }

      setSuccess(`You successfully claimed the reward for ${pointCost} points!`)
      
      // Refresh page after a delay
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } catch (err) {
      console.error('Error claiming reward:', err)
      setError('Failed to claim reward. Please try again.')
    } finally {
      setClaimingRewardId(null)
    }
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
          <div className="flex items-center">
            <AlertCircle className="w-5 h-5 mr-3" />
            {error}
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md">
          <div className="flex items-center">
            <CheckCircle className="w-5 h-5 mr-3" />
            {success}
          </div>
        </div>
      )}

      {/* Available Rewards */}
      <div className="space-y-6">
        <div className="flex items-center">
          <Gift className="w-5 h-5 text-green-600 mr-3" />
          <h2 className="text-xl font-semibold text-gray-900">Available Rewards</h2>
          <span className="ml-3 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
            {availableRewards.length} available
          </span>
        </div>

        {availableRewards.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {availableRewards.map((reward) => (
              <div
                key={reward.id}
                className="card border-2 border-green-200 hover:border-green-300 transition"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">{reward.title}</h3>
                    <p className="text-sm text-gray-600 mt-1">{reward.description}</p>
                  </div>
                  <div className="bg-green-100 text-green-800 px-3 py-1 rounded-lg font-semibold">
                    {reward.point_cost} pts
                  </div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm text-gray-600">Your points:</span>
                    <span className="font-semibold text-gray-900">{userPoints}</span>
                  </div>
                  
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-sm text-gray-600">Can you afford it?</span>
                    <span className={`font-medium ${
                      userPoints >= reward.point_cost 
                        ? 'text-green-600' 
                        : 'text-red-600'
                    }`}>
                      {userPoints >= reward.point_cost ? 'Yes!' : `${reward.point_cost - userPoints} more needed`}
                    </span>
                  </div>
                  
                  {userPoints >= reward.point_cost && (
                    <button
                      onClick={() => handleClaimReward(reward.id, reward.point_cost)}
                      disabled={claimingRewardId === reward.id || userRole !== 'parent'}
                      className="btn-primary w-full"
                    >
                      {claimingRewardId === reward.id ? (
                        <div className="flex items-center justify-center">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Claiming...
                        </div>
                      ) : (
                        'Claim Reward'
                      )}
                    </button>
                  )}

                  {userRole !== 'parent' && (
                    <p className="text-sm text-gray-500 text-center mt-2">
                      Ask a parent to claim this reward for you
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-gray-50 rounded-xl">
            <Gift className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Rewards Available</h3>
            <p className="text-gray-600">
              {userRole === 'parent' 
                ? 'Create some rewards for your family!' 
                : 'Ask a parent to create some rewards!'}
            </p>
          </div>
        )}
      </div>

      {/* Claimed Rewards */}
      {claimedRewards.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center">
            <Trophy className="w-5 h-5 text-blue-600 mr-3" />
            <h2 className="text-xl font-semibold text-gray-900">Your Claimed Rewards</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {claimedRewards.map((reward) => (
              <div
                key={reward.id}
                className="card bg-blue-50 border border-blue-200"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">{reward.title}</h3>
                    <p className="text-sm text-gray-600 mt-1">{reward.description}</p>
                  </div>
                  <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded-lg font-semibold">
                    {reward.point_cost} pts
                  </div>
                </div>
                
                <div className="flex items-center text-sm text-gray-600">
                  <Trophy className="w-4 h-4 mr-2" />
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