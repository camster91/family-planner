'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Star, Gift, Calendar, Sparkles } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { BrandMotion } from '@/components/ui/brand-motion'
import { MOTION } from '@/lib/brand-illustrations'
import { Avatar } from '@/components/ui/avatar'
import { CheckboxRow } from '@/components/ui/checkbox-row'
import { ProgressRing } from '@/components/ui/progress-ring'
import { ListRow } from '@/components/ui/list-row'
import { cn } from '@/lib/utils'
import { xpForNextLevel } from '@/lib/gamification'
import { useFeatureEnabled } from '@/components/providers/features-provider'
import type { UserRole } from '@/types'
import { useToast, useUndoToast } from '@/components/ui/toast'
import { setChoreDone } from '@/lib/chore-tick-client'
import { formatRelativePastDate, isDueToday, toDateOnlyLocal, toDateOnlyUTC } from '@/lib/dates'
import { groupByRoutine, normalizeRoutineName } from '@/lib/routine-icons'
import KidRoutines from './KidRoutines'
import { useLocalNow } from '@/components/ui/use-hydrated'

interface Chore {
  id: string
  title: string
  due_date: string
  status: string
  points?: number
  /** Picture routines (#272). */
  icon?: string | null
  routine?: string | null
  routine_order?: number | null
}

interface Event {
  id: string
  title: string
  start_time: string
  location?: string | null
}

interface Reward {
  id: string
  name: string
  cost: number
  description?: string | null
  status?: 'available' | 'claimed' | 'approved' | 'redeemed'
}

interface KidHomeProps {
  user: {
    name?: string
    role?: UserRole
    avatar_url?: string | null
    xp?: number | null
    level?: number | null
    family_id?: string | null
  }
  chores: Chore[]
  events: Event[]
  rewards: Reward[]
}

// Both helpers use the viewer's zone, so they are only called after hydration
// (useLocalNow is non-null): the server renders in UTC (O-31).
function formatRelativeDate(dateStr: string, now: Date): string {
  const date = new Date(dateStr)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date.toDateString() === now.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

const OPEN_STATUSES = new Set(['pending', 'in_progress', 'overdue'])
const isOpen = (c: Chore) => OPEN_STATUSES.has(c.status)

/** "Was due yesterday" / "Was due Jan 3": a plain fact, no scolding (BRAND.md). */
function wasDueLabel(dueDate: string, now: Date): string {
  const label = formatRelativePastDate(dueDate, now)
  return `Was due ${label === 'Yesterday' ? 'yesterday' : label}`
}

// XP threshold to level up from `level` — shared with the server logic
// (gamification.ts xpForNextLevel) so the ring matches awardChoreXP.
const xpForLevel = xpForNextLevel

/** "Casey Smith" → "Casey": a kid is greeted by first name. */
export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0]
  return first ? first : null
}

