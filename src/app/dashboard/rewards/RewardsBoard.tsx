'use client'

import * as React from 'react'
import { requestOwnedJson } from '@/lib/owned-request-http'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Gift } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Glyph } from '@/components/ui/glyph'
import { EmptyState } from '@/components/ui/empty-state'
import { ILLUSTRATIONS } from '@/lib/brand-illustrations'
import { Dialog } from '@/components/ui/dialog'
import { useMaybeToast } from '@/components/ui/toast'
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from '@/lib/idempotency-key'
import { useRewardsText } from '@/i18n/rewards'

export interface RewardCard {
  id: string
  name: string
  description: string | null
  icon: string | null
  cost: number
  status: string
  /** False means the reward is retired; legacy payloads without this field stay active. */
  active?: boolean
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
  const rawActive = value.active ?? value.is_active ?? value.isActive
  const active = typeof rawActive === 'boolean' ? rawActive : true
  return {
    id,
    name,
    description: stringOrNull(value.description),
    icon: stringOrNull(value.icon),
    cost,
    status,
    active,
    claimedById: stringOrNull(value.claimedById ?? value.claimed_by),
    claimedByName: stringOrNull(value.claimedByName ?? value.claimed_by_name ?? (isRecord(value.claimer) ? value.claimer.name : null)),
  }
}

