'use client'

import { useState, useEffect } from 'react'
import { Zap, Award, TrendingUp } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { Avatar } from '@/components/ui/avatar'
import { Glyph } from '@/components/ui/glyph'
import { ProgressRing } from '@/components/ui/progress-ring'
import { InsetList } from '@/components/ui/list-row'
import { cn } from '@/lib/utils'
import { FeatureGate } from '@/components/ui/feature-gate'

// From GET /api/analytics. xp/level/streak/best_streak are only present when
// the family has Points & streaks on (#248).
interface Member {
  id: string
  name: string
  role: string
  avatar_url?: string | null
  completedChores: number
  totalChores: number
  xp?: number
  level?: number
  streak?: number
  best_streak?: number
}

function AnalyticsPageContent() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [weeklyCompletion, setWeeklyCompletion] = useState(0)
  const [gamification, setGamification] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    loadAnalytics()
  }, [])

  const loadAnalytics = async () => {
    try {
      // O-31: the server counts days in the viewer's local zone.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const zoneParam = tz
        ? `tz=${encodeURIComponent(tz)}`
        : `tzOffset=${new Date().getTimezoneOffset()}`
      const res = await fetch(`/api/analytics?${zoneParam}`)
      const data = await res.json()
      if (res.ok) {
        if (Array.isArray(data.members)) setMembers(data.members)
        if (typeof data.weeklyCompletion === 'number') setWeeklyCompletion(data.weeklyCompletion)
        setGamification(data.gamification === true)
        setLoadError(false)
      } else {
        setLoadError(true)
      }
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  const totalXP = members.reduce((sum, m) => sum + (m.xp || 0), 0)
  const totalDone = members.reduce((sum, m) => sum + m.completedChores, 0)
  const bestStreak = Math.max(0, ...members.map(m => m.best_streak || 0))
  const topLevel = Math.max(1, ...members.map(m => m.level || 1))

  return (
    <div className="pb-20">
      <LargeHeader
        title="Analytics"
        subtitle="Weekly progress & leaderboard"
        trailing={
          <Glyph color="chore" size="md">
            <TrendingUp className="w-4 h-4" />
          </Glyph>
        }
        className="px-4"
      />

      {/* Weekly completion ring */}
      <div className="px-4 mb-6">
        <div className="card-apple p-5 flex items-center gap-5">
          <ProgressRing
            progress={weeklyCompletion / 100}
            size={80}
            strokeWidth={8}
            color="var(--accent)"
          >
            <span className="text-[28px] font-bold leading-none text-label-primary">
              {weeklyCompletion}%
            </span>
          </ProgressRing>
          <div className="flex-1 min-w-0">
            <p className="text-title-3 text-label-primary leading-tight">Weekly completion</p>
            <p className="text-subhead text-label-secondary mt-1">Family progress this week</p>
          </div>
        </div>
      </div>

      {/* Stats row: points and levels only when Points & streaks is on */}
      {gamification ? (
        <div className="grid grid-cols-3 gap-3 px-4 mb-6">
          <div className="card-apple p-4 text-center">
            <div className="text-2xl font-bold text-label-primary">{totalXP}</div>
            <div className="text-caption-1 text-label-secondary">Family XP</div>
          </div>
          <div className="card-apple p-4 text-center">
            <div className="flex items-center justify-center gap-1">
              <span className="text-2xl font-bold text-label-primary">{bestStreak}d</span>
            </div>
            <div className="text-caption-1 text-label-secondary">Best streak</div>
          </div>
          <div className="card-apple p-4 text-center">
            <div className="text-2xl font-bold text-label-primary">Lvl {topLevel}</div>
            <div className="text-caption-1 text-label-secondary">Top level</div>
          </div>
        </div>
      ) : (
        <div className="px-4 mb-6">
          <div className="card-apple p-4 text-center">
            <div className="text-2xl font-bold text-label-primary">{totalDone}</div>
            <div className="text-caption-1 text-label-secondary">Chores done in the last 90 days</div>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div className="px-4">
        <p className="section-header">{gamification ? 'Leaderboard' : 'Who did what'}</p>
        {loadError ? (
          <div role="alert" className="card-apple p-6 text-center space-y-3">
            <div className="text-subhead text-label-secondary">Could not load analytics.</div>
            <button
              type="button"
              onClick={() => {
                setLoading(true)
                void loadAnalytics()
              }}
              className="btn-tinted px-4 rounded-lg text-subhead font-semibold"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="text-center py-8">
            <div className="text-subhead text-label-secondary">Loading…</div>
          </div>
        ) : members.length === 0 ? (
          <div className="card-apple p-8 text-center">
            <div className="text-subhead text-label-secondary">No data yet</div>
          </div>
        ) : (
          <InsetList>
            {members.map((member, i) => (
              <div
                key={member.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                  i === 0 ? 'bg-[var(--warning-tint)] text-warning-text' :
                  i === 1 ? 'bg-muted text-muted-foreground' :
                  i === 2 ? 'bg-[var(--accent-tint)] text-primary' :
                  'bg-surface-fill text-label-secondary'
                )}>
                  {i + 1}
                </span>
                <Avatar name={member.name} src={member.avatar_url} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-body text-label-primary truncate">{member.name}</div>
                  <div className="text-footnote text-label-secondary">
                    {gamification
                      ? `Level ${member.level || 1}`
                      : `${member.completedChores} of ${member.totalChores} chores done`}
                  </div>
                </div>
                {gamification && (member.streak ?? 0) > 0 && (
                  <div className="flex items-center gap-1 text-orange-500 shrink-0">
                    <span className="text-sm">🔥</span>
                    <span className="text-footnote font-medium">{member.streak}d</span>
                  </div>
                )}
                {gamification && (
                  <div className="text-title-3 text-label-primary font-semibold shrink-0">
                    {member.xp || 0} XP
                  </div>
                )}
              </div>
            ))}
          </InsetList>
        )}
      </div>
    </div>
  )
}

// Off state instead of the page while Analytics (and Points & streaks, which the leaderboard needs, #248) is off.
// The API behind it returns 403 in that case too.
export default function AnalyticsPage() {
  return (
    <FeatureGate featureKey="analytics">
      <AnalyticsPageContent />
    </FeatureGate>
  )
}
