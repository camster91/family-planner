'use client'

import * as React from 'react'
import { History, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { syncNotice, syncState } from '@/lib/board-sync'
import { updatedAgo } from '@/lib/relative-time'

/**
 * "Updated just now / 3 min ago" (#271). Plain text, not a live region: it
 * changes every minute and would otherwise be announced on every tick. Pair
 * it with SyncAnnouncer for the polite announcement of real changes.
 */
export function UpdatedLine({
  lastSyncAt,
  now,
  className,
  testId = 'board-updated',
}: {
  lastSyncAt: number | null
  now: number
  className?: string
  testId?: string
}) {
  if (lastSyncAt === null) return null
  return (
    <p data-testid={testId} className={className}>
      {updatedAgo(lastSyncAt, now)}
    </p>
  )
}

/** Visually hidden polite live region; only changes when new data arrives. */
export function SyncAnnouncer({ message, testId }: { message: string; testId?: string }) {
  return (
    <p className="sr-only" aria-live="polite" data-testid={testId}>
      {message}
    </p>
  )
}

/**
 * Offline or stale notice, in words, or nothing while fresh. `role="status"`
 * announces it once when it appears; its wording changes only when the
 * minute count does.
 *
 * `appBanner`: the app-wide OfflineBanner is shown on this page (everywhere
 * but fridge mode), so offline the notice drops "You're offline" and only
 * says how old the data is (one offline message per page, OFFLINE_SYNC.md).
 */
export function SyncNotice({
  lastSyncAt,
  now,
  online,
  what,
  className,
  canGoStale = true,
  appBanner = false,
}: {
  lastSyncAt: number | null
  now: number
  online: boolean
  what: string
  className?: string
  /** False when there is no failed check to report (the calendar, or a board whose checks succeed): only offline is reported. */
  canGoStale?: boolean
  /** True where the app-wide offline banner is on screen (not fridge mode). */
  appBanner?: boolean
}) {
  const state = canGoStale ? syncState(lastSyncAt, now, online) : online ? 'fresh' : 'offline'
  const text = syncNotice(state, lastSyncAt, now, what, { bannerSaysOffline: appBanner })
  if (!text) return null
  // With the banner saying "offline", this is only about the data's age.
  const Icon = appBanner && state === 'offline' ? History : WifiOff
  return (
    <div
      role="status"
      data-testid="sync-notice"
      className={cn(
        'flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-4 py-3 text-[17px] text-label-primary',
        className
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-label-secondary" aria-hidden="true" />
      <span>{text}</span>
    </div>
  )
}

/** A clock that re-renders its caller every `tickMs` (relative times, idle). */
export function useNow(tickMs: number): number | null {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), tickMs)
    return () => window.clearInterval(timer)
  }, [tickMs])
  return now
}