function rewardFailureMessage(value: unknown, fallback: string) {
  return isRecord(value) && typeof value.error === 'string' && value.error.trim() ? value.error : fallback
}
function uncertainRewardStatus(status: number, body: unknown) {
  // A late access hold can follow a committed transaction. Status alone cannot
  // turn that result into a known refusal or permit a new request key.
  const code = isRecord(body) ? body.code : null
  return status >= 500 || [408, 409, 425, 429].includes(status)
    || code === 'REWARD_ACCESS_CHANGED' || code === 'REWARD_ACCESS_UNCONFIRMED'
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
  notificationFocus,
  userXp,
  isParent,
  currentUserId,
  canViewAnalytics,
  pageInfo,
}: {
  rewards: RewardCard[]
  notificationFocus?: { target: RewardCard | null }
  userXp: number
  isParent: boolean
  currentUserId: string
  /** Effective server-side role + feature permission. */
  canViewAnalytics: boolean
  pageInfo?: { older: boolean; nextCursor: string | null }
}) {
  const router = useRouter()
  const { addToast } = useMaybeToast()
  const rewardsText = useRewardsText()
  const [localRewards, setLocalRewards] = React.useState(rewards)
  const [focusedReward, setFocusedReward] = React.useState(notificationFocus?.target ?? null)
  const focusRef = React.useRef<HTMLElement>(null)
  React.useEffect(() => setFocusedReward(notificationFocus?.target ?? null), [notificationFocus?.target])
  React.useEffect(() => { if (notificationFocus !== undefined) focusRef.current?.focus() }, [notificationFocus?.target?.id])
  const [localXp, setLocalXp] = React.useState(userXp)
  const [confirming, setConfirming] = React.useState<RewardCard | null>(null)
  const [claiming, setClaiming] = React.useState(false)
  const [claimError, setClaimError] = React.useState<string | null>(null)
  const [approving, setApproving] = React.useState<string | null>(null)
  const [recoveries, setRecoveries] = React.useState<Recovery[]>([])
  const claimKeys = React.useRef(new Map<string, string>())
  const approveKeys = React.useRef(new Map<string, string>())
  const uncertainRequests = React.useRef(new Set<string>())

  React.useEffect(() => setLocalRewards(rewards), [rewards])
  React.useEffect(() => setLocalXp(userXp), [userXp])

  // A focused record is presented once, independent of the current page cap.
  const pageRewards = localRewards.filter(row => row.id !== focusedReward?.id)
  const claimable = pageRewards.filter((reward) => reward.status === 'available' && reward.active !== false)
  const pendingReview = pageRewards.filter((reward) => reward.status === 'claimed')
  // Retired rewards remain visible in the family history, but cannot re-enter
  // the claim shelf. This keeps past choices auditable without offering stale
  // actions.
  const familyRewards = pageRewards.filter((reward) =>
    (reward.status === 'available' && reward.active === false) ||
    !['available', 'claimed'].includes(reward.status),
  )

  const pointsUnit = (count: number) => rewardsText(count === 1 ? 'point' : 'points')

  const getKey = (map: React.MutableRefObject<Map<string, string>>, id: string) => {
    const existing = map.current.get(id)
    if (existing) return existing
    const created = newIdempotencyKey()
    map.current.set(id, created)
    return created
  }

  const applyReward = (next: RewardCard) => {
    setFocusedReward(current => current?.id === next.id ? next : current)
    setLocalRewards((current) => current.map((reward) => reward.id === next.id ? next : reward))
  }

  const recoveryFor = (kind: Recovery['kind'], rewardId: string) =>
    recoveries.find((item) => item.kind === kind && item.reward.id === rewardId) ?? null

  const putRecovery = (next: Recovery) => {
    // Synchronous evidence survives a same-tick retry before React state commits.
    uncertainRequests.current.add(`${next.kind}:${next.reward.id}`)
    setRecoveries((current) => [
      ...current.filter((item) => !(item.kind === next.kind && item.reward.id === next.reward.id)),
      next,
    ])
  }

  const clearRecovery = (kind: Recovery['kind'], rewardId: string) => {
    uncertainRequests.current.delete(`${kind}:${rewardId}`)
    setRecoveries((current) => current.filter((item) => !(item.kind === kind && item.reward.id === rewardId)))
  }

  const checkStatus = async (target: Recovery) => {
    try {
      const result = await requestOwnedJson(`/api/rewards?rewardId=${encodeURIComponent(target.reward.id)}`, { method: 'GET', headers: { Accept: 'application/json' } }, 256 * 1024)
      if (result.kind === 'unknown' || !result.response.ok) throw new Error('status')
      const parsed = parseRewardList(result.body)
      const current = parsed?.find((reward) => reward.id === target.reward.id)
      if (!current) throw new Error('status')
      applyReward(current)
      if (target.kind === 'approve') {
        // A GET that still says "claimed" only proves the approval has not
        // become visible yet. Keep the same recovery/key available and avoid
        // telling the parent that the reward was given.
        if (!['approved', 'redeemed'].includes(current.status)) {
          setRecoveries((items) => items.map((item) =>
            item.kind === target.kind && item.reward.id === target.reward.id
              ? { ...item, reward: current }
              : item,
          ))
          return
        }
        approveKeys.current.delete(target.reward.id)
        clearRecovery(target.kind, target.reward.id)
        addToast({ type: 'success', title: rewardsText('givenToast', { name: current.name }) })
        return
      }
      // Resource state is only sufficient to resolve our claim when the actual
      // claimant is this account in a supported terminal lifecycle. Another
      // person's claim or a missing claimant says nothing about our XP outcome.
      if (current.status === 'available') return
      if (current.claimedById !== currentUserId || !['claimed', 'approved', 'redeemed'].includes(current.status)) {
        setRecoveries(items => items.map(item => item.kind === target.kind && item.reward.id === target.reward.id
          ? { ...item, message: rewardsText('statusUnconfirmed') } : item))
        return
      }
      claimKeys.current.delete(target.reward.id)
      clearRecovery(target.kind, target.reward.id)
      setConfirming(null)
      addToast({ type: 'success', title: rewardsText('claimed') })
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
      const result = await requestOwnedJson('/api/rewards/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key },
        body: JSON.stringify({ rewardId: reward.id }),
      }, 256 * 1024)
      if (result.kind === 'unknown') throw new Error('Reward outcome unknown')
      const { response, body } = result
      if (!response.ok) {
        const message = rewardFailureMessage(body, rewardsText('claimErrorDescription'))
        setClaimError(message)
        if (uncertainRewardStatus(response.status, body) || uncertainRequests.current.has(`claim:${reward.id}`)) {
          putRecovery({ kind: 'claim', reward, key, message })
        } else {
          claimKeys.current.delete(reward.id)
        }
        return
      }
      const parsed = parseClaimResponse(body)
      if (!parsed || parsed.reward.id !== reward.id || parsed.reward.status !== 'claimed' || parsed.reward.claimedById !== currentUserId) {
        const message = rewardsText('recoveryTitle')
        setClaimError(message)
        putRecovery({ kind: 'claim', reward, key, message })
        return
      }
      applyReward(parsed.reward)
      setLocalXp(parsed.xp)
      addToast({ type: 'success', title: rewardsText('claimedToast', { name: reward.name }), message: isParent ? undefined : rewardsText('claimedToastMessage') })
      setConfirming(null)
      claimKeys.current.delete(reward.id)
      clearRecovery('claim', reward.id)
      router.refresh()
    } catch {
      const message = rewardsText('connectionErrorDescription')
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
      const result = await requestOwnedJson('/api/rewards/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key },
        body: JSON.stringify({ rewardId: reward.id }),
      }, 256 * 1024)
      if (result.kind === 'unknown') throw new Error('Reward outcome unknown')
      const { response, body } = result
      if (!response.ok) {
        const message = rewardFailureMessage(body, rewardsText('claimErrorDescription'))
        if (uncertainRewardStatus(response.status, body) || uncertainRequests.current.has(`approve:${reward.id}`)) {
          putRecovery({ kind: 'approve', reward, key, message })
        } else {
          approveKeys.current.delete(reward.id)
          addToast({ type: 'error', title: rewardsText('givenErrorTitle', { name: reward.name }), message })
        }
        return
      }
      const parsed = parseRewardResponse(body)
      if (!parsed || parsed.id !== reward.id || !['approved', 'redeemed'].includes(parsed.status)) {
        putRecovery({ kind: 'approve', reward, key, message: rewardsText('recoveryTitle') })
        return
      }
      applyReward(parsed)
      addToast({ type: 'success', title: rewardsText('givenToast', { name: reward.name }) })
      approveKeys.current.delete(reward.id)
      clearRecovery('approve', reward.id)
      router.refresh()
    } catch {
      putRecovery({ kind: 'approve', reward, key, message: rewardsText('connectionErrorDescription') })
    } finally {
      setApproving(null)
    }
  }

  const retryRecovery = async (target: Recovery) => {
    const keys = target.kind === 'claim' ? claimKeys : approveKeys
    const existing = keys.current.get(target.reward.id)
    if (existing && existing !== target.key) {
      putRecovery({ ...target, message: rewardsText('statusUnconfirmed') })
      return
    }
    keys.current.set(target.reward.id, target.key)
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
  }

  const claimRecovery = confirming ? recoveryFor('claim', confirming.id) : null

  return (
    <div className="space-y-8">
      {notificationFocus !== undefined && <section ref={focusRef} tabIndex={-1} aria-label={rewardsText('focusHeading')}
        data-testid="notification-reward-focus" className="space-y-3 rounded-[var(--radius-xl)] border border-[var(--separator)] p-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
        <h2 className="section-header">{rewardsText('focusHeading')}</h2>
        <p className="text-footnote text-label-secondary">{rewardsText(focusedReward ? 'focusDescription' : 'focusUnavailable')}</p>
        {focusedReward && <ul><RewardRow reward={focusedReward} currentUserId={currentUserId} isParent={isParent}
          approving={approving === focusedReward.id} onApprove={() => void approve(focusedReward)} rewardsText={rewardsText}
          recovery={recoveryFor('approve', focusedReward.id)}
          onRetry={() => { const recovery = recoveryFor('approve', focusedReward.id); if (recovery) void retryRecovery(recovery) }}
          onCheckStatus={() => { const recovery = recoveryFor('approve', focusedReward.id); if (recovery) void checkStatus(recovery) }} /></ul>}
        <Link href="/dashboard/rewards" className="btn-plain inline-flex min-h-[44px] items-center"
          aria-disabled={claiming || approving !== null || recoveries.length > 0}
          onClick={event => { if (claiming || approving !== null || recoveries.length > 0) event.preventDefault() }}>{rewardsText('focusAll')}</Link>
      </section>}
      {isParent && localRewards.length > 0 && (
        <div className="flex justify-end">
          <Link href="/dashboard/rewards/create" className="btn-tinted min-h-[44px] w-full justify-center sm:w-auto">
            {rewardsText('addReward')}
          </Link>
        </div>
      )}
      {pageInfo && <p role="status" className="text-footnote text-label-secondary">{rewardsText('pageScope', { count: localRewards.length })}</p>}
      <section aria-labelledby="rewards-balance-heading" className="card-apple p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Glyph color="rewards" size="lg"><span className="text-2xl" aria-hidden="true">⭐</span></Glyph>
          <div className="min-w-0">
            <p id="rewards-balance-heading" className="text-subhead text-label-secondary">{rewardsText('yourPoints')}</p>
            <p className="text-title-2 text-label-primary font-bold tabular-nums">{localXp} {pointsUnit(localXp)}</p>
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
                <div className="min-w-0"><h3 className="text-title-3 text-label-primary font-semibold [overflow-wrap:anywhere]">{reward.name}</h3>{reward.description && <p className="text-footnote text-label-secondary mt-1 [overflow-wrap:anywhere]">{reward.description}</p>}<p className="text-subhead text-rewards font-medium mt-2">{reward.cost} {pointsUnit(reward.cost)}</p></div>
                <button type="button" disabled={!canClaim} onClick={() => { setConfirming(reward); setClaimError(null) }} aria-label={canClaim ? `${rewardsText('claim')} ${reward.name}` : undefined} className={cn('btn-tinted w-full min-h-[44px] py-2.5 text-base font-semibold', canClaim ? 'bg-tint-rewards text-white' : 'bg-muted text-label-tertiary cursor-not-allowed')}>{canClaim ? rewardsText('claimReward') : rewardsText('needMore', { points: reward.cost - localXp, unit: pointsUnit(reward.cost - localXp) })}</button>
                {recoveryFor('claim', reward.id) && confirming?.id !== reward.id && <RecoveryNotice recovery={recoveryFor('claim', reward.id)!} rewardsText={rewardsText} onRetry={() => void retryRecovery(recoveryFor('claim', reward.id)!)} onCheckStatus={() => void checkStatus(recoveryFor('claim', reward.id)!)} />}
              </article>
            })}
          </div>
        </section>
      )}

      {pendingReview.length > 0 && <section aria-labelledby="pending-rewards-heading" className="space-y-3"><div><h2 id="pending-rewards-heading" className="section-header">{rewardsText('claimed')}</h2><p className="text-footnote text-label-secondary">{isParent ? rewardsText('reviewHint') : rewardsText('waiting')}</p></div><ul className="space-y-3">{pendingReview.map((reward) => { const recovery = recoveryFor('approve', reward.id); return <RewardRow key={reward.id} reward={reward} currentUserId={currentUserId} isParent={isParent} approving={approving === reward.id} onApprove={() => approve(reward)} rewardsText={rewardsText} recovery={recovery} onRetry={() => recovery && void retryRecovery(recovery)} onCheckStatus={() => recovery ? void checkStatus(recovery) : undefined} /> })}</ul></section>}

      <section aria-labelledby="family-rewards-heading"><div className="mb-3"><h2 id="family-rewards-heading" className="section-header">{rewardsText(pageInfo ? 'shownFamily' : 'allFamily')}</h2></div>{localRewards.length === 0 && !focusedReward ? <EmptyState icon={Gift} glyphColor="rewards" illustration={ILLUSTRATIONS.rewards} headingLevel="h3" title={rewardsText(pageInfo?.older ? 'pageEmpty' : 'noRewards')} description={pageInfo?.older ? rewardsText('pageEmptyHint') : isParent ? rewardsText('createFirst') : rewardsText('askParent')} action={isParent ? <Link href="/dashboard/rewards/create" className="btn-tinted bg-tint-rewards text-white min-h-[44px] px-5 py-2 text-base font-medium">{rewardsText('createReward')}</Link> : undefined} /> : familyRewards.length > 0 ? <ul className="space-y-3">{familyRewards.map((reward) => { const recovery = recoveryFor('approve', reward.id); return <RewardRow key={reward.id} reward={reward} currentUserId={currentUserId} isParent={isParent} approving={approving === reward.id} onApprove={() => approve(reward)} rewardsText={rewardsText} recovery={recovery} onRetry={() => recovery && void retryRecovery(recovery)} onCheckStatus={() => recovery ? void checkStatus(recovery) : undefined} /> })}</ul> : null}</section>

      {recoveries.filter(recovery => recovery.kind === 'claim'
        ? confirming?.id !== recovery.reward.id && !claimable.some(row => row.id === recovery.reward.id)
        : focusedReward?.id !== recovery.reward.id && ![...pendingReview, ...familyRewards].some(row => row.id === recovery.reward.id)
      ).map(recovery => <RecoveryNotice key={`${recovery.kind}:${recovery.reward.id}`} recovery={recovery} rewardsText={rewardsText} onRetry={() => void retryRecovery(recovery)} onCheckStatus={() => void checkStatus(recovery)} />)}

      {pageInfo && (pageInfo.older || pageInfo.nextCursor) && (
        <nav aria-label={rewardsText('pageNavigation')} className="flex flex-wrap items-center gap-3">
          {pageInfo.older && <Link href="/dashboard/rewards" aria-disabled={claiming || approving !== null || confirming !== null || recoveries.length > 0} onClick={event => { if (claiming || approving !== null || confirming !== null || recoveries.length > 0) event.preventDefault() }} className="btn-tinted min-h-[44px] aria-disabled:opacity-50">{rewardsText('newestRewards')}</Link>}
          {pageInfo.nextCursor && <Link href={`/dashboard/rewards?cursor=${encodeURIComponent(pageInfo.nextCursor)}`} aria-disabled={claiming || approving !== null || confirming !== null || recoveries.length > 0} onClick={event => { if (claiming || approving !== null || confirming !== null || recoveries.length > 0) event.preventDefault() }} className="btn-tinted min-h-[44px] aria-disabled:opacity-50">{rewardsText('olderRewards')}</Link>}
          {(claiming || approving !== null || confirming !== null || recoveries.length > 0) && <p role="status" className="text-footnote text-label-secondary">{rewardsText('pageHeld')}</p>}
        </nav>
      )}

      <Dialog open={confirming !== null} onClose={closeClaim} title={confirming ? rewardsText('claimTitle', { name: confirming.name }) : rewardsText('claimReward')} description={confirming ? rewardsText('claimDescription', { cost: confirming.cost, costUnit: pointsUnit(confirming.cost), balance: localXp, balanceUnit: pointsUnit(localXp), suffix: isParent ? '' : rewardsText('parentWillGive') }) : undefined} testId="claim-reward-dialog">
        {claimError && <p role="alert" className="mb-3 rounded-xl border border-[var(--danger-tint)] bg-[var(--danger-tint)] px-4 py-3 text-subhead text-[var(--danger-text)]">{claimError}</p>}
        {claimRecovery && <RecoveryNotice recovery={claimRecovery} rewardsText={rewardsText} onRetry={() => void retryRecovery(claimRecovery)} onCheckStatus={() => void checkStatus(claimRecovery)} />}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={closeClaim} disabled={claiming} className="btn-plain min-h-[44px]">{rewardsText('cancel')}</button><button type="button" onClick={() => void claim()} disabled={claiming} className="btn-filled min-h-[44px]">{claiming ? rewardsText('claiming') : rewardsText('claim')}</button></div>
      </Dialog>
    </div>
  )
}

