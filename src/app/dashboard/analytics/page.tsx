'use client'

import { useEffect, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { Avatar } from '@/components/ui/avatar'
import { Glyph } from '@/components/ui/glyph'
import { ProgressRing } from '@/components/ui/progress-ring'
import { FeatureGate } from '@/components/ui/feature-gate'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import { useAnalyticsText } from '@/i18n/analytics'

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

interface WeeklyTrend {
  date: string
  day: string
  count: number
  points?: number
}

interface AnalyticsData {
  members: Member[]
  weeklyCompletion: number
  weeklyTrend: WeeklyTrend[]
  gamification: boolean
  summary: {
    totalChores: number
    completedChores: number
    completionRate: number
    currentStreak: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * Parse the canonical analytics response without turning a malformed 200 into
 * a believable empty household. Unknown additive fields remain allowed, and
 * gamification fields remain optional because the API omits them when the
 * family setting is off.
 */
export function parseAnalyticsPayload(payload: unknown): AnalyticsData | null {
  if (!isRecord(payload)) return null
  if (typeof payload.weeklyCompletion !== 'number' || !isPercent(payload.weeklyCompletion)) return null
  if (typeof payload.gamification !== 'boolean') return null
  if (!isRecord(payload.summary)) return null

  const summary = payload.summary
  if (!isCount(summary.totalChores) || !isCount(summary.completedChores)) return null
  if (summary.completedChores > summary.totalChores) return null
  if (!isPercent(summary.completionRate) || !isCount(summary.currentStreak)) return null

  if (!Array.isArray(payload.members) || !Array.isArray(payload.weeklyTrend)) return null

  const memberIds = new Set<string>()
  const members: Member[] = []
  for (const value of payload.members) {
    if (!isRecord(value)) return null
    if (typeof value.id !== 'string' || value.id.length === 0 || memberIds.has(value.id)) return null
    if (typeof value.name !== 'string' || typeof value.role !== 'string') return null
    if (!isCount(value.completedChores) || !isCount(value.totalChores) || value.completedChores > value.totalChores) return null
    memberIds.add(value.id)
    members.push({
      id: value.id,
      name: value.name,
      role: value.role,
      avatar_url: typeof value.avatar_url === 'string' ? value.avatar_url : null,
      completedChores: value.completedChores,
      totalChores: value.totalChores,
      xp: isCount(value.xp) ? value.xp : undefined,
      level: isCount(value.level) ? value.level : undefined,
      streak: isCount(value.streak) ? value.streak : undefined,
      best_streak: isCount(value.best_streak) ? value.best_streak : undefined,
    })
  }

  const trendDates = new Set<string>()
  const weeklyTrend: WeeklyTrend[] = []
  for (const value of payload.weeklyTrend) {
    if (!isRecord(value) || !isDateOnly(value.date) || trendDates.has(value.date)) return null
    if (typeof value.day !== 'string' || !isCount(value.count)) return null
    if (value.points !== undefined && !isCount(value.points)) return null
    trendDates.add(value.date)
    weeklyTrend.push({
      date: value.date,
      day: value.day,
      count: value.count,
      points: isCount(value.points) ? value.points : undefined,
    })
  }

  return {
    members,
    weeklyCompletion: payload.weeklyCompletion,
    weeklyTrend,
    gamification: payload.gamification,
    summary: {
      totalChores: summary.totalChores,
      completedChores: summary.completedChores,
      completionRate: summary.completionRate,
      currentStreak: summary.currentStreak,
    },
  }
}

function formatWeekday(date: string, locale: string): string {
  const parsed = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date.slice(-2)
  return parsed.toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  }).replace('.', '')
}

function AnalyticsPageContent() {
  const { locale } = useTranslation()
  const t = useAnalyticsText()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    void loadAnalytics()
  }, [])

  const loadAnalytics = async () => {
    setLoading(true)
    setLoadError(false)
    try {
      // O-31: the server counts days in the viewer's local zone.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const zoneParam = tz
        ? `tz=${encodeURIComponent(tz)}`
        : `tzOffset=${new Date().getTimezoneOffset()}`
      const res = await fetch(`/api/analytics?${zoneParam}`)
      const payload: unknown = await res.json()
      const parsed = res.ok ? parseAnalyticsPayload(payload) : null
      if (!parsed) {
        setLoadError(true)
        return
      }
      setData(parsed)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  const members = data?.members ?? []
  const gamification = data?.gamification === true
  const weeklyCompletion = data?.weeklyCompletion ?? 0
  const totalDone = data?.summary.completedChores ?? members.reduce((sum, member) => sum + member.completedChores, 0)
  const familyPoints = members.reduce((sum, member) => sum + (member.xp ?? 0), 0)
  const bestStreak = Math.max(0, ...members.map((member) => member.best_streak ?? 0))
  const currentStreak = data?.summary.currentStreak ?? 0
  const weeklyTrend = data?.weeklyTrend ?? []
  const maxTrendCount = Math.max(1, ...weeklyTrend.map((entry) => entry.count))
  const hasTrend = weeklyTrend.some((entry) => entry.count > 0)

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 pb-20 sm:px-6 lg:px-8" aria-label={t('title')}>
      <LargeHeader
        title={t('title')}
        subtitle={t('subtitle')}
        trailing={
          <Glyph color="chore" size="md" aria-hidden="true">
            <TrendingUp className="h-4 w-4" />
          </Glyph>
        }
        className="px-0"
      />

      {loadError ? (
        <div role="alert" className="card-apple flex flex-col items-start gap-3 p-5">
          <div>
            <p className="text-title-3 text-label-primary">{t('loadError')}</p>
            <p className="mt-1 text-subhead text-label-secondary">{t('weeklyTrendDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => void loadAnalytics()}
            className="btn-tinted min-h-[44px] min-w-[44px] px-4 text-subhead font-semibold"
          >
            {t('retry')}
          </button>
        </div>
      ) : loading ? (
        <div className="card-apple p-8 text-center text-subhead text-label-secondary" role="status" aria-busy="true">
          {t('loading')}
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <section className="card-apple p-5 sm:p-6" aria-labelledby="weekly-progress-title">
              <div className="flex flex-wrap items-center gap-5">
                <ProgressRing
                  progress={weeklyCompletion / 100}
                  size={88}
                  strokeWidth={8}
                  color="var(--accent)"
                >
                  <span className="text-[26px] font-bold leading-none text-label-primary">
                    {weeklyCompletion}%
                  </span>
                </ProgressRing>
                <div className="min-w-0 flex-1">
                  <h2 id="weekly-progress-title" className="text-title-3 text-label-primary">
                    {t('weeklyProgress')}
                  </h2>
                  <p className="mt-1 text-subhead text-label-secondary">
                    {weeklyCompletion > 0
                      ? t('weeklyProgressDescription', { percent: weeklyCompletion })
                      : t('weeklyProgressDescriptionEmpty')}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--surface-separator)] pt-4 text-footnote text-label-secondary">
                {gamification && currentStreak > 0 && <span>{t('dayStreak', { count: currentStreak })}</span>}
                <span>{t('completions', { count: totalDone })}</span>
              </div>
            </section>

            {gamification ? (
              <section className="card-apple p-5 sm:p-6" aria-labelledby="family-progress-title">
                <h2 id="family-progress-title" className="text-title-3 text-label-primary">{t('progressByPerson')}</h2>
                <p className="mt-1 text-subhead text-label-secondary">{t('progressByPersonDescription')}</p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-[var(--radius-sm)] bg-surface-fill p-3">
                    <div className="text-title-3 font-semibold text-label-primary" data-testid="family-points">{familyPoints}</div>
                    <div className="text-footnote text-label-secondary">{t('familyPoints')}</div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] bg-surface-fill p-3">
                    <div className="text-title-3 font-semibold text-label-primary" data-testid="best-streak">{t('daysShort', { count: bestStreak })}</div>
                    <div className="text-footnote text-label-secondary">{t('bestStreak')}</div>
                  </div>
                </div>
              </section>
            ) : (
              <section className="card-apple flex items-center p-5 sm:p-6" aria-labelledby="family-progress-title">
                <div>
                  <h2 id="family-progress-title" className="text-title-3 text-label-primary">{t('progressByPerson')}</h2>
                  <p className="mt-1 text-subhead text-label-secondary">{t('completions', { count: totalDone })}</p>
                </div>
              </section>
            )}
          </div>

          <section className="mt-4 card-apple p-5 sm:p-6" aria-labelledby="weekly-trend-title">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div>
                <h2 id="weekly-trend-title" className="text-title-3 text-label-primary">{t('weeklyTrend')}</h2>
                <p className="mt-1 text-subhead text-label-secondary">{t('weeklyTrendDescription')}</p>
              </div>
              <span className="text-footnote text-label-secondary">{t('completions', { count: totalDone })}</span>
            </div>
            {hasTrend ? (
              <div className="mt-5 grid min-h-[136px] grid-cols-7 items-end gap-1.5 sm:gap-3" data-testid="weekly-trend">
                {weeklyTrend.slice(-7).map((entry) => {
                  const height = entry.count > 0 ? Math.max(16, Math.round((entry.count / maxTrendCount) * 100)) : 8
                  return (
                    <div
                      key={`${entry.date}-${entry.day}`}
                      role="group"
                      aria-label={t('trendDay', { count: entry.count, day: formatWeekday(entry.date, locale) })}
                      className="flex min-w-0 flex-col items-center gap-2"
                      title={t('trendDay', { count: entry.count, day: formatWeekday(entry.date, locale) })}
                    >
                      <div className="flex h-24 w-full items-end justify-center">
                        <div
                          aria-hidden="true"
                          className={cn('w-full max-w-10 rounded-t-[var(--radius-sm)]', entry.count > 0 ? 'bg-[var(--accent)]' : 'bg-surface-fill')}
                          style={{ height: `${height}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-label-secondary">{formatWeekday(entry.date, locale)}</span>
                      <span className="text-[11px] font-semibold tabular-nums text-label-primary">{entry.count}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="mt-5 rounded-[var(--radius-sm)] bg-surface-fill px-4 py-5 text-center text-subhead text-label-secondary" data-testid="weekly-trend-empty">
                {t('noTrend')}
              </p>
            )}
          </section>

          <section className="mt-4" aria-labelledby="progress-members-title">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="progress-members-title" className="section-header">{t('progressByPerson')}</h2>
              <span className="text-footnote text-label-secondary">{members.length}</span>
            </div>
            {members.length === 0 ? (
              <div className="card-apple p-8 text-center">
                <p className="text-title-3 text-label-primary">{t('noProgress')}</p>
                <p className="mt-1 text-subhead text-label-secondary">{t('noProgressDescription')}</p>
              </div>
            ) : (
              <ul className="card-apple divide-y divide-[var(--surface-separator)] overflow-hidden" data-testid="progress-members">
                {members.map((member) => (
                  <li key={member.id || member.name} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <Avatar name={member.name || '?'} src={member.avatar_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-body text-label-primary">{member.name || '—'}</div>
                      <div className="text-footnote text-label-secondary">
                        {gamification
                          ? t('level', { level: member.level || 1 })
                          : t('choresDone', { completed: member.completedChores, total: member.totalChores })}
                      </div>
                    </div>
                    {gamification ? (
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-footnote text-label-secondary">
                        {(member.streak ?? 0) > 0 && <span>{t('dayStreak', { count: member.streak ?? 0 })}</span>}
                        <span data-testid="member-points" className="font-semibold text-label-primary">{t('points', { count: member.xp || 0 })}</span>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
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
