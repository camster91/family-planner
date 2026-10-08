'use client'

import * as React from 'react'
import { BOARD_POLL_MS, BoardVersionPoller } from '@/lib/board-sync'

/** navigator.onLine, kept current by the online/offline events. */
export function useOnline(): boolean {
  const [online, setOnline] = React.useState(true)
  React.useEffect(() => {
    setOnline(navigator.onLine)
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

export interface BoardSync {
  /** When the data on screen was last confirmed current (viewer's clock, ms). */
  lastSyncAt: number | null
  online: boolean
  /**
   * The last check failed (network, 429, 5xx). The "can't reach" notice needs
   * this as well as old data, so returning to a tab that was hidden (no checks
   * while hidden) does not flash it before the first check answers.
   */
  failing: boolean
  /** Polite screen-reader message; changes only when new data arrives. */
  announcement: string
}

/**
 * Keeps the board current (#271): checks the version about every
 * BOARD_POLL_MS while visible and online, at once when the tab becomes
 * visible or the connection returns, and re-fetches only on a change (plus
 * the slow full refresh in src/lib/board-sync.ts). Paused while hidden.
 */
export function useBoardSync({
  version,
  generatedAt,
  checkVersion,
  refresh,
  enabled = true,
  announcementMessage = 'The board has been updated.',
}: {
  version: string | undefined
  generatedAt: string
  checkVersion: () => Promise<string>
  refresh: () => void
  enabled?: boolean
  announcementMessage?: string
}): BoardSync {
  const online = useOnline()
  const [lastSyncAt, setLastSyncAt] = React.useState<number | null>(null)
  const [failing, setFailing] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState('')
  // Latest callbacks without re-arming the timers on every render.
  const checkRef = React.useRef(checkVersion)
  checkRef.current = checkVersion
  const refreshRef = React.useRef(refresh)
  refreshRef.current = refresh

  const pollerRef = React.useRef<BoardVersionPoller | null>(null)
  if (!pollerRef.current) {
    pollerRef.current = new BoardVersionPoller({
      fetchVersion: () => checkRef.current(),
      refresh: () => refreshRef.current(),
      now: () => Date.now(),
      isVisible: () => document.visibilityState === 'visible',
      isOnline: () => navigator.onLine,
      onChange: () => {
        setLastSyncAt(pollerRef.current?.lastSyncAt ?? null)
        setFailing((pollerRef.current?.failures ?? 0) > 0)
      },
    })
  }

  // New data (first render or a refresh): it is current as of now.
  const shownVersion = React.useRef<string | undefined | null>(null)
  React.useEffect(() => {
    pollerRef.current!.loaded(version)
    // Announce real changes only, not the first load or a no-change refresh.
    if (shownVersion.current !== null && version !== shownVersion.current) {
      setAnnouncement(announcementMessage)
    }
    shownVersion.current = version
  }, [version, generatedAt, announcementMessage])

  React.useEffect(() => {
    if (!enabled) return
    const poller = pollerRef.current!
    const tick = () => void poller.tick()
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    const timer = window.setInterval(tick, BOARD_POLL_MS)
    window.addEventListener('online', tick)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])

  return { lastSyncAt, online, failing, announcement }
}
