'use client'

import { CheckCircle, Calendar, TrendingUp, Users, BarChart3, PlusCircle } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from '@/i18n'
import ActivityFeed from '@/components/activity/ActivityFeed'
import GamificationCard from '@/components/dashboard/GamificationCard'

interface Chore {
  id: string
  title: string
  due_date: string
  status: string
}

interface Event {
  id: string
  title: string
  start_time: string
  location?: string | null
}

interface Stats {
  totalChores: number
  completedChores: number
  pendingChores: number
  upcomingEvents: number
  userPoints: number
  pointsProgress: number
  nextReward: number
  unreadMessages: number
  userStreak?: number
  userBestStreak?: number
  userXp?: number
  userLevel?: number
  recentBadges?: { badge_id: string; created_at: string }[]
}

interface DashboardHomeProps {
  user: { name?: string; family_id?: string | null }
  chores: Chore[]
  events: Event[]
  stats: Stats
  completionRate: number
}

export default function DashboardHome({ user, chores, events, stats, completionRate }: DashboardHomeProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-8">
      {/* Welcome header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          {t('dashboard.welcomeBack', { name: user?.name || '' })}
        </h1>
        <p className="mt-2 text-gray-600">
          {user?.family_id
            ? t('dashboard.whatsHappening')
            : t('dashboard.getStarted')
          }
        </p>
      </div>

      {/* Gamification achievements */}
      <GamificationCard
        streak={stats.userStreak || 0}
        bestStreak={stats.userBestStreak || 0}
        xp={stats.userXp || 0}
        level={stats.userLevel || 1}
        points={stats.userPoints || 0}
        badges={stats.recentBadges || []}
      />

      {/* Family status */}
      {!user?.family_id && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-center">
            <Users className="w-8 h-8 text-blue-600 mr-4" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{t('dashboard.noFamilyYet')}</h3>
              <p className="text-gray-600 mt-1">
                {t('dashboard.noFamilyDesc')}
              </p>
              <div className="mt-4 flex space-x-4">
                <Link href="/dashboard/family/create" className="btn-primary">
                  {t('dashboard.createFamily')}
                </Link>
                <Link href="/join" className="btn-secondary">
                  {t('dashboard.joinFamily')}
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">{t('dashboard.completionRate')}</p>
              <p className="text-2xl font-semibold text-gray-900">{completionRate}%</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-600 h-2 rounded-full"
                style={{ width: `${completionRate}%` }}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0 w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <span className="text-xl font-bold text-yellow-600">⭐</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">{t('dashboard.yourPoints')}</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.userPoints}</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>{t('dashboard.progressToNext')}</span>
              <span>{stats.userPoints}/{stats.nextReward}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-yellow-500 h-2 rounded-full"
                style={{ width: `${stats.pointsProgress}%` }}
              />
            </div>
            <Link
              href="/dashboard/rewards"
              className="mt-2 inline-block text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              {stats.pointsProgress >= 100 ? t('dashboard.claimReward') + ' →' : t('dashboard.viewRewards') + ' →'}
            </Link>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">{t('dashboard.pendingChores')}</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.pendingChores}</p>
            </div>
          </div>
          <Link
            href="/dashboard/chores"
            className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            {t('dashboard.viewAllChores')} →
          </Link>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0 w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <Calendar className="w-6 h-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">{t('dashboard.upcomingEvents')}</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.upcomingEvents}</p>
            </div>
          </div>
          <Link
            href="/dashboard/calendar"
            className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            {t('dashboard.viewCalendar')} →
          </Link>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent chores */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">{t('dashboard.recentChores')}</h2>
            <Link
              href="/dashboard/chores"
              className="text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              {t('dashboard.viewAll')}
            </Link>
          </div>
          <div className="space-y-4">
            {chores?.slice(0, 5).map((chore) => (
              <div key={chore.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{chore.title}</p>
                  <p className="text-sm text-gray-600">
                    {t('dashboard.due')} {new Date(chore.due_date).toLocaleDateString()}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  chore.status === 'completed' || chore.status === 'verified'
                    ? 'bg-green-100 text-green-800'
                    : chore.status === 'in_progress'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {chore.status.replace('_', ' ')}
                </span>
              </div>
            ))}
            {(!chores || chores.length === 0) && (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">{t('dashboard.noChoresAssigned')}</p>
                <Link
                  href="/dashboard/chores/create"
                  className="mt-4 inline-block text-blue-600 hover:text-blue-500 font-medium"
                >
                  {t('dashboard.createFirstChore')}
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming events */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">{t('dashboard.upcomingEventsTitle')}</h2>
            <Link
              href="/dashboard/calendar"
              className="text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              {t('dashboard.viewAll')}
            </Link>
          </div>
          <div className="space-y-4">
            {events?.map((event) => (
              <div key={event.id} className="p-3 bg-gray-50 rounded-lg">
                <div className="flex items-start">
                  <div className="flex-shrink-0 mt-1">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                  </div>
                  <div className="ml-3">
                    <p className="font-medium text-gray-900">{event.title}</p>
                    <p className="text-sm text-gray-600">
                      {new Date(event.start_time).toLocaleDateString()} •{' '}
                      {new Date(event.start_time).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                    {event.location && (
                      <p className="text-sm text-gray-500 mt-1">📍 {event.location}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {(!events || events.length === 0) && (
              <div className="text-center py-8">
                <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">{t('dashboard.noUpcomingEvents')}</p>
                <Link
                  href="/dashboard/calendar/create"
                  className="mt-4 inline-block text-blue-600 hover:text-blue-500 font-medium"
                >
                  {t('dashboard.addEvent')}
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      {user?.family_id && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">{t('dashboard.familyActivity')}</h2>
            <Link
              href="/dashboard/analytics"
              className="text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              {t('dashboard.viewAll')}
            </Link>
          </div>
          <ActivityFeed />
        </div>
      )}

      {/* Progress Analytics Preview */}
      <div className="card bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center mr-4">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{t('dashboard.trackProgress')}</h3>
              <p className="text-sm text-gray-600">{t('dashboard.seeDetailedAnalytics')}</p>
            </div>
          </div>
          <Link
            href="/dashboard/analytics"
            className="btn-primary"
          >
            {t('dashboard.viewAnalytics')}
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-indigo-600">{t('dashboard.weeklyTrends')}</div>
            <p className="text-sm text-gray-600 mt-2">{t('dashboard.weeklyTrendsDesc')}</p>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">{t('dashboard.topPerformers')}</div>
            <p className="text-sm text-gray-600 mt-2">{t('dashboard.topPerformersDesc')}</p>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-pink-600">{t('dashboard.achievementTracking')}</div>
            <p className="text-sm text-gray-600 mt-2">{t('dashboard.achievementTrackingDesc')}</p>
          </div>
        </div>
      </div>

      {/* Quick tips */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6">
        <div className="flex items-center mb-4">
          <TrendingUp className="w-6 h-6 text-blue-600 mr-3" />
          <h3 className="text-lg font-semibold text-gray-900">{t('dashboard.quickTips')}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h4 className="font-medium text-gray-900 mb-2">{t('dashboard.assignChores')}</h4>
            <p className="text-sm text-gray-600">
              {t('dashboard.assignChoresDesc')}
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-2">{t('dashboard.scheduleEvents')}</h4>
            <p className="text-sm text-gray-600">
              {t('dashboard.scheduleEventsDesc')}
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-2">{t('dashboard.communicate')}</h4>
            <p className="text-sm text-gray-600">
              {t('dashboard.communicateDesc')}
            </p>
          </div>
        </div>
      </div>

      {/* Admin controls (only visible to parents) - imported dynamically to avoid SSR issues */}
    </div>
  )
}