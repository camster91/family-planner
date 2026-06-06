'use client'

import { useState } from 'react'
import { Star, Gift, Calendar, Sparkles } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { Avatar } from '@/components/ui/avatar'
import { CheckboxRow } from '@/components/ui/checkbox-row'
import { ProgressRing } from '@/components/ui/progress-ring'
import { ListRow } from '@/components/ui/list-row'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types'

interface Chore {
  id: string
  title: string
  due_date: string
  status: string
  points?: number
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

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Stars needed per level (roughly exponential)
function xpForLevel(level: number): number {
  return level * 100
}

export default function KidHome({
  user,
  chores,
  events,
  rewards,
}: KidHomeProps) {
  const [celebratingReward, setCelebratingReward] = useState<string | null>(null)
  const [claimingReward, setClaimingReward] = useState(false)
  const [completedChores, setCompletedChores] = useState<Set<string>>(new Set())

  const userXp = user.xp ?? 0
  const userLevel = user.level ?? 1
  const xpNextLevel = xpForLevel(userLevel + 1)
  const xpProgress = Math.min(userXp / xpNextLevel, 1)

  // Today's chores (pending + in_progress) — up to 3
  const todayChores = (chores ?? []).filter(
    (c) => c.status === 'pending' || c.status === 'in_progress'
  ).slice(0, 3)

  // Today's events — up to 2
  const todayEvents = (events ?? []).filter((e) => {
    const eventDate = new Date(e.start_time)
    const today = new Date()
    return eventDate.toDateString() === today.toDateString()
  }).slice(0, 2)

  // Most recent available reward to claim
  const claimableReward = (rewards ?? []).find((r) => r.status === 'available')

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
        setCelebratingReward(rewardId)
        setTimeout(() => setCelebratingReward(null), 2000)
      }
    } finally {
      setClaimingReward(false)
    }
  }

  async function handleChoreToggle(choreId: string, alreadyDone: boolean) {
    if (alreadyDone || completedChores.has(choreId)) return
    setCompletedChores(prev => new Set([...prev, choreId]))
    try {
      await fetch('/api/chores/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choreId }),
      })
    } catch {
      setCompletedChores(prev => {
        const next = new Set(prev)
        next.delete(choreId)
        return next
      })
    }
  }

  return (
    <div className="pb-20">
      {/* Large Header: "Hi, {name}!" + big avatar */}
      <LargeHeader
        title={`Hi, ${user?.name ?? 'there'}!`}
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

        {/* Stars card — XP + level progress */}
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
                <Sparkles key={i} className="w-4 h-4 text-amber-400 fill-amber-400" />
              ))}
              {userLevel > 5 && (
                <span className="text-footnote text-label-tertiary">+{userLevel - 5} more</span>
              )}
            </div>
          </div>
        </div>

        {/* Today's Chores */}
        {todayChores.length > 0 && (
          <section>
            <p className="section-header">Today&apos;s Missions</p>
            <div className="list-inset">
              {todayChores.map((chore, i) => {
                const baseDone = chore.status === 'completed' || chore.status === 'verified'
                const isDone = baseDone || completedChores.has(chore.id)
                return (
                  <div key={chore.id} className={cn(i === todayChores.length - 1 && 'border-b-0')}>
                    <button
                      type="button"
                      onClick={() => handleChoreToggle(chore.id, isDone)}
                      disabled={isDone}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-4 min-h-[64px] text-left',
                        'transition-all duration-200',
                        isDone
                          ? 'opacity-60'
                          : 'active:bg-[var(--surface-fill-secondary)]'
                      )}
                    >
                      {/* Big check circle */}
                      <div className={cn(
                        'w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-300',
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
                      <div className="flex-1 min-w-0">
                        <div className={cn(
                          'text-title-3 truncate leading-tight',
                          isDone ? 'text-label-tertiary line-through' : 'text-label-primary'
                        )}>
                          {chore.title}
                        </div>
                        {chore.points && (
                          <div className="flex items-center gap-1 mt-1">
                            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                            <span className="text-footnote text-label-secondary">{chore.points} XP</span>
                          </div>
                        )}
                      </div>
                      {isDone && (
                        <span className="text-body text-success font-medium shrink-0">
                          You did it!
                        </span>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* No chores state */}
        {todayChores.length === 0 && (
          <div className="card-apple p-6 text-center">
            <div className="text-4xl mb-2">🎉</div>
            <p className="text-title-3 text-label-primary">All done for today!</p>
            <p className="text-subhead text-label-secondary mt-1">Enjoy your day, superstar!</p>
          </div>
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
                      {formatRelativeDate(event.start_time)}
                    </span>
                  }
                  className={cn(i === todayEvents.length - 1 && 'border-b-0')}
                />
              ))}
            </div>
          </section>
        )}

        {/* Rewards card — claim most recent available reward */}
        {claimableReward && (
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
                    <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                    <span className="text-footnote text-label-secondary">{claimableReward.cost} XP</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleClaimReward(claimableReward.id)}
                  disabled={claimingReward || celebratingReward === claimableReward.id}
                  className={cn(
                    'btn-primary px-4 py-2 text-body shrink-0 transition-all duration-200',
                    celebratingReward === claimableReward.id
                      ? 'bg-success animate-check-pop'
                      : claimingReward
                      ? 'opacity-50'
                      : ''
                  )}
                >
                  {celebratingReward === claimableReward.id ? '🎉 Claimed!' : 'Claim'}
                </button>
              </div>
              {celebratingReward === claimableReward.id && (
                <div className="mt-3 flex items-center justify-center gap-1 animate-spring-up">
                  <span className="text-xl">🎉</span>
                  <span className="text-title-3 text-success font-semibold">You got it!</span>
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