'use client'

import { useState, useEffect } from 'react'
import { Trophy, Flame, Star, Medal, ChevronUp } from 'lucide-react'
import { getLevelColor, getLevelTitle, xpProgress } from '@/lib/gamification'

interface LeaderboardEntry {
  rank: number
  id: string
  name: string
  avatar_url?: string
  points: number
  level: number
  xp: number
  xpProgress: number
  levelTitle: string
  streak: number
  bestStreak: number
  role: string
  badgeCount: number
}

interface Props {
  currentUserId?: string
}

export default function Leaderboard({ currentUserId }: Props) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [familyStats, setFamilyStats] = useState<{ totalPoints: number; totalBadges: number; highestStreak: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadLeaderboard()
  }, [])

  const loadLeaderboard = async () => {
    try {
      const res = await fetch('/api/gamification')
      const data = await res.json()
      if (res.ok) {
        setLeaderboard(data.leaderboard || [])
        setFamilyStats(data.familyStats || null)
      }
    } catch (err) {
      console.error('Error loading leaderboard:', err)
    } finally {
      setLoading(false)
    }
  }

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1: return <span className="text-2xl">&#x1F947;</span>
      case 2: return <span className="text-2xl">&#x1F948;</span>
      case 3: return <span className="text-2xl">&#x1F949;</span>
      default: return <span className="text-lg font-bold text-gray-400">#{rank}</span>
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
            <div className="w-10 h-10 bg-gray-200 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="h-3 bg-gray-200 rounded w-2/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Family Stats */}
      {familyStats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-4 text-center">
            <Star className="w-6 h-6 text-amber-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-amber-700">{familyStats.totalPoints.toLocaleString()}</p>
            <p className="text-xs text-amber-600">Total Points</p>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 text-center">
            <Medal className="w-6 h-6 text-purple-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-purple-700">{familyStats.totalBadges}</p>
            <p className="text-xs text-purple-600">Badges Earned</p>
          </div>
          <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4 text-center">
            <Flame className="w-6 h-6 text-orange-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-orange-700">{familyStats.highestStreak}</p>
            <p className="text-xs text-orange-600">Best Streak</p>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div className="space-y-2">
        {leaderboard.map((entry) => {
          const isCurrentUser = entry.id === currentUserId

          return (
            <div
              key={entry.id}
              className={`flex items-center gap-4 p-4 rounded-xl transition-all ${
                isCurrentUser
                  ? 'bg-blue-50 border-2 border-blue-200 shadow-sm'
                  : 'bg-white border border-gray-100 hover:border-gray-200'
              }`}
            >
              {/* Rank */}
              <div className="flex-shrink-0 w-10 text-center">
                {getRankIcon(entry.rank)}
              </div>

              {/* Avatar */}
              <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${
                entry.rank === 1 ? 'bg-amber-500' :
                entry.rank === 2 ? 'bg-gray-400' :
                entry.rank === 3 ? 'bg-amber-700' : 'bg-blue-500'
              }`}>
                {entry.name.charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 truncate">{entry.name}</span>
                  <span className={`text-xs font-medium ${getLevelColor(entry.level)}`}>
                    Lv.{entry.level}
                  </span>
                  {isCurrentUser && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">You</span>
                  )}
                </div>

                {/* XP Progress bar */}
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-purple-500 rounded-full h-1.5 transition-all"
                      style={{ width: `${entry.xpProgress}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400">{entry.xp} XP</span>
                </div>

                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">{entry.points.toLocaleString()} pts</span>
                  {entry.streak > 0 && (
                    <span className="flex items-center text-orange-500">
                      <Flame className="w-3 h-3 mr-0.5" />{entry.streak}d
                    </span>
                  )}
                  {entry.badgeCount > 0 && (
                    <span className="flex items-center text-amber-600">
                      <Trophy className="w-3 h-3 mr-0.5" />{entry.badgeCount}
                    </span>
                  )}
                </div>
              </div>

              {/* Points */}
              <div className="flex-shrink-0 text-right">
                <div className="flex items-center gap-1">
                  <ChevronUp className="w-4 h-4 text-green-500" />
                  <span className="font-bold text-gray-900">{entry.points}</span>
                </div>
                <p className="text-xs text-gray-400">points</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
