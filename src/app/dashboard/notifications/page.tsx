'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, Check, Trash2, Clock } from 'lucide-react'
import { Glyph } from '@/components/ui/glyph'
import { InsetList } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { cn, formatDate } from '@/lib/utils'

const GLYPH_COLORS: Record<string, 'chore' | 'calendar' | 'lists' | 'budget' | 'messages' | 'family' | 'rewards' | 'projects' | 'meals' | 'gray'> = {
  chore: 'chore',
  event: 'calendar',
  message: 'messages',
  reward: 'rewards',
  system: 'gray',
  list: 'lists',
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  useEffect(() => {
    loadNotifications()
  }, [])

  const loadNotifications = async () => {
    try {
      const res = await fetch('/api/notifications')
      const data = await res.json()
      if (res.ok && data.notifications) {
        setNotifications(data.notifications)
      }
    } catch (err) {
      console.error('Error loading notifications:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleMarkAsRead = useCallback(async (notificationId: string) => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId }),
      })
      if (!res.ok) throw new Error('Failed to mark as read')
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
      )
    } catch (err) {
      console.error('Error marking notification as read:', err)
    }
  }, [])

  const handleDelete = useCallback(async (notificationId: string) => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId }),
      })
      if (!res.ok) throw new Error('Failed to delete')
      setNotifications(prev => prev.filter(n => n.id !== notificationId))
    } catch (err) {
      console.error('Error deleting notification:', err)
    }
  }, [])

  const filteredNotifications = filter === 'unread'
    ? notifications.filter(n => !n.read)
    : notifications

  const unreadCount = notifications.filter(n => !n.read).length

  const getNotificationIcon = (type: string) => {
    const iconMap: Record<string, any> = { chore: 'chore', event: 'calendar', message: 'messages', reward: 'rewards', system: 'bell' }
    const key = iconMap[type] || 'bell'
    const icons: Record<string, any> = {
      chore: <span className="text-sm">✓</span>,
      calendar: <span className="text-sm">📅</span>,
      messages: <span className="text-sm">💬</span>,
      rewards: <span className="text-sm">🎁</span>,
      bell: <Bell className="w-4 h-4" />,
    }
    return icons[key] || <Bell className="w-4 h-4" />
  }

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="px-4 pt-2 pb-3">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-large-title text-label-primary">Notifications</h1>
            <p className="text-subhead text-label-secondary mt-0.5">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
            </p>
          </div>
          <Glyph color="family" size="md">
            <Bell className="w-4 h-4" />
          </Glyph>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 px-4 mb-4">
        {(['all', 'unread'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-4 py-1.5 rounded-full text-subhead font-medium transition-colors',
              filter === f
                ? 'bg-[var(--accent)] text-white'
                : 'bg-surface-fill text-label-secondary hover:bg-surface-fill-secondary'
            )}
          >
            {f === 'all' ? `All (${notifications.length})` : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>

      {/* Notification list */}
      <div className="px-4">
        {loading ? (
          <div className="text-center py-12">
            <div className="text-subhead text-label-secondary">Loading…</div>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            glyphColor="family"
            title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            description={filter === 'unread' ? "You're all caught up!" : "You'll see notifications here when things happen in your family."}
          />
        ) : (
          <InsetList>
            {filteredNotifications.map((notification) => (
              <div
                key={notification.id}
                onClick={() => !notification.read && handleMarkAsRead(notification.id)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 cursor-pointer',
                  !notification.read && 'border-l-4 border-l-chore bg-surface-fill',
                  notification.read && 'border-l-4 border-l-transparent'
                )}
              >
                <Glyph color={GLYPH_COLORS[notification.type] || 'gray'} size="sm">
                  {getNotificationIcon(notification.type)}
                </Glyph>
                <div className="flex-1 min-w-0">
                  <div className="text-body text-label-primary truncate">{notification.title}</div>
                  <div className="text-footnote text-label-secondary truncate">{notification.message}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3 text-label-tertiary" />
                    <span className="text-caption-1 text-label-tertiary">{formatDate(notification.created_at)}</span>
                  </div>
                </div>
                {!notification.read && (
                  <span className="w-2 h-2 rounded-full bg-chore shrink-0" />
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleDelete(notification.id) }}
                  className="p-1.5 rounded-full hover:bg-surface-fill-secondary shrink-0"
                  aria-label="Delete"
                >
                  <Trash2 className="w-4 h-4 text-label-tertiary" />
                </button>
              </div>
            ))}
          </InsetList>
        )}
      </div>
    </div>
  )
}