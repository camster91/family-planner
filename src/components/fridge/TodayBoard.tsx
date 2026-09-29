'use client'

import * as React from 'react'
import { useOnline } from '@/components/ui/use-online'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Maximize2, Minimize2 } from 'lucide-react'
import type { BoardDisplayData, TodayBoardData } from '@/app/dashboard/today/today-board-data'
import { COMING_UP_DAYS } from '@/app/dashboard/today/today-board-data'
import { DEFAULT_BOARD_DISPLAY } from '@/lib/ambient'
import {
  choresDueTodayByPerson,
  comingUp,
  dinnerOn,
  dinnerTitle,
  eventsLeftToday,
  formatLongDate,
  memberDisplayNames,
  formatTime,
  localDayKey,
  memberColors,
  nextEvent,
  weatherView,
  itemsToUseSoon,
} from './board-model'
import { AmbientCover, useIdleCover } from './ambient'
import { SyncAnnouncer, SyncNotice, UpdatedLine } from './sync-status'
import { useBoardSync } from './use-board-sync'
import {
  ChoresRegion,
  ComingUpRegion,
  DinnerRegion,
  GroceriesRegion,
  ScheduleRegion,
  areaClass,
  type BoardPerson,
} from './regions'
import { actionLinkClass } from './styles'
import { WeatherTile } from './weather-tile'
import { UseSoonRegion } from './use-soon-region'
import { useBoardTiles, type BoardActions } from './board-actions'
import { usePersonBoardActions } from './use-person-board-actions'

/**
 * Clock, relative "Updated" time and idle tick. Change polling and the slow
 * full refresh (#271) live in src/lib/board-sync.ts; there is no server job.
 */
const CLOCK_TICK_MS = 15 * 1000

/**
 * Board grid (#262). Portrait/phone widths stack; `lg` is the desktop/app
 * layout; `lg:landscape` in fridge mode is the 16:10 touch hub (1280x800 and
 * 1920x1200): four columns that fit the screen, each region scrolling inside
 * itself. `usesoon` rows exist only when the #263 slot is filled.
 */
const GRID_BASE = 'grid gap-5 2xl:gap-6'
const GRID_APP = [
  'md:grid-cols-2 md:[grid-template-areas:"today_dinner"_"chores_groceries"_"coming_coming"]',
  'lg:grid-cols-[6fr_5fr_5fr] lg:[grid-template-areas:"today_dinner_chores"_"today_groceries_chores"_"coming_coming_coming"]',
].join(' ')
const GRID_APP_WITH_SLOT = [
  'md:grid-cols-2 md:[grid-template-areas:"today_dinner"_"chores_groceries"_"usesoon_usesoon"_"coming_coming"]',
  'lg:grid-cols-[6fr_5fr_5fr] lg:[grid-template-areas:"today_dinner_chores"_"today_groceries_chores"_"today_usesoon_chores"_"coming_coming_coming"]',
].join(' ')
const GRID_FRIDGE =
  'lg:landscape:min-h-0 lg:landscape:flex-1 lg:landscape:grid-cols-[5fr_4fr_4fr_4fr] 2xl:landscape:grid-cols-[6fr_5fr_5fr_4fr] lg:landscape:grid-rows-[auto_minmax(0,1fr)] lg:landscape:[grid-template-areas:"today_dinner_chores_coming"_"today_groceries_chores_coming"] lg:landscape:[&>*]:min-h-0 lg:landscape:[&>*]:overflow-y-auto'
const GRID_FRIDGE_WITH_SLOT =
  'lg:landscape:min-h-0 lg:landscape:flex-1 lg:landscape:grid-cols-[5fr_4fr_4fr_4fr] 2xl:landscape:grid-cols-[6fr_5fr_5fr_4fr] lg:landscape:grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)] lg:landscape:[grid-template-areas:"today_dinner_chores_coming"_"today_groceries_chores_coming"_"today_usesoon_chores_coming"] lg:landscape:[&>*]:min-h-0 lg:landscape:[&>*]:overflow-y-auto'

/**
 * In the fridge hub the slot is a grid cell of fixed height; its tile fills it
 * and scrolls inside itself like the other regions, instead of overflowing.
 */
const USE_SOON_SLOT_FIT =
  'lg:landscape:flex lg:landscape:flex-col lg:landscape:[&>section]:min-h-0 lg:landscape:[&>section]:flex-1 lg:landscape:[&>section]:overflow-y-auto'

export function boardGridClass(fridgeMode: boolean, hasUseSoon: boolean): string {
  return [
    GRID_BASE,
    hasUseSoon ? GRID_APP_WITH_SLOT : GRID_APP,
    fridgeMode && (hasUseSoon ? GRID_FRIDGE_WITH_SLOT : GRID_FRIDGE),
  ]
    .filter(Boolean)
    .join(' ')
}

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

