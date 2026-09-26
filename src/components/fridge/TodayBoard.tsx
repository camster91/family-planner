'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Maximize2, Minimize2, WifiOff } from 'lucide-react'
import type { TodayBoardData } from '@/app/dashboard/today/today-board-data'
import { COMING_UP_DAYS } from '@/app/dashboard/today/today-board-data'
import {
  choresDueTodayByPerson,
  comingUp,
  dinnerOn,
  eventsLeftToday,
  formatLongDate,
  formatTime,
  localDayKey,
} from './board-model'
import { ChoresRegion, ComingUpRegion, DinnerRegion, GroceriesRegion, ScheduleRegion } from './regions'
import { actionLinkClass } from './styles'

/** Client refresh interval for an always-on board. Not a server job. */
export const BOARD_REFRESH_MS = 5 * 60 * 1000
/** After this long without fresh data the board says when it last updated. */
const STALE_AFTER_MS = 15 * 60 * 1000
const CLOCK_TICK_MS = 15 * 1000

/**
 * Hides the app chrome for a mounted tablet. Rendered only in fridge mode, so
 * leaving the mode (a normal navigation) removes it. The nav is removed from
 * the accessibility tree and focus order too, not just covered.
 */
const FRIDGE_CHROME_CSS = `
nav[aria-label="Main navigation"], .tab-bar { display: none !important; }
#main-content { padding-top: 0 !important; padding-bottom: 0 !important; }
#main-content > div { max-width: none !important; padding: 0 !important; }
`

function useOnline(): boolean {
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

/**
 * Keeps the board current: re-requests the server component every
 * BOARD_REFRESH_MS while visible and online, when the connection returns, and
 * when the tab becomes visible again with data older than the interval.
 */
function useAutoRefresh(receivedAtRef: React.MutableRefObject<number>) {
  const router = useRouter()

  React.useEffect(() => {
    const refresh = () => {
      if (navigator.onLine) router.refresh()
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const age = Date.now() - receivedAtRef.current
      if (age >= BOARD_REFRESH_MS) refresh()
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, BOARD_REFRESH_MS)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [router, receivedAtRef])
}

/** Ask the browser to keep the screen on while the board is shown in fridge mode (best effort). */
function useWakeLock(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return
    type Sentinel = { release: () => Promise<void> }
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } }
    if (!nav.wakeLock) return
    let sentinel: Sentinel | null = null
    let cancelled = false
    const acquire = async () => {
      try {
        if (document.visibilityState !== 'visible') return
        const s = await nav.wakeLock!.request('screen')
        if (cancelled) void s.release()
        else sentinel = s
      } catch {
        // Denied or unsupported (battery saver, WebView policy). The board still works.
      }
    }
    void acquire()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (sentinel) void sentinel.release().catch(() => {})
    }
  }, [enabled])
}

function BoardSkeleton() {
  return (
    <div aria-busy="true" className="space-y-5">
      <p className="sr-only" role="status">
        Loading today&apos;s board
      </p>
      <div className="h-14 w-72 max-w-full rounded-[var(--radius-md)] bg-[var(--surface-fill)]" />
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 rounded-[var(--radius-xl)] bg-[var(--surface-fill)]" />
        ))}
      </div>
    </div>
  )
}

