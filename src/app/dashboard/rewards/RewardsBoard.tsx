'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Gift } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Glyph } from '@/components/ui/glyph'
import { EmptyState } from '@/components/ui/empty-state'
import { ILLUSTRATIONS } from '@/lib/brand-illustrations'
import { Dialog } from '@/components/ui/dialog'
import { useMaybeToast } from '@/components/ui/toast'
import { OFFLINE_MESSAGE, responseErrorMessage } from '@/lib/fetch-error'

export interface RewardCard {
  id: string
  name: string
  description: string | null
  icon: string | null
  cost: number
  status: string
  claimedById: string | null
  claimedByName: string | null
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  available: { label: 'Available', className: 'bg-green-100 text-green-700' },
  claimed: { label: 'Claimed', className: 'bg-yellow-100 text-yellow-700' },
  approved: { label: 'Given', className: 'bg-blue-100 text-blue-700' },
  redeemed: { label: 'Given', className: 'bg-blue-100 text-blue-700' },
}

/**
 * Rewards list and its two actions. Anyone in the household can claim an
 * available reward with their XP (POST /api/rewards/claim); a parent then
 * marks a claimed reward as given (POST /api/rewards/approve, parents only),
 * which moves it to "Given". Both refresh the server-rendered page after.
 */
export default function RewardsBoard({
  rewards,
  userXp,
  isParent,
  currentUserId,
}: {
  rewards: RewardCard[]
  userXp: number
  isParent: boolean
  currentUserId: string
}) {
  const router = useRouter()
  const { addToast } = useMaybeToast()
  const [confirming, setConfirming] = React.useState<RewardCard | null>(null)
  const [claiming, setClaiming] = React.useState(false)
  const [claimError, setClaimError] = React.useState<string | null>(null)
  const [approving, setApproving] = React.useState<string | null>(null)

  const claimable = rewards.filter((r) => r.status === 'available')

  const closeClaim = () => {
    if (claiming) return
    setConfirming(null)
    setClaimError(null)
  }

  const claim = async () => {
    if (!confirming) return
    setClaiming(true)
    setClaimError(null)
    try {
      const res = await fetch('/api/rewards/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId: confirming.id }),
      })
      if (!res.ok) {
        setClaimError(await responseErrorMessage(res))
        return
      }
      addToast({
        type: 'success',
        title: `Claimed ${confirming.name}`,
        message: isParent ? undefined : 'A parent will mark it as given.',
      })
      setConfirming(null)
      router.refresh()
    } catch {
      setClaimError(OFFLINE_MESSAGE)
    } finally {
      setClaiming(false)
    }
  }

  const approve = async (reward: RewardCard) => {
    setApproving(reward.id)
    try {
      const res = await fetch('/api/rewards/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId: reward.id }),
      })
      if (!res.ok) {
        addToast({ type: 'error', title: `Couldn't mark ${reward.name} as given`, message: await responseErrorMessage(res) })
        return
      }
      addToast({ type: 'success', title: `${reward.name} marked as given` })
      router.refresh()
    } catch {
      addToast({ type: 'error', title: `Couldn't mark ${reward.name} as given`, message: OFFLINE_MESSAGE })
    } finally {
      setApproving(null)
    }
  }

  return (
    <>
      {/* Claimable rewards */}
      {claimable.length > 0 && (
        <section aria-labelledby="claimable-rewards-heading">
          <h2 id="claimable-rewards-heading" className="section-header">
            Claimable Rewards
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {claimable.map((reward) => {
              const canClaim = userXp >= reward.cost
              return (
                <div key={reward.id} className="card-apple p-5 flex flex-col gap-4" data-testid="claimable-reward">
                  <Glyph color="rewards" size="lg">
                    <span className="text-2xl" aria-hidden="true">
                      {rewardIcon(reward.icon)}
                    </span>
                  </Glyph>
                  <div>
                    <h3 className="text-title-3 text-label-primary font-semibold">{reward.name}</h3>
                    {reward.description && (
                      <p className="text-footnote text-label-secondary mt-1 line-clamp-2">{reward.description}</p>
                    )}
                    <p className="text-subhead text-rewards font-medium mt-2">{reward.cost} XP</p>
                  </div>
                  <button
                    type="button"
                    disabled={!canClaim}
                    onClick={() => setConfirming(reward)}
                    aria-label={canClaim ? `Claim ${reward.name}` : undefined}
                    className={cn(
                      'btn-tinted w-full min-h-[44px] py-2.5 text-base font-semibold',
                      canClaim ? 'bg-rewards' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    )}
                  >
                    {canClaim ? 'Claim Reward' : `Need ${reward.cost - userXp} more XP`}
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* All family rewards */}
      <section aria-labelledby="family-rewards-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="family-rewards-heading" className="section-header">
            All Family Rewards
          </h2>
          {/* The empty state has its own create button. */}
          {isParent && rewards.length > 0 && (
            <Link href="/dashboard/rewards/create" className="btn-tinted min-h-[44px] shrink-0">
              Add reward
            </Link>
          )}
        </div>
        {rewards.length === 0 ? (
          <EmptyState
            icon={Gift}
            glyphColor="rewards"
            illustration={ILLUSTRATIONS.rewards}
            headingLevel="h3"
            title="No rewards yet"
            description={isParent ? 'Create your first reward for the family.' : 'Ask a parent to create rewards.'}
            action={
              isParent ? (
                <Link
                  href="/dashboard/rewards/create"
                  className="btn-tinted bg-rewards min-h-[44px] px-5 py-2 text-base font-medium"
                >
                  Create Reward
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-3">
            {rewards.map((reward) => {
              const badge = STATUS_BADGE[reward.status] ?? {
                label: reward.status,
                className: 'bg-gray-100 text-gray-600',
              }
              const claimedByMe = reward.claimedById === currentUserId
              const claimer = claimedByMe ? 'you' : reward.claimedByName
              return (
                <li key={reward.id} className="card-apple p-4 flex flex-wrap items-center gap-4" data-testid="family-reward">
                  <Glyph color="rewards" size="md">
                    <span className="text-lg" aria-hidden="true">
                      {rewardIcon(reward.icon)}
                    </span>
                  </Glyph>
                  <div className="flex-1 min-w-0">
                    <p className="text-body text-label-primary font-medium truncate">{reward.name}</p>
                    <p className="text-footnote text-label-secondary">
                      {reward.cost} XP
                      {reward.status === 'claimed' && claimer ? ` · Claimed by ${claimer}` : ''}
                      {reward.status === 'claimed' && claimedByMe && !isParent ? ' · Waiting for a parent' : ''}
                    </p>
                  </div>
                  <span className={cn('text-caption-1 px-2.5 py-1 rounded-full font-medium', badge.className)}>
                    {badge.label}
                  </span>
                  {isParent && reward.status === 'claimed' && (
                    <button
                      type="button"
                      onClick={() => approve(reward)}
                      disabled={approving === reward.id}
                      className="btn-filled min-h-[44px]"
                      aria-label={`Mark ${reward.name} as given`}
                    >
                      {approving === reward.id ? 'Saving…' : 'Mark as given'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Dialog
        open={confirming !== null}
        onClose={closeClaim}
        title={confirming ? `Claim ${confirming.name}?` : 'Claim reward'}
        description={
          confirming
            ? `This uses ${confirming.cost} XP. You have ${userXp} XP.${isParent ? '' : ' A parent will mark it as given.'}`
            : undefined
        }
        testId="claim-reward-dialog"
      >
        {claimError && (
          <p role="alert" className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-subhead text-[var(--danger-text)]">
            {claimError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={closeClaim} disabled={claiming} className="btn-plain min-h-[44px]">
            Cancel
          </button>
          <button type="button" onClick={claim} disabled={claiming} className="btn-filled">
            {claiming ? 'Claiming…' : 'Claim'}
          </button>
        </div>
      </Dialog>
    </>
  )
}

/** Shows the stored icon only when it is an emoji; older rows hold words like "tv". */
function rewardIcon(icon: string | null | undefined): string {
  return icon && /\p{Extended_Pictographic}/u.test(icon) ? icon : '🎁'
}