function RewardRow({ reward, currentUserId, isParent, approving, onApprove, rewardsText, recovery, onRetry, onCheckStatus }: { reward: RewardCard; currentUserId: string; isParent: boolean; approving: boolean; onApprove: () => void; rewardsText: (key: string, params?: Record<string, string | number>) => string; recovery: Recovery | null; onRetry: () => void; onCheckStatus: () => void }) {
  const badge = reward.active === false && reward.status === 'available'
    ? { key: 'inactive', className: 'bg-muted text-label-secondary' }
    : STATUS_BADGE[reward.status] ?? { key: 'available' as const, className: 'bg-muted text-muted-foreground' }
  const claimedByMe = reward.claimedById === currentUserId
  const claimer = claimedByMe ? 'you' : reward.claimedByName
  return <li className="card-apple p-4 flex flex-wrap items-center gap-4" data-testid="family-reward"><Glyph color="rewards" size="md"><span className="text-lg" aria-hidden="true">{rewardIcon(reward.icon)}</span></Glyph><div className="flex-1 min-w-0"><p className="text-body text-label-primary font-medium [overflow-wrap:anywhere]">{reward.name}</p><p className="text-footnote text-label-secondary [overflow-wrap:anywhere]">{reward.cost} {reward.cost === 1 ? rewardsText('point') : rewardsText('points')}{reward.status === 'claimed' && claimer ? ` · ${rewardsText('claimedBy', { name: claimer })}` : ''}{reward.status === 'claimed' && claimedByMe && !isParent ? ` · ${rewardsText('waiting')}` : ''}</p></div>{reward.status === 'claimed' ? <div className="flex w-full items-center gap-4 sm:contents"><span className={cn('text-caption-1 px-2.5 py-1 rounded-full font-medium', badge.className)}>{rewardsText(badge.key)}</span>{isParent && <button type="button" onClick={onApprove} disabled={approving} className="btn-filled min-h-[44px]" aria-label={rewardsText('markGivenAria', { name: reward.name })}>{approving ? rewardsText('saving') : rewardsText('markGiven')}</button>}</div> : <span className={cn('text-caption-1 px-2.5 py-1 rounded-full font-medium', badge.className)}>{rewardsText(badge.key)}</span>}{recovery && <RecoveryNotice recovery={recovery} rewardsText={rewardsText} onRetry={onRetry} onCheckStatus={onCheckStatus} />}</li>
}

function RecoveryNotice({ recovery, rewardsText, onRetry, onCheckStatus }: { recovery: Recovery; rewardsText: (key: string, params?: Record<string, string | number>) => string; onRetry: () => void; onCheckStatus: () => void }) {
  return <div role="status" aria-live="polite" className="w-full rounded-xl border border-[var(--warning-tint)] bg-[var(--warning-tint)]/40 p-3 text-footnote text-label-primary"><p className="font-semibold">{recovery.message}</p><p className="mt-1 text-label-secondary">{rewardsText('recoveryDescription')}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className="btn-plain min-h-[44px]" onClick={onRetry}>{rewardsText('tryAgain')}</button><button type="button" className="btn-plain min-h-[44px]" onClick={onCheckStatus}>{rewardsText('checkStatus')}</button></div></div>
}

function rewardIcon(icon: string | null | undefined): string {
  return icon && /\p{Extended_Pictographic}/u.test(icon) ? icon : '🎁'
}