export default function TodayBoard({ data, fridgeMode }: { data: TodayBoardData; fridgeMode: boolean }) {
  // "Today" is the viewer's local day, which the server cannot know, so the
  // board renders after mount (a brief skeleton) instead of risking a
  // hydration mismatch or a wrong-day render on a server in another zone.
  const [now, setNow] = React.useState<Date | null>(null)
  // When this snapshot arrived, on the viewer's own clock (immune to server/device clock skew).
  const [receivedAt, setReceivedAt] = React.useState<Date | null>(null)
  const receivedAtRef = React.useRef(0)
  const online = useOnline()
  useAutoRefresh(receivedAtRef)
  useWakeLock(fridgeMode)

  React.useEffect(() => {
    const at = new Date()
    receivedAtRef.current = at.getTime()
    setReceivedAt(at)
  }, [data.generatedAt])

  React.useEffect(() => {
    setNow(new Date())
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  const view = React.useMemo(() => {
    if (!now) return null
    const today = localDayKey(now)
    return {
      today: eventsLeftToday(data.events, now),
      dinner: dinnerOn(data.dinners, today),
      chores: choresDueTodayByPerson(data.chores, data.members, now),
      comingUp: comingUp(data.events, data.dinners, now, COMING_UP_DAYS),
    }
  }, [data, now])

  const stale = now && receivedAt ? now.getTime() - receivedAt.getTime() > STALE_AFTER_MS : false

  return (
    <div
      data-testid="today-board"
      data-mode={fridgeMode ? 'fridge' : 'app'}
      className={
        fridgeMode
          ? // On a landscape fridge tablet the board fits the viewport: the grid
            // takes the height left under the header and each region scrolls
            // inside itself instead of pushing content below the fold.
            'min-h-screen bg-[var(--surface-grouped)] px-4 py-5 sm:px-6 lg:px-8 lg:py-6 lg:landscape:flex lg:landscape:h-dvh lg:landscape:min-h-0 lg:landscape:flex-col lg:landscape:overflow-hidden'
          : 'bg-[var(--surface-grouped)]'
      }
    >
      {fridgeMode && <style>{FRIDGE_CHROME_CSS}</style>}

      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 lg:mb-6">
        <div className="min-w-0">
          <p className="text-[17px] font-semibold uppercase tracking-wide text-label-secondary md:text-[19px]">
            Today
          </p>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <h1
              data-testid="board-date"
              className="font-display text-[34px] font-bold leading-tight text-label-primary md:text-[44px] lg:text-[48px]"
            >
              {now ? formatLongDate(now) : 'Today'}
            </h1>
            {now && (
              <p
                data-testid="board-clock"
                className="text-[28px] font-semibold tabular-nums text-label-secondary md:text-[36px] lg:text-[40px]"
              >
                <span className="sr-only">Time: </span>
                {formatTime(now)}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {receivedAt && (
            <p data-testid="board-updated" className="text-[15px] text-label-secondary md:text-[17px]">
              Updated {formatTime(receivedAt)}
            </p>
          )}
          {fridgeMode ? (
            <Link href="/dashboard/today" className={actionLinkClass}>
              <Minimize2 className="h-5 w-5" aria-hidden="true" />
              Exit fridge mode
            </Link>
          ) : (
            <Link href="/dashboard/today?mode=fridge" className={actionLinkClass}>
              <Maximize2 className="h-5 w-5" aria-hidden="true" />
              Fridge mode
            </Link>
          )}
        </div>
      </header>

      {receivedAt && (!online || stale) && (
        <div
          role="status"
          className="mb-5 flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-4 py-3 text-[17px] text-label-primary"
        >
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-label-secondary" aria-hidden="true" />
          <span>
            {online
              ? `Showing what was here at ${formatTime(receivedAt)}. The board will refresh on its own.`
              : `You're offline. Showing what was here at ${formatTime(receivedAt)}. The board refreshes when the connection returns.`}
          </span>
        </div>
      )}

      {view ? (
        <div
          className={[
            'grid gap-5',
            'md:grid-cols-2 md:[grid-template-areas:"today_dinner"_"chores_groceries"_"coming_coming"]',
            'lg:grid-cols-[6fr_5fr_5fr] lg:[grid-template-areas:"today_dinner_chores"_"today_groceries_chores"_"coming_coming_coming"]',
            fridgeMode &&
              'lg:landscape:min-h-0 lg:landscape:flex-1 lg:landscape:grid-cols-[5fr_4fr_4fr_4fr] lg:landscape:grid-rows-[auto_minmax(0,1fr)] lg:landscape:[grid-template-areas:"today_dinner_chores_coming"_"today_groceries_chores_coming"] lg:landscape:[&>section]:min-h-0 lg:landscape:[&>section]:overflow-y-auto',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <ScheduleRegion events={view.today} calendarHref={data.links.calendar} />
          <DinnerRegion
            dinner={view.dinner}
            mealsEnabled={data.dinners !== null}
            mealsHref={data.links.meals}
            featuresHref={data.links.features}
          />
          <ChoresRegion people={view.chores} choresHref={data.links.chores} />
          <GroceriesRegion shopping={data.shopping} listsHref={data.links.lists} />
          <ComingUpRegion days={view.comingUp} mealsEnabled={data.dinners !== null} stackInLandscape={fridgeMode} />
        </div>
      ) : (
        <BoardSkeleton />
      )}
    </div>
  )
}
