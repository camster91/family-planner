'use client'

import { useState } from 'react'
import { Gift, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import Link from 'next/link'

interface Reward {
  id: string
  name: string
  description: string | null
  cost: number
  icon: string | null
  status: string
  created_by: string
  creator: { name: string } | null
  claimed_by: string | null
  claimer: { name: string } | null
  claimed_at: Date | string | null
  approved: boolean
  approved_by: string | null
  redeemed_at: Date | string | null
}

interface RewardListProps {
  rewards: Reward[]
  userId: string
  userXp: number
  isParent: boolean
}

export default function RewardList({ rewards, userId, userXp, isParent }: RewardListProps) {
  const [items, setItems] = useState(rewards)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClaim(rewardId: string) {
    setLoading(rewardId)
    setError(null)
    try {
      const res = await fetch('/api/rewards/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to claim reward')
        return
      }
      setItems(prev => prev.map(r => r.id === rewardId ? { ...r, status: 'claimed', claimed_by: userId, claimer: null } : r))
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(null)
    }
  }

  async function handleApprove(rewardId: string) {
    setLoading(rewardId)
    setError(null)
    try {
      const res = await fetch('/api/rewards/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to approve reward')
        return
      }
      setItems(prev => prev.map(r => r.id === rewardId ? { ...r, status: 'redeemed', approved: true } : r))
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(null)
    }
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <Gift className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500 text-lg">No rewards yet</p>
        {isParent && (
          <Link href="/dashboard/rewards/create" className="mt-4 inline-block text-blue-600 hover:text-blue-700 font-medium">
            Create your first reward →
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 flex items-center">
          <AlertCircle className="w-5 h-5 mr-2" />
          {error}
        </div>
      )}
      {items.map(reward => {
        const canClaim = reward.status === 'available' && userXp >= reward.cost
        const isClaimed = reward.status === 'claimed'
        const isRedeemed = reward.status === 'redeemed'
        const isMine = reward.claimed_by === userId

        return (
          <div key={reward.id} className={`card flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${isRedeemed ? 'opacity-75' : ''}`}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-yellow-100 to-orange-100 rounded-xl flex items-center justify-center text-2xl">
                {reward.icon || 'gift'}
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{reward.name}</h3>
                {reward.description && <p className="text-sm text-gray-500">{reward.description}</p>}
                <div className="flex items-center gap-3 mt-1 text-sm">
                  <span className="text-indigo-600 font-medium">{reward.cost} XP</span>
                  {reward.creator && <span className="text-gray-400">by {reward.creator.name}</span>}
                  {isClaimed && reward.claimer && <span className="text-yellow-600 flex items-center"><Clock className="w-3 h-3 mr-1"/>claimed by {reward.claimer.name}</span>}
                  {isRedeemed && <span className="text-green-600 flex items-center"><CheckCircle className="w-3 h-3 mr-1"/>redeemed</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {reward.status === 'available' && (
                <button
                  onClick={() => handleClaim(reward.id)}
                  disabled={!canClaim || loading === reward.id}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    canClaim
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {loading === reward.id ? 'Claiming...' : userXp < reward.cost ? `Need ${reward.cost - userXp} more XP` : 'Claim'}
                </button>
              )}
              {isClaimed && isParent && (
                <button
                  onClick={() => handleApprove(reward.id)}
                  disabled={loading === reward.id}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                >
                  {loading === reward.id ? 'Approving...' : 'Approve'}
                </button>
              )}
              {isClaimed && isMine && (
                <span className="px-4 py-2 bg-yellow-100 text-yellow-700 rounded-lg text-sm font-medium">
                  Waiting for approval
                </span>
              )}
              {isRedeemed && (
                <span className="px-4 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium flex items-center">
                  <CheckCircle className="w-4 h-4 mr-1" /> Redeemed
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