/** Person boards ask the signed-in version route (#271). */
async function fetchPersonBoardVersion(): Promise<string> {
  const res = await fetch('/api/family/board-version', {
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(`board version ${res.status}`)
  const body = (await res.json()) as { version?: unknown }
  if (typeof body.version !== 'string') throw new Error('board version missing')
  return body.version
}

/** Ask the browser to keep the screen on while the board is shown in fridge mode (best effort). */
function useWakeLock(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return
    type Sentinel = { release: () => Promise<void> }
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<Sentinel> }
    }
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

export default function TodayBoard({
  data,
  fridgeMode,
  onRefresh,
  checkVersion,
  actions,
  banner,
  useSoon,
  viewer,
  tileActions,
}: {
  data: TodayBoardData
  fridgeMode: boolean
  /**
   * The signed-in person (#274): their chores (any chore for a parent) and
   * the groceries become tappable, with Undo. Omitted: the board is read-only.
   */
  viewer?: { id: string; role: string } | null
  /** Replaces the person actions (the paired tablet's §9.2 writes, #274). */
  tileActions?: BoardActions
  /**
   * Shared tablet (/device/today, #241): re-fetch the device DTO instead of
   * re-requesting a person server component.
   */
  onRefresh?: () => void
  /**
   * Resolves the server's current board version (#271). Defaults to the
   * signed-in route; the shared tablet passes GET /api/device/today/version.
   */
  checkVersion?: () => Promise<string>
  /** Replaces the fridge-mode toggle in the header (the tablet has no person pages to return to). */
  actions?: React.ReactNode
  /** Shown above the header, inside the board (the tablet's parent-mode banner). */
  banner?: React.ReactNode
  /**
   * Overrides the "Use soon" slot (`usesoon` grid area: under Groceries in the
   * fridge landscape hub, a full-width row elsewhere). By default the board
   * fills it from `data.useSoon` (#263) with UseSoonRegion, and leaves it out
   * entirely when there is nothing to use soon or inventory is off.
   */
  useSoon?: React.ReactNode
}) {
  // "Today" is the viewer's local day, which the server cannot know, so the
  // board renders after mount (a brief skeleton) instead of risking a
  // hydration mismatch or a wrong-day render on a server in another zone.
  const [now, setNow] = React.useState<Date | null>(null)
  const router = useRouter()
  // Visible sync (#271): version polling, re-fetch on change, words for
  // "Updated …", offline and stale. Times are on the viewer's own clock.
  const refresh = React.useCallback(() => (onRefresh ? onRefresh() : router.refresh()), [onRefresh, router])
  const { lastSyncAt, online, failing, announcement } = useBoardSync({
    version: data.version,
    generatedAt: data.generatedAt,
    checkVersion: checkVersion ?? fetchPersonBoardVersion,
    refresh,
  })
  // Tiles act directly (#274): optimistic chore/grocery state, Undo toasts, rollback.
  const personActions = usePersonBoardActions(tileActions ? null : viewer, refresh)
  const tiles = useBoardTiles(data.chores, data.shopping, tileActions ?? personActions)
  useWakeLock(fridgeMode)

  // Calm display and night hours (#271): fridge mode only.
  const display: BoardDisplayData = data.display ?? DEFAULT_BOARD_DISPLAY
  const {
    state: ambient,
    covered,
    wake,
  } = useIdleCover({
    enabled: fridgeMode,
    now: now ? now.getTime() : null,
    display,
  })
  const boardRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    // Covered: the board leaves the focus order and the accessibility tree
    // (React 18 has no `inert` prop).
    boardRef.current?.toggleAttribute('inert', covered)
  }, [covered])

  React.useEffect(() => {
    setNow(new Date())
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  const view = React.useMemo(() => {
    if (!now) return null
    const today = localDayKey(now)
    // Member colours (#262), resolved once so every region agrees.
    const colors = memberColors(data.members)
    const names = memberDisplayNames(data.members)
    const withColors = data.members.map((m) => ({
      ...m,
      color: colors.get(m.id),
    }))
    const people = new Map<string, BoardPerson>(
      data.members.map((m) => [m.id, { name: names.get(m.id) ?? m.name, color: colors.get(m.id)! }])
    )
    return {
      today: eventsLeftToday(data.events, now),
      dinner: dinnerOn(data.dinners, today),
      chores: choresDueTodayByPerson(tiles.chores, withColors, now),
      comingUp: comingUp(data.events, data.dinners, now, COMING_UP_DAYS),
      people,
      weather: weatherView(data.weather, now),
      useSoon: itemsToUseSoon(data.useSoon, now),
      next: nextEvent(data.events, now),
    }
  }, [data, now, tiles.chores])

  // "Use soon" tile (#263): only when there is something to use (null otherwise).
  const useSoonSlot =
    useSoon ??
    (view && view.useSoon.length > 0 ? (
      <UseSoonRegion items={view.useSoon} inventoryHref={data.links.inventory ?? null} />
    ) : null)

  return (
    <>
      <div
        ref={boardRef}
        data-testid="today-board"
        data-mode={fridgeMode ? 'fridge' : 'app'}
        className={
          fridgeMode
            ? // On a landscape fridge tablet the board fits the viewport: the grid
              // takes the height left under the header and each region scrolls
              // inside itself instead of pushing content below the fold.
              'min-h-screen bg-[var(--surface-grouped)] px-4 py-5 sm:px-6 lg:px-8 lg:py-6 2xl:px-10 2xl:py-8 lg:landscape:flex lg:landscape:h-dvh lg:landscape:min-h-0 lg:landscape:flex-col lg:landscape:overflow-hidden'
            : 'bg-[var(--surface-grouped)]'
        }
      >
        {fridgeMode && <style>{FRIDGE_CHROME_CSS}</style>}
        {banner}

        <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 lg:mb-6 2xl:mb-8">
          <div className="min-w-0">
            <p className="text-[17px] font-semibold uppercase tracking-wide text-label-secondary md:text-[19px] 2xl:text-[22px]">
              Today
            </p>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <h1
                data-testid="board-date"
                className="font-display text-[34px] font-bold leading-tight text-label-primary md:text-[44px] lg:text-[48px] 2xl:text-[60px]"
              >
                {now ? formatLongDate(now) : 'Today'}
              </h1>
              {now && (
                <p
                  data-testid="board-clock"
                  className="text-[28px] font-semibold tabular-nums text-label-secondary md:text-[36px] lg:text-[40px] 2xl:text-[52px]"
                >
                  <span className="sr-only">Time: </span>
                  {formatTime(now)}
                </p>
              )}
            </div>
          </div>

          {/* Right cluster: weather (#262, only when the household opted in and a
            forecast is available) above the refresh time and the mode action. */}
          <div className="flex w-full min-w-0 flex-col items-start gap-3 sm:w-auto sm:items-end">
            {view?.weather && (
              <div className="w-full min-w-0 sm:w-auto">
                <WeatherTile view={view.weather} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              {now && (
                <UpdatedLine
                  lastSyncAt={lastSyncAt}
                  now={now.getTime()}
                  className="text-[15px] text-label-secondary md:text-[17px] 2xl:text-[19px]"
                />
              )}
              {actions ? (
                actions
              ) : fridgeMode ? (
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
          </div>
        </header>

        {now && (
          <SyncNotice
            lastSyncAt={lastSyncAt}
            now={now.getTime()}
            online={online}
            canGoStale={failing}
            what="board"
            className="mb-5"
          />
        )}
        <SyncAnnouncer message={announcement} testId="board-sync-announce" />

        {view ? (
          <div data-testid="board-grid" className={boardGridClass(fridgeMode, Boolean(useSoonSlot))}>
            <ScheduleRegion events={view.today} calendarHref={data.links.calendar} people={view.people} />
            <DinnerRegion
              dinner={view.dinner}
              mealsEnabled={data.dinners !== null}
              mealsHref={data.links.meals}
              featuresHref={data.links.features}
            />
            <ChoresRegion
              people={view.chores}
              choresHref={data.links.chores}
              onTick={tiles.tickChore}
              canTick={tiles.canTickChore}
            />
            <GroceriesRegion shopping={tiles.shopping} listsHref={data.links.lists} onTick={tiles.tickGrocery} />
            <ComingUpRegion days={view.comingUp} mealsEnabled={data.dinners !== null} stackInLandscape={fridgeMode} />
            {useSoonSlot && (
              <div data-testid="board-slot-use-soon" className={`min-w-0 ${areaClass.usesoon} ${USE_SOON_SLOT_FIT}`}>
                {useSoonSlot}
              </div>
            )}
          </div>
        ) : (
          <BoardSkeleton />
        )}
      </div>
      {covered && now && (
        <AmbientCover
          state={ambient}
          now={now}
          weather={view?.weather ?? null}
          next={view?.next ?? null}
          dinner={dinnerTitle(view?.dinner ?? null)}
          photos={display.photos ?? []}
          onWake={wake}
        />
      )}
    </>
  )
}
