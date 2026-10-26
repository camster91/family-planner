'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AnalyticsSummaryLimitError } from '@/lib/analytics-summary-contract'
import { TrendingUp } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { Avatar } from '@/components/ui/avatar'
import { Glyph } from '@/components/ui/glyph'
import { ProgressRing } from '@/components/ui/progress-ring'
import { FeatureGate } from '@/components/ui/feature-gate'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import { useAnalyticsText } from '@/i18n/analytics'

import type { AnalyticsData } from '@/lib/analytics-presentation'
import { readHouseholdAnalytics } from '@/lib/analytics-read-client'

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
  const analyticsText = useAnalyticsText()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<"failed" | "limit" | null>(null)

  const live = useRef(false)
  const readSerial = useRef(0)
  const activeRead = useRef<AbortController | null>(null)
  const loadAnalytics = useCallback(async () => {
    if (!live.current) return
    activeRead.current?.abort()
    const controller = new AbortController()
    activeRead.current = controller
    const serial = ++readSerial.current
    const current = () => live.current && !controller.signal.aborted && serial === readSerial.current
    setLoading(true)
    setLoadError(null)
    try {
      // O-31: canonical day counts use the viewer's zone, independent of locale.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const zoneParam = tz
        ? `tz=${encodeURIComponent(tz)}`
        : `tzOffset=${new Date().getTimezoneOffset()}`
      const data = await readHouseholdAnalytics(zoneParam, controller.signal)
      if (current()) setData(data)
    } catch (cause) {
      if (current()) {
        setData(null)
        setLoadError(cause instanceof AnalyticsSummaryLimitError ? "limit" : "failed")
      }
    } finally {
      if (current()) {
        activeRead.current = null
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    live.current = true
    void loadAnalytics()
    return () => {
      live.current = false
      ++readSerial.current
      activeRead.current?.abort()
      activeRead.current = null
    }
  }, [loadAnalytics])

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
    <main className="mx-auto w-full max-w-[1440px] px-4 pb-20 sm:px-6 lg:px-8" aria-label={analyticsText('title')}>
      <LargeHeader
        title={analyticsText('title')}
        subtitle={analyticsText('subtitle')}
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
            <p className="text-title-3 text-label-primary">{analyticsText(loadError === 'limit' ? 'summaryLimit' : 'loadError')}</p>
            <p className="mt-1 text-subhead text-label-secondary">{analyticsText(loadError === 'limit' ? 'summaryLimitHelp' : 'weeklyTrendDescription')}</p>
          </div>
          {loadError === 'limit' ? (
            <Link href="/dashboard/chores" className="btn-tinted inline-flex items-center min-h-[44px] px-4 text-subhead font-semibold">
              {analyticsText('openChores')}
            </Link>
          ) : <button
            type="button"
            onClick={() => void loadAnalytics()}
            className="btn-tinted min-h-[44px] min-w-[44px] px-4 text-subhead font-semibold"
          >
            {analyticsText('retry')}
          </button>}
        </div>
      ) : loading ? (
        <div className="card-apple p-8 text-center text-subhead text-label-secondary" role="status" aria-busy="true">
          {analyticsText('loading')}
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
                    {analyticsText('weeklyProgress')}
                  </h2>
                  <p className="mt-1 text-subhead text-label-secondary">
                    {weeklyCompletion > 0
                      ? analyticsText('weeklyProgressDescription', { percent: weeklyCompletion })
                      : analyticsText('weeklyProgressDescriptionEmpty')}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--surface-separator)] pt-4 text-footnote text-label-secondary">
                {gamification && currentStreak > 0 && <span>{analyticsText('dayStreak', { count: currentStreak })}</span>}
                <span>{analyticsText('completions', { count: totalDone })}</span>
              </div>
            </section>

            {gamification ? (
              <section className="card-apple p-5 sm:p-6" aria-labelledby="family-progress-title">
                <h2 id="family-progress-title" className="text-title-3 text-label-primary">{analyticsText('progressByPerson')}</h2>
                <p className="mt-1 text-subhead text-label-secondary">{analyticsText('progressByPersonDescription')}</p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-[var(--radius-sm)] bg-surface-fill p-3">
                    <div className="text-title-3 font-semibold text-label-primary" data-testid="family-points">{familyPoints}</div>
                    <div className="text-footnote text-label-secondary">{analyticsText('familyPoints')}</div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] bg-surface-fill p-3">
                    <div className="text-title-3 font-semibold text-label-primary" data-testid="best-streak">{analyticsText('daysShort', { count: bestStreak })}</div>
                    <div className="text-footnote text-label-secondary">{analyticsText('bestStreak')}</div>
                  </div>
                </div>
              </section>
            ) : (
              <section className="card-apple flex items-center p-5 sm:p-6" aria-labelledby="family-progress-title">
                <div>
                  <h2 id="family-progress-title" className="text-title-3 text-label-primary">{analyticsText('progressByPerson')}</h2>
                  <p className="mt-1 text-subhead text-label-secondary">{analyticsText('completions', { count: totalDone })}</p>
                </div>
              </section>
            )}
          </div>

          <section className="mt-4 card-apple p-5 sm:p-6" aria-labelledby="weekly-trend-title">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div>
                <h2 id="weekly-trend-title" className="text-title-3 text-label-primary">{analyticsText('weeklyTrend')}</h2>
                <p className="mt-1 text-subhead text-label-secondary">{analyticsText('weeklyTrendDescription')}</p>
              </div>
              <span className="text-footnote text-label-secondary">{analyticsText('completions', { count: totalDone })}</span>
            </div>
            {hasTrend ? (
              <div className="mt-5 grid min-h-[136px] grid-cols-7 items-end gap-1.5 sm:gap-3" data-testid="weekly-trend">
                {weeklyTrend.slice(-7).map((entry) => {
                  const height = entry.count > 0 ? Math.max(16, Math.round((entry.count / maxTrendCount) * 100)) : 8
                  return (
                    <div
                      key={`${entry.date}-${entry.day}`}
                      role="group"
                      aria-label={analyticsText('trendDay', { count: entry.count, day: formatWeekday(entry.date, locale) })}
                      className="flex min-w-0 flex-col items-center gap-2"
                      title={analyticsText('trendDay', { count: entry.count, day: formatWeekday(entry.date, locale) })}
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
                {analyticsText('noTrend')}
              </p>
            )}
          </section>

          <section className="mt-4" aria-labelledby="progress-members-title">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="progress-members-title" className="section-header">{analyticsText('progressByPerson')}</h2>
              <span className="text-footnote text-label-secondary">{members.length}</span>
            </div>
            {members.length === 0 ? (
              <div className="card-apple p-8 text-center">
                <p className="text-title-3 text-label-primary">{analyticsText('noProgress')}</p>
                <p className="mt-1 text-subhead text-label-secondary">{analyticsText('noProgressDescription')}</p>
              </div>
            ) : (
              <ul className="card-apple divide-y divide-[var(--surface-separator)] overflow-hidden" data-testid="progress-members">
                {members.map((member) => (
                  <li key={member.id || member.name} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-3 sm:flex sm:gap-3 sm:px-5">
                    <div className="row-span-2 self-center sm:row-auto"><Avatar name={member.name || '?'} src={member.avatar_url} size="sm" /></div>
                    <div className="min-w-0 sm:flex-1">
                      <div className="break-words text-body text-label-primary">{member.name || '—'}</div>
                      <div className="text-footnote text-label-secondary">
                        {gamification
                          ? analyticsText('level', { level: member.level || 1 })
                          : analyticsText('choresDone', { completed: member.completedChores, total: member.totalChores })}
                      </div>
                    </div>
                    {gamification ? (
                      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-label-secondary sm:shrink-0 sm:justify-end">
                        {(member.streak ?? 0) > 0 && <span>{analyticsText('dayStreak', { count: member.streak ?? 0 })}</span>}
                        <span data-testid="member-points" className="font-semibold text-label-primary">{analyticsText('points', { count: member.xp || 0 })}</span>
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
