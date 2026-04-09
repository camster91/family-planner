'use client'

import { useState, useEffect } from 'react'
import { Trophy, CheckCircle, Star, Gift, Calendar, Award, Flame, Sparkles } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { getBadgeById } from '@/lib/gamification'

interface Activity {
  id: string
  type: string
  title: string
  description?: string
  metadata?: string
  created_at: string
  user: {
    id: string
    name: string
    avatar_url?: string
    level: number
  }
}

export default function ActivityFeed() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadActivities()
  }, [])

  const loadActivities = async () => {
    try {
      const res = await fetch('/api/activity?limit=20')
      const data = await res.json()
      if (res.ok) {
        setActivities(data.activities || [])
      }
    } catch (err) {
      console.error('Error loading activities:', err)
    } finally {
      setLoading(false)
    }
  }

  const getIcon = (type: string, metadata?: string) => {
    switch (type) {
      case 'chore_completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'chore_verified':
        return <Sparkles className="w-5 h-5 text-amber-500" />
      case 'reward_claimed':
        return <Gift className="w-5 h-5 text-purple-500" />
      case 'badge_earned': {
        if (metadata) {
          try {
            const { badgeId } = JSON.parse(metadata)
            const badge = getBadgeById(badgeId)
            if (badge) return <span className="text-lg">{badge.icon}</span>
          } catch {}
        }
        return <Award className="w-5 h-5 text-yellow-500" />
      }
      case 'streak_milestone':
        return <Flame className="w-5 h-5 text-orange-500" />
      case 'level_up':
        return <Star className="w-5 h-5 text-purple-500" />
      case 'event_created':
        return <Calendar className="w-5 h-5 text-blue-500" />
      default:
        return <Trophy className="w-5 h-5 text-gray-400" />
    }
  }

  const getBgColor = (type: string) => {
    switch (type) {
      case 'chore_completed': return 'bg-green-50'
      case 'chore_verified': return 'bg-amber-50'
      case 'reward_claimed': return 'bg-purple-50'
      case 'badge_earned': return 'bg-yellow-50'
      case 'level_up': return 'bg-purple-50'
      case 'streak_milestone': return 'bg-orange-50'
      case 'event_created': return 'bg-blue-50'
      default: return 'bg-gray-50'
    }
  }

  const getTimeAgo = (dateStr: string) => {
    const now = new Date()
    const date = new Date(dateStr)
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
    return formatDate(dateStr)
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg animate-pulse">
            <div className="w-8 h-8 bg-gray-200 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Trophy className="w-10 h-10 mx-auto mb-2 text-gray-300" />
        <p className="text-sm">No activity yet. Complete a chore to get started!</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {activities.map((activity) => (
        <div
          key={activity.id}
          className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${getBgColor(activity.type)}`}
        >
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center">
            {getIcon(activity.type, activity.metadata || undefined)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900 font-medium">{activity.title}</p>
            {activity.description && (
              <p className="text-xs text-gray-500 mt-0.5">{activity.description}</p>
            )}
            <p className="text-xs text-gray-400 mt-1">{getTimeAgo(activity.created_at)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
