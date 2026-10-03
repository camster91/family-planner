'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, Check, Trash2, Clock, AlertCircle } from 'lucide-react'
import { Glyph } from '@/components/ui/glyph'
import { InsetList } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { MOTION } from '@/lib/brand-illustrations'
import { useToast, useUndoToast, UNDO_TOAST_MS } from '@/components/ui/toast'
import { OFFLINE_MESSAGE, responseErrorMessage } from '@/lib/fetch-error'
import { cn, formatDate } from '@/lib/utils'

const GLYPH_COLORS: Record<string, 'chore' | 'calendar' | 'lists' | 'budget' | 'messages' | 'family' | 'rewards' | 'projects' | 'meals' | 'gray'> = {
  chore: 'chore',
  event: 'calendar',
  message: 'messages',
  reward: 'rewards',
  system: 'gray',
  list: 'lists',
}

interface NotificationItem {
  id: string
  type: string
  title: string
  message?: string | null
  read: boolean
  created_at: string
}

/**
 * The server has no way to bring a deleted notification back, so Delete is
 * held back on this device while the Undo toast is up and only sent after it.
 * A little slack past the toast's own timer; leaving the page sends it at once.
 */
const DELETE_DELAY_MS = UNDO_TOAST_MS + 1000

function byNewest(a: NotificationItem, b: NotificationItem) {
  return b.created_at.localeCompare(a.created_at)
}