export default function KidHome({
  user,
  chores,
  events,
  rewards,
}: KidHomeProps) {
  const [celebratingReward, setCelebratingReward] = useState<string | null>(null)
  const [claimingReward, setClaimingReward] = useState(false)
  const rewardsEnabled = useFeatureEnabled('rewards')
  // Points & streaks (#248). When off the server also omits xp/level and the
  // chores' points, so this only decides what to draw.
  const gamification = useFeatureEnabled('gamification')
  const [completedChores, setCompletedChores] = useState<Set<string>>(new Set())
  // Rewards claimed on this screen: hidden at once (a second tap would 409)
  // until router.refresh() brings the server's list.
  const [claimedRewards, setClaimedRewards] = useState<Set<string>>(new Set())
  // XP balance returned by the claim, until fresh props arrive. Keyed to the
  // prop it replaced so a later refresh always wins.
  const [xpAfterClaim, setXpAfterClaim] = useState<{ from: number | null | undefined; xp: number } | null>(null)
  const router = useRouter()
  const { addToast } = useToast()
  const showUndo = useUndoToast()

  const userXp = xpAfterClaim && xpAfterClaim.from === user.xp ? xpAfterClaim.xp : (user.xp ?? 0)
  const userLevel = user.level ?? 1
  // Threshold to reach level+1 is xpForNextLevel(level) = 100 * level
  const xpNextLevel = xpForLevel(userLevel)
  const xpProgress = Math.min(userXp / xpNextLevel, 1)

  // Picture routines (#272): the child's chores due today that belong to a
  // routine, grouped and in step order. Done steps stay (shown ticked).
  // Routine steps on other days (a daily routine's later occurrences, or
  // yesterday's) are not shown: a routine is about today.
  const inRoutine = (c: Chore) => normalizeRoutineName(c.routine) !== null
  // "Today" is the viewer's local day, unknown on the server (O-31): until
  // hydration everything day-based is left out and a placeholder holds its
  // place, so the server HTML and the first client render match.
  const now = useLocalNow()
  const routineChores = now ? (chores ?? []).filter((c) => inRoutine(c) && isDueToday(c.due_date, now)) : []
  const { routines } = groupByRoutine(routineChores)

  // Missions are the child's open chores due on their local today — up to 3.
  // Recurring chores keep future copies, so the due day matters, not just the
  // status. Routine steps show above as picture cards, so they are never
  // repeated here. Earlier open chores get their own small group, and
  // tomorrow's are a read-only peek; neither counts as today's missions.
  const todayKey = now ? toDateOnlyLocal(now) : null
  const tomorrow = now ? new Date(now.getTime()) : null
  tomorrow?.setDate(tomorrow.getDate() + 1)
  const tomorrowKey = tomorrow ? toDateOnlyLocal(tomorrow) : null
  const openChores = todayKey ? (chores ?? []).filter((c) => isOpen(c) && !inRoutine(c)) : []
  const todayChores = openChores.filter((c) => toDateOnlyUTC(c.due_date) === todayKey).slice(0, 3)
  const earlierChores = openChores
    .filter((c) => toDateOnlyUTC(c.due_date) < (todayKey ?? ''))
    // Most recent first.
    .sort((a, b) => toDateOnlyUTC(b.due_date).localeCompare(toDateOnlyUTC(a.due_date)))
    .slice(0, 3)
  const tomorrowChores = openChores.filter((c) => toDateOnlyUTC(c.due_date) === tomorrowKey).slice(0, 3)

  // Today's events (the viewer's local day) — up to 2
  const todayEvents = todayKey
    ? (events ?? []).filter((e) => toDateOnlyLocal(new Date(e.start_time)) === todayKey).slice(0, 2)
    : []

  // The reward to offer: the one being celebrated (its cost is already spent,
  // so it may no longer look affordable), else the first one the child can
  // afford, else the first available one with "Need N more XP" (as on the
  // Rewards board; the claim endpoint refuses a reward the XP cannot cover).
  const availableRewards = (rewards ?? []).filter((r) => r.status === 'available' && !claimedRewards.has(r.id))
  const claimableReward =
    availableRewards.find((r) => r.id === celebratingReward) ??
    availableRewards.find((r) => r.cost <= userXp) ??
    availableRewards[0]
  const celebratingThis = !!claimableReward && celebratingReward === claimableReward.id
  const canClaimReward = !!claimableReward && (celebratingThis || claimableReward.cost <= userXp)

  async function handleClaimReward(rewardId: string) {
    if (claimingReward) return
    setClaimingReward(true)
    try {
      const res = await fetch('/api/rewards/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId }),
      })
      if (res.ok) {
        // The claim spent XP: show the new balance now (the response carries
        // it), then drop the claimed reward and reload server data once the
        // celebration ends, so it is never offered again.
        const data = await res.json().catch(() => ({}))
        if (typeof data?.xp === 'number') setXpAfterClaim({ from: user.xp, xp: data.xp })
        setCelebratingReward(rewardId)
        setTimeout(() => {
          setCelebratingReward(null)
          setClaimedRewards((prev) => new Set([...prev, rewardId]))
          router.refresh()
        }, 2000)
      } else {
        const data = await res.json().catch(() => ({}))
        addToast({ type: 'error', title: "Couldn't claim that", message: data.error || 'Please try again.' })
      }
    } catch {
      // Offline or the request failed: say so instead of an unhandled rejection.
      addToast({ type: 'error', title: "Couldn't claim that", message: 'Check your connection and try again.' })
    } finally {
      setClaimingReward(false)
    }
  }

  async function handleChoreToggle(choreId: string, alreadyDone: boolean) {
    if (alreadyDone || completedChores.has(choreId)) return
    setCompletedChores(prev => new Set([...prev, choreId]))
    const rollback = () =>
      setCompletedChores(prev => {
        const next = new Set(prev)
        next.delete(choreId)
        return next
      })
    try {
      const res = await fetch('/api/chores/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choreId }),
      })
      // fetch only rejects on network failure; a 4xx/5xx must also undo the
      // optimistic tick, or the chore looks done while the server disagrees.
      if (!res.ok) {
        rollback()
        const data = await res.json().catch(() => ({}))
        addToast({ type: 'error', title: "Couldn't mark it done", message: data.error || 'Please try again.' })
        return
      }
    } catch {
      rollback()
      addToast({ type: 'error', title: "Couldn't mark it done", message: 'Check your connection and try again.' })
      return
    }
    // Undo over confirm (#269): a mis-tap is one tap to reverse.
    const title = (chores ?? []).find((c) => c.id === choreId)?.title
    showUndo({
      title: title ? `“${title}” done` : 'Done',
      message: 'A parent will check it.',
      onUndo: async () => {
        const result = await setChoreDone(choreId, false)
        if (result.ok) rollback()
        else addToast({ type: 'error', title: "Couldn't undo", message: result.message })
      },
    })
  }

  function renderMission(chore: Chore, note?: string) {
    const baseDone = chore.status === 'completed' || chore.status === 'verified'
    const isDone = baseDone || completedChores.has(chore.id)
    return (
      <button
        type="button"
        onClick={() => handleChoreToggle(chore.id, isDone)}
        disabled={isDone}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-4 min-h-[64px] text-left',
          'transition-all duration-200',
          !isDone && 'active:bg-[var(--surface-fill-secondary)]'
        )}
      >
        {/* Big check circle. Only the check and title fade when done, so
            "You did it!" keeps its full sage contrast. */}
        <div className={cn(
          'w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-300',
          isDone && 'opacity-60',
          isDone
            ? 'bg-success border-success animate-check-pop'
            : 'border-label-tertiary'
        )}>
          {isDone && (
            <svg className="w-4 h-4 text-white" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
        <div className={cn('flex-1 min-w-0', isDone && 'opacity-60')}>
          <div className={cn(
            'text-title-3 leading-tight [overflow-wrap:anywhere]',
            isDone ? 'text-label-tertiary line-through' : 'text-label-primary'
          )}>
            {chore.title}
          </div>
          {note && <div className="text-footnote text-label-secondary mt-1">{note}</div>}
          {gamification && chore.points && (
            <div className="flex items-center gap-1 mt-1">
              <Star className="w-3.5 h-3.5 text-brand-mustard fill-brand-mustard" />
              <span className="text-footnote text-label-secondary">{chore.points} XP</span>
            </div>
          )}
        </div>
        {isDone && (
          <span className="text-body text-success-text font-medium shrink-0">
            You did it!
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="pb-20">
      {/* Large Header: "Hi, {name}!" + big avatar */}
      <LargeHeader
        title={`Hi, ${firstName(user?.name) ?? 'there'}!`}
        trailing={
          <Avatar
            name={user?.name ?? '?'}
            src={user?.avatar_url}
            size="xl"
          />
        }
        className="px-4"
      />

      <div className="space-y-6 px-4">

        {/* Picture routines (#272): first, because they say what to do next. */}
        {routines.length > 0 && (
          <KidRoutines
            routines={routines}
            tickedIds={completedChores}
            onComplete={(id) => {
              const chore = routineChores.find((c) => c.id === id)
              if (chore) handleChoreToggle(id, chore.status === 'completed' || chore.status === 'verified')
            }}
          />
        )}

        {/* Stars card — XP + level progress (only with Points & streaks on) */}
        {gamification && (
          <div className="card-apple p-5 flex items-center gap-5">
            <ProgressRing
              progress={xpProgress}
              size={88}
              strokeWidth={9}
              color="var(--accent)"
            >
              <div className="flex flex-col items-center leading-none">
                <Star className="w-7 h-7 text-[var(--accent)] fill-current" />
                <span className="text-[20px] font-bold text-label-primary leading-none mt-0.5">
                  {userXp}
                </span>
              </div>
            </ProgressRing>
            <div className="flex-1 min-w-0">
              <p className="text-title-3 text-label-primary leading-tight font-semibold">
                Level {userLevel}
              </p>
              <p className="text-subhead text-label-secondary mt-1">
                {xpNextLevel - userXp} XP to go!
              </p>
              <div className="mt-3 flex items-center gap-1.5">
                {[...Array(Math.min(userLevel, 5))].map((_, i) => (
                  <Sparkles key={i} className="w-4 h-4 text-brand-mustard fill-brand-mustard" />
                ))}
                {userLevel > 5 && (
                  <span className="text-footnote text-label-tertiary">+{userLevel - 5} more</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Today's Chores */}
        {todayChores.length > 0 && (
          <section>
            <p className="section-header">Today&apos;s Missions</p>
            <div className="list-inset">
              {todayChores.map((chore, i) => (
                <div key={chore.id} className={cn(i === todayChores.length - 1 && 'border-b-0')}>
                  {renderMission(chore)}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Earlier open chores: their own small group, most recent first, tickable */}
        {earlierChores.length > 0 && (
          <section>
            <p className="section-header">Still to do</p>
            <div className="list-inset">
              {earlierChores.map((chore, i) => (
                <div key={chore.id} className={cn(i === earlierChores.length - 1 && 'border-b-0')}>
                  {now && renderMission(chore, wasDueLabel(chore.due_date, now))}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Before hydration the local day is unknown: hold the missions' place. */}
        {!now && (
          <section aria-label="Today's chores" aria-busy="true" data-testid="kid-home-pending">
            <div className="h-16 rounded-[var(--radius-xl)] bg-[var(--surface-fill)]" />
          </section>
        )}

        {/* No chores state (a routine shows its own progress instead) */}
        {now && todayChores.length === 0 && routines.length === 0 && (
          <div className="card-apple p-6 text-center">
            <BrandMotion
              motion={MOTION.celebrate}
              className="mx-auto mb-3 h-auto w-[160px] rounded-[var(--radius-lg)] md:w-[192px]"
            />
            {earlierChores.length > 0 ? (
              // Not "all done" while older chores are still waiting above.
              <>
                <p className="text-title-3 text-label-primary">Nothing new today!</p>
                <p className="text-subhead text-label-secondary mt-1">Finish the ones above when you can.</p>
              </>
            ) : (
              <>
                <p className="text-title-3 text-label-primary">All done for today!</p>
                <p className="text-subhead text-label-secondary mt-1">Enjoy your day, superstar!</p>
              </>
            )}
          </div>
        )}

        {/* Tomorrow: a read-only peek, so "All done for today!" can be true */}
        {tomorrowChores.length > 0 && (
          <section>
            <p className="section-header">Tomorrow</p>
            <ul className="list-inset">
              {tomorrowChores.map((chore, i) => (
                <li
                  key={chore.id}
                  className={cn(
                    'px-4 py-3 min-h-[44px] flex items-center text-body text-label-secondary',
                    i === tomorrowChores.length - 1 && 'border-b-0'
                  )}
                >
                  <span className="truncate">{chore.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Coming up — events */}
        {todayEvents.length > 0 && (
          <section>
            <p className="section-header">Coming up</p>
            <div className="list-inset">
              {todayEvents.map((event, i) => (
                <ListRow
                  key={event.id}
                  icon={Calendar}
                  glyphColor="calendar"
                  title={event.title}
                  subtitle={
                    event.location
                      ? `${formatTime(event.start_time)} · ${event.location}`
                      : formatTime(event.start_time)
                  }
                  showChevron={false}
                  trailing={
                    <span className="text-footnote text-label-tertiary">
                      {now && formatRelativeDate(event.start_time, now)}
                    </span>
                  }
                  className={cn(i === todayEvents.length - 1 && 'border-b-0')}
                />
              ))}
            </div>
          </section>
        )}

        {/* Rewards card — claim most recent available reward (hidden when the
            rewards feature is off; the claim endpoint 403s in that case) */}
        {rewardsEnabled && claimableReward && (
          <section>
            <p className="section-header">Rewards</p>
            <div className="card-apple p-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-12 h-12 rounded-full bg-tint-rewards flex items-center justify-center shrink-0 transition-transform duration-300',
                  celebratingReward === claimableReward.id && 'scale-125'
                )}>
                  <Gift className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-body text-label-primary font-medium truncate">
                    {claimableReward.name}
                  </p>
                  {claimableReward.description && (
                    <p className="text-footnote text-label-secondary truncate mt-0.5">
                      {claimableReward.description}
                    </p>
                  )}
                  <div className="flex items-center gap-1 mt-1">
                    <Star className="w-3.5 h-3.5 text-brand-mustard fill-brand-mustard" />
                    <span className="text-footnote text-label-secondary">{claimableReward.cost} XP</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleClaimReward(claimableReward.id)}
                  disabled={claimingReward || celebratingThis || !canClaimReward}
                  className={cn(
                    'btn-primary min-h-[44px] px-4 py-2 text-body shrink-0 transition-all duration-200',
                    celebratingThis
                      ? 'bg-success animate-check-pop'
                      : !canClaimReward
                      ? 'bg-muted text-label-tertiary cursor-not-allowed'
                      : claimingReward
                      ? 'opacity-50'
                      : ''
                  )}
                >
                  {celebratingThis
                    ? '🎉 Claimed!'
                    : canClaimReward
                    ? 'Claim'
                    : `Need ${claimableReward.cost - userXp} more XP`}
                </button>
              </div>
              {celebratingReward === claimableReward.id && (
                <div className="mt-3 flex items-center justify-center gap-1 animate-spring-up">
                  <span className="text-xl">🎉</span>
                  <span className="text-title-3 text-success-text font-semibold">You got it!</span>
                  <span className="text-xl">🎉</span>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}