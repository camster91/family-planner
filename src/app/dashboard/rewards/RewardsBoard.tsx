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
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from '@/lib/idempotency-key'
import { useRewardsText } from '@/i18n/rewards'

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

const STATUS_BADGE: Record<string, { key: 'available' | 'claimed' | 'given'; className: string }> = {
  available: { key: 'available', className: 'bg-[var(--success-tint)] text-success-text' },
  claimed: { key: 'claimed', className: 'bg-[var(--warning-tint)] text-warning-text' },
  approved: { key: 'given', className: 'bg-[var(--accent-tint)] text-primary' },
  redeemed: { key: 'given', className: 'bg-[var(--accent-tint)] text-primary' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Validate the server DTO before treating a 2xx response as confirmed. */
export function parseRewardCard(value: unknown): RewardCard | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const cost = typeof value.cost === 'number' ? value.cost : Number.NaN
  const status = typeof value.status === 'string' ? value.status : ''
  if (!id || !name || !Number.isFinite(cost) || cost < 0 || !status) return null
  return {
    id,
    name,
    description: stringOrNull(value.description),
    icon: stringOrNull(value.icon),
    cost,
    status,
    claimedById: stringOrNull(value.claimedById ?? value.claimed_by),
    claimedByName: stringOrNull(value.claimedByName ?? value.claimed_by_name ?? (isRecord(value.claimer) ? value.claimer.name : null)),
  }
}

function parseRewardResponse(value: unknown): RewardCard | null {
  return isRecord(value) ? parseRewardCard(value.reward) : null
}

function parseClaimResponse(value: unknown): { reward: RewardCard; xp: number } | null {
  const reward = parseRewardResponse(value)
  const xp = isRecord(value) ? value.xp : null
  if (!reward || typeof xp !== 'number' || !Number.isFinite(xp) || xp < 0) return null
  return { reward, xp }
}

function parseRewardList(value: unknown): RewardCard[] | null {
  if (!isRecord(value) || !Array.isArray(value.rewards)) return null
  const parsed = value.rewards.map(parseRewardCard)
  return parsed.every(Boolean) ? parsed as RewardCard[] : null
}

type Recovery = {
  kind: 'claim' | 'approve'
  reward: RewardCard
  key: string
  message: string
}

/**
 * The parent shelf and the family review list share one canonical reward
 * collection. Confirmed mutations update the local row before refreshing;
 * uncertain mutations keep their idempotency key and offer an explicit retry
 * or read-only status check.
 */
export default function RewardsBoard({
  rewards,
  userXp,
  isParent,
  currentUserId,
  canViewAnalytics,
}: {
  rewards: RewardCard[]
  userXp: number
  isParent: boolean
  currentUserId: string
  /** Effective server-side role + feature permission. */
  canViewAnalytics: boolean
}) {
  const router = useRouter()
  const { addToast } = useMaybeToast()
  const rewardsText = useRewardsText()
  const [localRewards, setLocalRewards] = React.useState(rewards)
  const [localXp, setLocalXp] = React.useState(userXp)
  const [confirming, setConfirming] = React.useState<RewardCard | null>(null)
  const [claiming, setClaiming] = React.useState(false)
  const [claimError, setClaimError] = React.useState<string | null>(null)
  const [approving, setApproving] = React.useState<string | null>(null)
  const [recoveries, setRecoveries] = React.useState<Recovery[]>([])
  const claimKeys = React.useRef(new Map<string, string>())
  const approveKeys = React.useRef(new Map<string, string>())

  React.useEffect(() => setLocalRewards(rewards), [rewards])
  React.useEffect(() => setLocalXp(userXp), [userXp])

  const claimable = localRewards.filter((reward) => reward.status === 'available')
  const pendingReview = localRewards.filter((reward) => reward.status === 'claimed')
  const familyRewards = localRewards.filter((reward) => !['available', 'claimed'].includes(reward.status))

  const getKey = (map: React.MutableRefObject<Map<string, string>>, id: string) => {
    const existing = map.current.get(id)
    if (existing) return existing
    const created = newIdempotencyKey()
    map.current.set(id, created)
    return created
  }

  const applyReward = (next: RewardCard) => {
    setLocalRewards((current) => current.map((reward) => reward.id === next.id ? next : reward))
  }

  const recoveryFor = (kind: Recovery['kind'], rewardId: string) =>
    recoveries.find((item) => item.kind === kind && item.reward.id === rewardId) ?? null

  const putRecovery = (next: Recovery) => {
    setRecoveries((current) => [
      ...current.filter((item) => !(item.kind === next.kind && item.reward.id === next.reward.id)),
      next,
    ])
  }

  const clearRecovery = (kind: Recovery['kind'], rewardId: string) => {
    setRecoveries((current) => current.filter((item) => !(item.kind === kind && item.reward.id === rewardId)))
  }

  const checkStatus = async (target: Recovery) => {
    try {
      const response = await fetch('/api/rewards', { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('status')
      const parsed = parseRewardList(await response.json().catch(() => null))
      const current = parsed?.find((reward) => reward.id === target.reward.id)
      if (!current) throw new Error('status')
      applyReward(current)
      clearRecovery(target.kind, target.reward.id)
      if (target.kind === 'claim' && current.status !== 'available') setConfirming(null)
      addToast({ type: 'success', title: current.status === 'available' ? rewardsText('available') : rewardsText('claimed') })
    } catch {
      setRecoveries((current) => current.map((item) => item.kind === target.kind && item.reward.id === target.reward.id
        ? { ...item, message: rewardsText('statusError') }
        : item))
    }
  }

  const claim = async (candidate?: RewardCard) => {
    const reward = candidate ?? confirming
    if (!reward || claiming) return
    const key = getKey(claimKeys, reward.id)
    setClaiming(true)
    setClaimError(null)
    try {
      const response = await fetch('/api/rewards/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key },
        body: JSON.stringify({ rewardId: reward.id }),
      })
      if (!response.ok) {
        const message = await responseErrorMessage(response)
        setClaimError(message)
        if (response.status >= 500 || response.status === 409) {
          putRecovery({ kind: 'claim', reward, key, message })
        } else {
          claimKeys.current.delete(reward.id)
        }
        return
      }
      const parsed = parseClaimResponse(await response.json().catch(() => null))
      if (!parsed || parsed.reward.id !== reward.id || parsed.reward.status !== 'claimed' || (parsed.reward.claimedById !== null && parsed.reward.claimedById !== currentUserId)) {
        const message = rewardsText('recoveryTitle')
        setClaimError(message)
        putRecovery({ kind: 'claim', reward, key, message })
        return
      }
      applyReward(parsed.reward)
      setLocalXp(parsed.xp)
      addToast({ type: 'success', title: rewardsText('claimedToast', { name: reward.name }), message: isParent ? undefined : rewardsText('claimedToastMessage') })
      setConfirming(null)
      clearRecovery('claim', reward.id)
      router.refresh()
    } catch {
      const message = OFFLINE_MESSAGE
      setClaimError(message)
      putRecovery({ kind: 'claim', reward, key, message })
    } finally {
      setClaiming(false)
    }
  }

  const approve = async (reward: RewardCard) => {
    if (approving) return
    const key = getKey(approveKeys, reward.id)
    setApproving(reward.id)
    try {
      const response = await fetch('/api/rewards/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key },
        body: JSON.stringify({ rewardId: reward.id }),
      })
      if (!response.ok) {
        const message = await responseErrorMessage(response)
        if (response.status >= 500 || response.status === 409) {
          putRecovery({ kind: 'approve', reward, key, message })
        } else {
          approveKeys.current.delete(reward.id)
          addToast({ type: 'error', title: rewardsText('givenErrorTitle', { name: reward.name }), message })
        }
        return
      }
      const parsed = parseRewardResponse(await response.json().catch(() => null))
      if (!parsed || parsed.id !== reward.id || !['approved', 'redeemed'].includes(parsed.status)) {
        putRecovery({ kind: 'approve', reward, key, message: rewardsText('recoveryTitle') })
        return
      }
      applyReward(parsed)
      addToast({ type: 'success', title: rewardsText('givenToast', { name: reward.name }) })
      clearRecovery('approve', reward.id)
      router.refresh()
    } catch {
      putRecovery({ kind: 'approve', reward, key, message: OFFLINE_MESSAGE })
    } finally {
      setApproving(null)
    }
  }

  const retryRecovery = async (target: Recovery) => {
    if (target.kind === 'claim') {
      setConfirming(target.reward)
      await claim(target.reward)
    } else {
      await approve(target.reward)
    }
  }

  const closeClaim = () => {
    if (claiming) return
    setConfirming(null)
    setClaimError(null)
    if (confirming) clearRecovery('claim', confirming.id)
  }

  const claimRecovery = confirming ? recoveryFor('claim', confirming.id) : null

  return (
    <div className="space-y-8">
      <section aria-labelledby="rewards-balance-heading" className="card-apple p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Glyph color="rewards" size="lg"><span className="text-2xl" aria-hidden="true">⭐</span></Glyph>
          <div className="min-w-0">
            <p id="rewards-balance-heading" className="text-subhead text-label-secondary">{rewardsText('yourPoints')}</p>
            <p className="text-title-2 text-label-primary font-bold tabular-nums">{localXp} {rewardsText('points')}</p>
          </div>
        </div>
        {canViewAnalytics && <Link href="/dashboard/analytics" className="inline-flex min-h-[44px] items-center text-subhead text-rewards hover:text-rewards/80 font-medium">{rewardsText('leaderboard')}</Link>}
      </section>

      {claimable.length > 0 && (
        <section aria-labelledby="claimable-rewards-heading">
          <div className="mb-3"><h2 id="claimable-rewards-heading" className="section-header">{rewardsText('claimable')}</h2><p className="text-footnote text-label-secondary">{rewardsText('claimableHint')}</p></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {claimable.map((reward) => {
              const canClaim = localXp >= reward.cost
              return <article key={reward.id} className="card-apple p-5 flex flex-col gap-4 min-w-0" data-testid="claimable-reward">
                <Glyph color="rewards" size="lg"><span className="text-2xl" aria-hidden="true">{rewardIcon(reward.icon)}</span></Glyph>
                <div className="min-w-0"><h3 className="text-title-3 text-label-primary font-semibold [overflow-wrap:anywhere]">{reward.name}</h3>{reward.description && <p className="text-footnote text-label-secondary mt-1 [overflow-wrap:anywhere]">{reward.description}</p>}<p className="text-subhead text-rewards font-medium mt-2">{reward.cost} {rewardsText('points')}</p></div>
                <button type="button" disabled={!canClaim} onClick={() => { setConfirming(reward); setClaimError(null); clearRecovery('claim', reward.id) }} aria-label={canClaim ? `${rewardsText('claim')} ${reward.name}` : undefined} className={cn('btn-tinted w-full min-h-[44px] py-2.5 text-base font-semibold', canClaim ? 'bg-tint-rewards text-white' : 'bg-muted text-label-tertiary cursor-not-allowed')}>{canClaim ? rewardsText('claimReward') : rewardsText('needMore', { points: reward.cost - localXp })}</button>
              </article>
            })}
          </div>
        </section>
      )}

      {pendingReview.length > 0 && <section aria-labelledby="pending-rewards-heading" className="space-y-3"><div><h2 id="pending-rewards-heading" className="section-header">{rewardsText('claimed')}</h2><p className="text-footnote text-label-secondary">{isParent ? rewardsText('reviewHint') : rewardsText('waiting')}</p></div><ul className="space-y-3">{pendingReview.map((reward) => { const recovery = recoveryFor('approve', reward.id); return <RewardRow key={reward.id} reward={reward} currentUserId={currentUserId} isParent={isParent} approving={approving === reward.id} onApprove={() => approve(reward)} rewardsText={rewardsText} recovery={recovery} onRetry={() => recovery && void retryRecovery(recovery)} onCheckStatus={() => recovery ? void checkStatus(recovery) : undefined} /> })}</ul></section>}

      <section aria-labelledby="family-rewards-heading"><div className="flex items-center justify-between gap-3 mb-3"><h2 id="family-rewards-heading" className="section-header">{rewardsText('allFamily')}</h2>{isParent && localRewards.length > 0 && <Link href="/dashboard/rewards/create" className="btn-tinted min-h-[44px] shrink-0">{rewardsText('addReward')}</Link>}</div>{localRewards.length === 0 ? <EmptyState icon={Gift} glyphColor="rewards" illustration={ILLUSTRATIONS.rewards} headingLevel="h3" title={rewardsText('noRewards')} description={isParent ? rewardsText('createFirst') : rewardsText('askParent')} action={isParent ? <Link href="/dashboard/rewards/create" className="btn-tinted bg-tint-rewards text-white min-h-[44px] px-5 py-2 text-base font-medium">{rewardsText('createReward')}</Link> : undefined} /> : familyRewards.length > 0 ? <ul className="space-y-3">{familyRewards.map((reward) => { const recovery = recoveryFor('approve', reward.id); return <RewardRow key={reward.id} reward={reward} currentUserId={currentUserId} isParent={isParent} approving={approving === reward.id} onApprove={() => approve(reward)} rewardsText={rewardsText} recovery={recovery} onRetry={() => recovery && void retryRecovery(recovery)} onCheckStatus={() => recovery ? void checkStatus(recovery) : undefined} /> })}</ul> : null}</section>

      <Dialog open={confirming !== null} onClose={closeClaim} title={confirming ? rewardsText('claimTitle', { name: confirming.name }) : rewardsText('claimReward')} description={confirming ? rewardsText('claimDescription', { cost: confirming.cost, balance: localXp, suffix: isParent ? '' : rewardsText('parentWillGive') }) : undefined} testId="claim-reward-dialog">
        {claimError && <p role="alert" className="mb-3 rounded-xl border border-[var(--danger-tint)] bg-[var(--danger-tint)] px-4 py-3 text-subhead text-[var(--danger-text)]">{claimError}</p>}
        {claimRecovery && <RecoveryNotice recovery={claimRecovery} rewardsText={rewardsText} onRetry={() => void retryRecovery(claimRecovery)} onCheckStatus={() => void checkStatus(claimRecovery)} />}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={closeClaim} disabled={claiming} className="btn-plain min-h-[44px]">{rewardsText('cancel')}</button><button type="button" onClick={() => void claim()} disabled={claiming} className="btn-filled min-h-[44px]">{claiming ? rewardsText('claiming') : rewardsText('claim')}</button></div>
      </Dialog>
    </div>
  )
}

function RewardRow({ reward, currentUserId, isParent, approving, onApprove, rewardsText, recovery, onRetry, onCheckStatus }: { reward: RewardCard; currentUserId: string; isParent: boolean; approving: boolean; onApprove: () => void; rewardsText: (key: string, params?: Record<string, string | number>) => string; recovery: Recovery | null; onRetry: () => void; onCheckStatus: () => void }) {
  const badge = STATUS_BADGE[reward.status] ?? { key: 'available' as const, className: 'bg-muted text-muted-foreground' }
  const claimedByMe = reward.claimedById === currentUserId
  const claimer = claimedByMe ? 'you' : reward.claimedByName
  return <li className="card-apple p-4 flex flex-wrap items-center gap-4" data-testid="family-reward"><Glyph color="rewards" size="md"><span className="text-lg" aria-hidden="true">{rewardIcon(reward.icon)}</span></Glyph><div className="flex-1 min-w-0"><p className="text-body text-label-primary font-medium [overflow-wrap:anywhere]">{reward.name}</p><p className="text-footnote text-label-secondary [overflow-wrap:anywhere]">{reward.cost} {rewardsText('points')}{reward.status === 'claimed' && claimer ? ` · ${rewardsText('claimedBy', { name: claimer })}` : ''}{reward.status === 'claimed' && claimedByMe && !isParent ? ` · ${rewardsText('waiting')}` : ''}</p></div><span className={cn('text-caption-1 px-2.5 py-1 rounded-full font-medium', badge.className)}>{rewardsText(badge.key)}</span>{isParent && reward.status === 'claimed' && <button type="button" onClick={onApprove} disabled={approving} className="btn-filled min-h-[44px]" aria-label={rewardsText('markGivenAria', { name: reward.name })}>{approving ? rewardsText('saving') : rewardsText('markGiven')}</button>}{recovery && <RecoveryNotice recovery={recovery} rewardsText={rewardsText} onRetry={onRetry} onCheckStatus={onCheckStatus} />}</li>
}

function RecoveryNotice({ recovery, rewardsText, onRetry, onCheckStatus }: { recovery: Recovery; rewardsText: (key: string, params?: Record<string, string | number>) => string; onRetry: () => void; onCheckStatus: () => void }) {
  return <div role="status" aria-live="polite" className="w-full rounded-xl border border-[var(--warning-tint)] bg-[var(--warning-tint)]/40 p-3 text-footnote text-label-primary"><p className="font-semibold">{recovery.message}</p><p className="mt-1 text-label-secondary">{rewardsText('recoveryDescription')}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className="btn-plain min-h-[44px]" onClick={onRetry}>{rewardsText('tryAgain')}</button><button type="button" className="btn-plain min-h-[44px]" onClick={onCheckStatus}>{rewardsText('checkStatus')}</button></div></div>
}

function rewardIcon(icon: string | null | undefined): string {
  return icon && /\p{Extended_Pictographic}/u.test(icon) ? icon : '🎁'
}
