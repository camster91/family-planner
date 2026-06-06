'use client'

import { useState } from 'react'
import { Gift, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Glyph } from '@/components/ui/glyph'

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
    <div className="space-y-6">
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
          <div key={reward.id} className={cn('card-apple p-5', isRedeemed && 'opacity-60')}>
            <div className="flex items-center gap-4">
              {/* Icon glyph */}
              <Glyph color="rewards" size="lg">
                <span className="text-xl">{reward.icon || '🎁'}</span>
              </Glyph>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h3 className="text-title-3 text-label-primary font-semibold">{reward.name}</h3>
                {reward.description && (
                  <p className="text-subhead text-label-secondary mt-0.5 line-clamp-1">{reward.description}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5 text-footnote text-label-secondary">
                  <span className="text-rewards font-medium">{reward.cost} XP</span>
                  {reward.creator && <span>by {reward.creator.name}</span>}
                  {isClaimed && reward.claimer && (
                    <span className="flex items-center gap-1 text-yellow-600">
                      <Clock className="w-3 h-3" /> claimed by {reward.claimer.name}
                    </span>
                  )}
                  {isRedeemed && (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle className="w-3 h-3" /> redeemed
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                {reward.status === 'available' && (
                  <button
                    onClick={() => handleClaim(reward.id)}
                    disabled={!canClaim || loading === reward.id}
                    className={cn(
                      'btn-tinted text-sm px-4 py-2 min-w-[80px]',
                      canClaim ? 'bg-rewards' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    )}
                  >
                    {loading === reward.id ? '...' : userXp < reward.cost ? `${reward.cost - userXp} XP` : 'Claim'}
                  </button>
                )}
                {isClaimed && isParent && (
                  <button
                    onClick={() => handleApprove(reward.id)}
                    disabled={loading === reward.id}
                    className="btn-tinted bg-green-600 text-sm px-4 py-2"
                  >
                    {loading === reward.id ? '...' : 'Approve'}
                  </button>
                )}
                {isClaimed && isMine && (
                  <span className="text-caption-1 text-yellow-600 px-3 py-1.5 bg-yellow-50 rounded-full font-medium">
                    Waiting
                  </span>
                )}
                {isRedeemed && (
                  <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
                    <CheckCircle className="w-4 h-4" /> Redeemed
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}