function sendDelete(notificationId: string, keepalive = false) {
  return fetch('/api/notifications', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notificationId }),
    keepalive,
  })
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const { addToast } = useToast()
  const showUndo = useUndoToast()
  // Deletes waiting out the Undo window: id -> timer and the row to restore.
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; item: NotificationItem }>())

  const failed = useCallback(
    async (title: string, res?: Response) => {
      addToast({ type: 'error', title, message: res ? await responseErrorMessage(res) : OFFLINE_MESSAGE })
    },
    [addToast]
  )

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' })
      if (!res.ok) {
        setLoadError(await responseErrorMessage(res))
        return
      }
      const data = await res.json()
      const hidden = pending.current
      setNotifications(((data.notifications ?? []) as NotificationItem[]).filter(n => !hidden.has(n.id)))
    } catch {
      setLoadError(OFFLINE_MESSAGE)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadNotifications()
  }, [loadNotifications])

  // Leaving the page: send any delete still waiting on its Undo window. That
  // covers in-app navigation (unmount) and also a reload, tab close or the app
  // going to the background (`pagehide` / hidden), where no unmount runs and
  // the timer would otherwise be lost. `keepalive` lets the request outlive
  // the page.
  useEffect(() => {
    const waiting = pending.current
    const flush = () => {
      waiting.forEach(({ timer }, id) => {
        clearTimeout(timer)
        sendDelete(id, true).catch(() => undefined)
      })
      waiting.clear()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [])

  const handleMarkAsRead = useCallback(
    async (notificationId: string) => {
      try {
        const res = await fetch('/api/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationId }),
        })
        if (!res.ok) {
          await failed("Couldn't mark it as read", res)
          return
        }
        setNotifications(prev => prev.map(n => (n.id === notificationId ? { ...n, read: true } : n)))
      } catch {
        await failed("Couldn't mark it as read")
      }
    },
    [failed]
  )

  const restore = useCallback((item: NotificationItem) => {
    setNotifications(prev => (prev.some(n => n.id === item.id) ? prev : [...prev, item].sort(byNewest)))
  }, [])

  const commitDelete = useCallback(
    async (item: NotificationItem) => {
      pending.current.delete(item.id)
      try {
        const res = await sendDelete(item.id)
        if (!res.ok) {
          restore(item)
          await failed("Couldn't delete the notification", res)
        }
      } catch {
        restore(item)
        await failed("Couldn't delete the notification")
      }
    },
    [failed, restore]
  )

  const handleDelete = useCallback(
    (item: NotificationItem) => {
      setNotifications(prev => prev.filter(n => n.id !== item.id))
      const timer = setTimeout(() => void commitDelete(item), DELETE_DELAY_MS)
      pending.current.set(item.id, { timer, item })
      showUndo({
        title: 'Notification deleted',
        onUndo: () => {
          const waiting = pending.current.get(item.id)
          if (!waiting) {
            addToast({ type: 'info', title: 'Already deleted', message: 'It was removed before Undo was pressed.' })
            return
          }
          clearTimeout(waiting.timer)
          pending.current.delete(item.id)
          restore(item)
        },
      })
    },
    [addToast, commitDelete, restore, showUndo]
  )

  const filteredNotifications = filter === 'unread' ? notifications.filter(n => !n.read) : notifications

  const unreadCount = notifications.filter(n => !n.read).length

  const getNotificationIcon = (type: string) => {
    const iconMap: Record<string, string> = { chore: 'chore', event: 'calendar', message: 'messages', reward: 'rewards', system: 'bell' }
    const key = iconMap[type] || 'bell'
    const icons: Record<string, React.ReactNode> = {
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
      {/* No decorative bell beside the title: where other pages put their "+"
          button it looked tappable and did nothing. */}
      <div className="px-4 pt-2 pb-3">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-large-title text-label-primary">Notifications</h1>
            <p className="text-subhead text-label-secondary mt-0.5">
              {loadError ? ' ' : unreadCount > 0 ? `${unreadCount} unread` : loading ? ' ' : 'All caught up'}
            </p>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 px-4 mb-4">
        {(['all', 'unread'] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn(
              'min-h-[44px] px-4 rounded-full text-subhead font-medium transition-colors',
              filter === f
                ? 'bg-[var(--accent-fill)] text-white'
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
        ) : loadError ? (
          <div role="alert" className="card-apple p-5 flex flex-col items-start gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-[var(--danger-text)]" aria-hidden="true" />
              <p className="text-headline text-label-primary">Couldn&apos;t load notifications</p>
            </div>
            <p className="text-subhead text-label-secondary">{loadError}</p>
            <button type="button" onClick={() => loadNotifications()} className="btn-tinted min-h-[44px]">
              Try again
            </button>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            glyphColor="family"
            motion={MOTION.moon}
            title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            description={filter === 'unread' ? "You're all caught up!" : "You'll see notifications here when things happen in your family."}
          />
        ) : (
          <InsetList>
            <ul>
              {filteredNotifications.map(notification => (
                <li
                  key={notification.id}
                  data-testid="notification-row"
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 border-l-4',
                    notification.read ? 'border-l-transparent' : 'border-l-chore bg-surface-fill'
                  )}
                >
                  <Glyph color={GLYPH_COLORS[notification.type] || 'gray'} size="sm">
                    {getNotificationIcon(notification.type)}
                  </Glyph>
                  <div className="flex-1 min-w-0">
                    <div className={cn('text-body text-label-primary truncate', !notification.read && 'font-semibold')}>
                      {!notification.read && <span className="sr-only">Unread: </span>}
                      {notification.title}
                    </div>
                    {notification.message && (
                      <div className="text-footnote text-label-secondary truncate">{notification.message}</div>
                    )}
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-label-tertiary" aria-hidden="true" />
                      <span className="text-caption-1 text-label-tertiary">{formatDate(notification.created_at)}</span>
                    </div>
                  </div>
                  {!notification.read && (
                    <button
                      type="button"
                      onClick={() => handleMarkAsRead(notification.id)}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full px-2 text-subhead font-medium text-[var(--accent-text)] hover:bg-surface-fill-secondary shrink-0"
                      aria-label={`Mark "${notification.title}" as read`}
                    >
                      <Check className="w-4 h-4" aria-hidden="true" />
                      <span className="hidden sm:inline">Mark read</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(notification)}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-surface-fill-secondary shrink-0"
                    aria-label={`Delete "${notification.title}"`}
                  >
                    <Trash2 className="w-4 h-4 text-label-tertiary" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </InsetList>
        )}
      </div>
    </div>
  )
}
