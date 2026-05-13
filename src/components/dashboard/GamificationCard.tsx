'use client'

import { Flame, Star } from 'lucide-react'
import { getLevelTitle, getLevelColor, xpProgress, xpForNextLevel, getBadgeById } from '@/lib/gamification'
import { useTranslation } from '@/i18n'

interface Badge {
  badge_id: string
  created_at: string
}

interface GamificationCardProps {
  streak: number
  bestStreak: number
  xp: number
  level: number
  points: number
  badges: Badge[]
}

export default function GamificationCard({ streak, bestStreak, xp, level, points, badges }: GamificationCardProps) {
  const { t } = useTranslation()
  const levelTitle = getLevelTitle(level)
  const levelColor = getLevelColor(level)
  const xpProg = xpProgress(xp)
  const xpNeeded = xpForNextLevel(xp)
  const totalXp = xp
  const nextLevelXp = totalXp + xpNeeded

  const recentBadges: { icon: string; name: string; description: string }[] = []
  const sorted = [...badges].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  for (const b of sorted.slice(0, 6)) {
    const badge = getBadgeById(b.badge_id)
    if (badge) recentBadges.push(badge)
  }

  return (
    <div className="card bg-gradient-to-r from-orange-50 via-yellow-50 to-pink-50 border border-orange-200">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        {/* Streak */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg ${streak > 0 ? 'bg-gradient-to-br from-orange-400 to-red-500' : 'bg-gray-200'}`}>
              <Flame className={`w-8 h-8 ${streak > 0 ? 'text-white' : 'text-gray-400'}`} />
            </div>
            {streak > 0 && (
              <div className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 text-white text-sm font-bold rounded-full flex items-center justify-center border-2 border-white">
                {streak}
              </div>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-600">{t('dashboard.currentStreak')}</p>
            <p className="text-3xl font-bold text-gray-900">
              {streak > 0 ? `${streak} ${t('common.days')}` : t('dashboard.startStreak')}
            </p>
            {bestStreak > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {t('dashboard.bestStreak')}: {bestStreak} {t('common.days')}
              </p>
            )}
          </div>
        </div>

        {/* Level */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-400 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
            <Star className="w-8 h-8 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-600">{t('dashboard.yourLevel')}</p>
            <p className={`text-3xl font-bold ${levelColor}`}>{t('common.level')} {level}</p>
            <p className="text-sm font-medium text-gray-700">{levelTitle}</p>
          </div>
        </div>

        {/* XP Progress */}
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">{t('dashboard.xpProgress')}</span>
            <span className="text-sm font-bold text-gray-900">{totalXp} / {nextLevelXp} XP</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-gradient-to-r from-indigo-500 to-purple-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${xpProg}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">{xpNeeded} XP {t('dashboard.toNextLevel')}</p>
        </div>
      </div>

      {/* Badges */}
      {recentBadges.length > 0 && (
        <div className="mt-6 pt-6 border-t border-orange-100">
          <p className="text-sm font-medium text-gray-600 mb-3">{t('dashboard.recentBadges')}</p>
          <div className="flex flex-wrap gap-3">
            {recentBadges.map((badge, i) => (
              <div
                key={i}
                className="flex items-center gap-2 bg-white rounded-full px-3 py-2 shadow-sm border border-gray-100"
                title={badge.description}
              >
                <span className="text-xl">{badge.icon}</span>
                <span className="text-sm font-medium text-gray-700">{badge.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
