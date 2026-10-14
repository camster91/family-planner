'use client'

import * as React from 'react'
import { useOnline } from '@/components/ui/use-online'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import { useTodayBoardText } from '@/i18n/today-board'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Maximize2, Minimize2 } from 'lucide-react'
import type { BoardDisplayData, BoardPhoto, TodayBoardData } from '@/app/dashboard/today/today-board-data'
import { COMING_UP_DAYS } from '@/lib/board-constants'
import { DEFAULT_BOARD_DISPLAY, type AmbientState } from '@/lib/ambient'
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
  type NextEventView,
  type UseSoonEntry,
  type WeatherView,
} from './board-model'
import { useIdleCover } from './use-idle-cover'
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
import { actionLinkClass, regionClass } from './styles'
import TodayControls from './TodayControls'
import { useBoardTiles, type BoardActions } from './board-actions'
import { usePersonBoardActions } from './use-person-board-actions'

/** Keep optional inventory presentation out of the initial Today bundle. */
function createUseSoonRegion() {
  return React.lazy(async () => {
    const module = await import('./use-soon-region')
    return { default: module.UseSoonRegion }
  })
}

/* The loader stays behind the conditional slot; this identity is replaced on retry. */
const LazyUseSoonRegion = createUseSoonRegion()

/**
 * Clock, relative "Updated" time and idle tick. Change polling and the slow
 * full refresh (#271) live in src/lib/board-sync.ts; there is no server job.
 */
const CLOCK_TICK_MS = 15 * 1000

/**
 * Board grid (#262). Phones stack; portrait tablets lead with a full-width
 * schedule above paired supporting regions. `lg` is the desktop/app
 * layout; `lg:landscape` in fridge mode is the 16:10 touch hub (1280x800 and
 * 1920x1200): four columns that fit the screen, each region scrolling inside
 * itself. `usesoon` rows exist only when the #263 slot is filled.
 */
const GRID_BASE = 'grid gap-3 md:gap-4 2xl:gap-6'
const GRID_APP = [
  'md:grid-cols-2 md:[grid-template-areas:"today_today"_"dinner_groceries"_"chores_chores"_"coming_coming"]',
  'lg:grid-cols-3 lg:[grid-template-areas:"today_dinner_groceries"_"chores_coming_coming"]',
].join(' ')
const GRID_APP_WITH_SLOT = [
  'md:grid-cols-2 md:[grid-template-areas:"today_today"_"dinner_groceries"_"chores_chores"_"usesoon_usesoon"_"coming_coming"]',
  'lg:grid-cols-3 lg:[grid-template-areas:"today_dinner_groceries"_"chores_coming_coming"_"usesoon_usesoon_usesoon"]',
].join(' ')
const GRID_APP_WITHOUT_CHORES = [
  'md:grid-cols-2 md:[grid-template-areas:"today_today"_"dinner_groceries"_"coming_coming"]',
  'lg:grid-cols-3 lg:[grid-template-areas:"today_dinner_groceries"_"coming_coming_coming"]',
].join(' ')
const GRID_APP_WITH_SLOT_WITHOUT_CHORES = [
  'md:grid-cols-2 md:[grid-template-areas:"today_today"_"dinner_groceries"_"usesoon_usesoon"_"coming_coming"]',
  'lg:grid-cols-3 lg:[grid-template-areas:"today_dinner_groceries"_"coming_coming_coming"_"usesoon_usesoon_usesoon"]',
].join(' ')
const GRID_FRIDGE =
  'lg:landscape:min-h-0 lg:landscape:flex-1 lg:landscape:grid-cols-[5fr_4fr_4fr_4fr] 2xl:landscape:grid-cols-[6fr_5fr_5fr_4fr] lg:landscape:grid-rows-[minmax(0,2fr)_minmax(0,3fr)] lg:landscape:[grid-template-areas:"today_dinner_chores_coming"_"today_groceries_chores_coming"] lg:landscape:[&>*]:min-h-0 lg:landscape:[&>*:not([data-testid=region-groceries]):not([data-testid=board-slot-use-soon])]:overflow-y-auto'
const GRID_FRIDGE_WITH_SLOT =
  'lg:landscape:min-h-0 lg:landscape:flex-1 lg:landscape:grid-cols-[5fr_4fr_4fr_4fr] 2xl:landscape:grid-cols-[6fr_5fr_5fr_4fr] lg:landscape:grid-rows-[minmax(0,4fr)_minmax(0,2fr)_minmax(0,4fr)] lg:landscape:[grid-template-areas:"today_dinner_chores_coming"_"today_groceries_chores_coming"_"today_groceries_usesoon_coming"] lg:landscape:[&>*]:min-h-0 lg:landscape:[&>*:not([data-testid=region-groceries]):not([data-testid=board-slot-use-soon])]:overflow-y-auto'

/**
 * In the fridge hub the slot is a grid cell of fixed height; its tile fills it
 * and scrolls inside itself like the other regions, instead of overflowing.
 */
const USE_SOON_SLOT_FIT =
  'lg:landscape:min-h-0 lg:landscape:flex lg:landscape:flex-col lg:landscape:overflow-hidden lg:landscape:[&>section]:min-h-0 lg:landscape:[&>section]:flex-1 lg:landscape:[&>section]:overflow-y-auto'

export function boardGridClass(fridgeMode: boolean, hasUseSoon: boolean, hasChores = true): string {
  return [
    GRID_BASE,
    fridgeMode || hasChores
      ? (hasUseSoon ? GRID_APP_WITH_SLOT : GRID_APP)
      : (hasUseSoon ? GRID_APP_WITH_SLOT_WITHOUT_CHORES : GRID_APP_WITHOUT_CHORES),
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
[data-dashboard-navigation], .tab-bar { display: none !important; }
[data-offline-banner] { display: none !important; }
#main-content { padding-top: 0 !important; padding-bottom: 0 !important; }
#main-content > div { max-width: none !important; padding: 0 !important; }
`

/** Person boards ask the signed-in version route (#271). */
async function fetchPersonBoardVersion(memberProtocol?: TodayBoardData['memberProtocol']): Promise<string> {
  const res = await fetch('/api/family/board-version', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: memberProtocol === 2 ? { 'X-Member-Protocol': '2' } : undefined,
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
  const text = useTodayBoardText()
  return (
    <div aria-busy="true" className="space-y-5">
      <p className="sr-only" role="status">
        {text('todayBoardLoading')}
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

type LazyChunkBoundaryProps = {
  children: React.ReactNode
  fallback: React.ReactNode
}

type LazyChunkBoundaryState = { failed: boolean }

/** Turns a failed optional chunk into a local retry instead of taking down the board. */
export class LazyChunkBoundary extends React.Component<LazyChunkBoundaryProps, LazyChunkBoundaryState> {
  state: LazyChunkBoundaryState = { failed: false }

  static getDerivedStateFromError(): LazyChunkBoundaryState {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** The optional inventory tile keeps its reserved slot while its chunk loads. */
export function UseSoonRegionFallback({
  status,
  onRetry,
}: {
  status: 'loading' | 'error'
  onRetry?: () => void
}) {
  const text = useTodayBoardText()
  return (
    <section
      aria-busy={status === 'loading' ? 'true' : undefined}
      aria-label={status === 'loading' ? text('lazyUseSoonLoading') : text('lazyUseSoonError')}
      data-testid="use-soon-fallback"
      className={regionClass}
    >
      <p role={status === 'error' ? 'alert' : 'status'} className="text-[16px] leading-relaxed text-label-secondary">
        {status === 'loading' ? text('lazyUseSoonLoading') : text('lazyUseSoonError')}
      </p>
      {status === 'error' && onRetry && (
        <button type="button" className="btn-secondary mt-4 min-h-11 min-w-[44px]" onClick={onRetry}>
          {text('retry')}
        </button>
      )}
      {status === 'loading' && (
        <div aria-hidden="true" className="mt-4 space-y-3">
          <div className="h-7 w-32 rounded-[var(--radius-md)] bg-[var(--surface-fill)]" />
          <div className="h-12 rounded-[var(--radius-md)] bg-[var(--surface-fill)]" />
        </div>
      )}
    </section>
  )
}

function UseSoonRegionLoaded({ onLoaded, children }: { onLoaded: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    onLoaded()
  }, [onLoaded])
  return children
}

function LazyUseSoon({
  items,
  inventoryHref,
  onLoaded,
}: {
  items: UseSoonEntry[]
  inventoryHref: string | null
  onLoaded: () => void
}) {
  const [attempt, setAttempt] = React.useState(0)
  const [UseSoonRegion, setUseSoonRegion] = React.useState(LazyUseSoonRegion)
  const restoreFocus = React.useRef(false)
  const loaded = React.useCallback(() => {
    if (!restoreFocus.current) return
    restoreFocus.current = false
    onLoaded()
  }, [onLoaded])
  const retry = React.useCallback(() => {
    restoreFocus.current = document.activeElement instanceof HTMLElement
      && document.activeElement.tagName.toLowerCase() === 'button'
    setUseSoonRegion(createUseSoonRegion())
    setAttempt((value) => value + 1)
  }, [])

  return (
    <LazyChunkBoundary
      key={attempt}
      fallback={<UseSoonRegionFallback status="error" onRetry={retry} />}
    >
      <React.Suspense fallback={<UseSoonRegionFallback status="loading" />}>
        <UseSoonRegionLoaded onLoaded={loaded}>
          <UseSoonRegion items={items} inventoryHref={inventoryHref} />
        </UseSoonRegionLoaded>
      </React.Suspense>
    </LazyChunkBoundary>
  )
}

type AmbientCoverFallbackProps = {
  state: AmbientState
  status: 'loading' | 'error'
  onWake: () => void
  onRetry?: () => void
}

/** The cover remains an accessible, inert-board surface while its optional chunk loads. */
export function AmbientCoverFallback({ state, status, onWake, onRetry }: AmbientCoverFallbackProps) {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const retryButtonRef = React.useRef<HTMLButtonElement>(null)
  const text = useTodayBoardText()

  React.useEffect(() => {
    const focusTarget = status === 'error' ? retryButtonRef.current : buttonRef.current
    focusTarget?.focus({ preventScroll: true })
  }, [status])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={state.ambient ? text('calmDisplay') : text('nightDimming')}
      aria-busy={status === 'loading' ? 'true' : undefined}
      data-testid="ambient-cover"
      data-ambient={state.ambient ? 'true' : 'false'}
      data-dim={state.dim ? 'true' : 'false'}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onWake()
      }}
      className="fixed inset-0 z-[80] flex cursor-pointer select-none items-end justify-end bg-[#0d1117]/95 p-8 text-white"
    >
      <div
        data-ambient-cover-controls="true"
        className="relative z-10 flex flex-col items-end gap-3 text-right"
      >
        <p role={status === 'error' ? 'alert' : 'status'}>
          {status === 'loading' ? text('lazyAmbientLoading') : text('lazyAmbientError')}
        </p>
        {status === 'error' && onRetry && (
          <button
            ref={retryButtonRef}
            type="button"
            className="btn-secondary min-h-11 min-w-[44px] bg-white/15 text-white border-white/50 hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onRetry()
            }}
          >
            {text('retry')}
          </button>
        )}
        <button ref={buttonRef} type="button" className="btn-primary min-h-11 min-w-[44px]">
          {text('showBoard')}
        </button>
      </div>
    </div>
  )
}

function WeatherTileFallback({ status, onRetry }: { status: 'loading' | 'error'; onRetry?: () => void }) {
  const text = useTodayBoardText()
  return (
    <section
      aria-busy={status === 'loading' ? 'true' : undefined}
      aria-label={text('weather')}
      className="flex min-h-11 min-w-0 items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-3 py-2"
    >
      <p role={status === 'error' ? 'alert' : 'status'}>
        {status === 'loading' ? text('lazyWeatherLoading') : text('lazyWeatherError')}
      </p>
      {status === 'error' && onRetry && (
        <button type="button" className="btn-secondary min-h-11 min-w-[44px]" onClick={onRetry}>
          {text('retry')}
        </button>
      )}
    </section>
  )
}

function WeatherTileLoaded({ onLoaded, children }: { onLoaded: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    onLoaded()
  }, [onLoaded])
  return children
}

function createWeatherTile() {
  return React.lazy(async () => {
    const weatherTileModule = await import('./weather-tile')
    return { default: weatherTileModule.WeatherTile }
  })
}

function LazyWeatherTile({ view }: { view: WeatherView }) {
  const [attempt, setAttempt] = React.useState(0)
  const [WeatherTile, setWeatherTile] = React.useState(createWeatherTile)
  const restoreFocus = React.useRef(false)
  const weatherRegionRef = React.useRef<HTMLDivElement>(null)
  const onLoaded = React.useCallback(() => {
    if (!restoreFocus.current) return
    restoreFocus.current = false
    weatherRegionRef.current?.focus({ preventScroll: true })
  }, [])
  const retry = React.useCallback(() => {
    restoreFocus.current = document.activeElement instanceof HTMLElement
      && document.activeElement.tagName.toLowerCase() === 'button'
    setWeatherTile(createWeatherTile())
    setAttempt((value) => value + 1)
  }, [])

  return (
    <div ref={weatherRegionRef} tabIndex={-1} className="min-w-0">
      <LazyChunkBoundary
        key={attempt}
        fallback={<WeatherTileFallback status="error" onRetry={retry} />}
      >
        <React.Suspense fallback={<WeatherTileFallback status="loading" />}>
          <WeatherTileLoaded onLoaded={onLoaded}>
            <WeatherTile view={view} />
          </WeatherTileLoaded>
        </React.Suspense>
      </LazyChunkBoundary>
    </div>
  )
}

function createAmbientCover() {
  return React.lazy(() => import('./ambient-cover'))
}

function LazyAmbientCover(props: {
  state: AmbientState
  now: Date
  weather: WeatherView | null
  next: NextEventView | null
  dinner: string | null
  photos: BoardPhoto[]
  onWake: () => void
}) {
  const [attempt, setAttempt] = React.useState(0)
  const [AmbientCover, setAmbientCover] = React.useState(createAmbientCover)
  const retry = React.useCallback(() => {
    setAmbientCover(createAmbientCover())
    setAttempt((value) => value + 1)
  }, [])

  return (
    <LazyChunkBoundary
      key={attempt}
      fallback={<AmbientCoverFallback state={props.state} status="error" onWake={props.onWake} onRetry={retry} />}
    >
      <React.Suspense
        fallback={<AmbientCoverFallback state={props.state} status="loading" onWake={props.onWake} />}
      >
        <AmbientCover {...props} />
      </React.Suspense>
    </LazyChunkBoundary>
  )
}

export default function TodayBoard({
  data,
  cachedSnapshot = false,
  fridgeMode,
  onRefresh,
  checkVersion,
  actions,
  banner,
  useSoon,
  viewer,
  tileActions,
  groceryAction,
  choresShownElsewhere,
}: {
  data: TodayBoardData
  /** Exact chore IDs rendered by the personal home summary. Ignored in fridge mode. */
  choresShownElsewhere?: readonly string[]
  /** Persisted device snapshot: display its server generation age, not mount time. */
  cachedSnapshot?: boolean
  fridgeMode: boolean
  /**
   * The signed-in person (#274): their chores (any chore for a parent) and
   * the groceries become tappable, with Undo. Omitted: the board is read-only.
   */
  viewer?: { id: string; role: string } | null
  /** Replaces the person actions (the paired tablet's §9.2 writes, #274). */
  tileActions?: BoardActions
  /** Device grocery capture control; omitted on person and read-only boards. */
  groceryAction?: React.ReactNode
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
  // Date and time labels follow the viewer's locale (display only).
  const displayLocale = useDisplayLocale()
  const text = useTodayBoardText()
  const router = useRouter()
  // Visible sync (#271): version polling, re-fetch on change, words for
  // "Updated …", offline and stale. Times are on the viewer's own clock.
  const refresh = React.useCallback(() => (onRefresh ? onRefresh() : router.refresh()), [onRefresh, router])
  const { lastSyncAt, online, failing, announcement } = useBoardSync({
    version: data.version,
    generatedAt: data.generatedAt,
    checkVersion: checkVersion ?? (() => fetchPersonBoardVersion(data.memberProtocol)),
    refresh,
  })
  const snapshotTime = Date.parse(data.generatedAt)
  const shownSyncAt = cachedSnapshot ? (Number.isFinite(snapshotTime) ? snapshotTime : null) : lastSyncAt
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
      chores: choresDueTodayByPerson(
        !fridgeMode && choresShownElsewhere?.length
          ? tiles.chores.filter((chore) => !choresShownElsewhere.includes(chore.id))
          : tiles.chores,
        withColors,
        now
      ),
      comingUp: comingUp(data.events, data.dinners, now, COMING_UP_DAYS, displayLocale),
      people,
      weather: weatherView(data.weather, now),
      useSoon: itemsToUseSoon(data.useSoon, now),
      next: nextEvent(data.events, now, displayLocale),
    }
  }, [data, now, tiles.chores, displayLocale, fridgeMode, choresShownElsewhere])

  const showChores = fridgeMode || !choresShownElsewhere?.length || Boolean(view?.chores.length)
  const useSoonSlotRef = React.useRef<HTMLDivElement>(null)
  const onUseSoonLoaded = React.useCallback(() => {
    useSoonSlotRef.current
      ?.querySelector<HTMLElement>('[data-testid="region-usesoon"]')
      ?.focus({ preventScroll: true })
  }, [])

  // "Use soon" tile (#263): only when there is something to use (null otherwise).
  const useSoonSlot =
    useSoon ??
    (view && view.useSoon.length > 0 ? (
      <LazyUseSoon
        items={view.useSoon}
        inventoryHref={data.links.inventory ?? null}
        onLoaded={onUseSoonLoaded}
      />
    ) : null)

  // A legacy reader must never show an account-only partial board when a
  // profile subject is present. The server marker is deliberately rendered as
  // a local, translated recovery surface; its opaque code never reaches UI.
  if (data.protocolError) {
    return (
      <main
        data-testid="today-board-compatibility"
        data-mode={fridgeMode ? 'fridge' : 'app'}
        className="flex min-h-screen items-center justify-center bg-[var(--surface-grouped)] px-4 py-10 sm:px-6 lg:px-8"
      >
        <section
          role="alert"
          aria-labelledby="today-board-compatibility-title"
          className="w-full max-w-2xl rounded-[var(--radius-xl)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-6 shadow-sm sm:p-8"
        >
          <h1
            id="today-board-compatibility-title"
            className="font-display text-[30px] font-semibold leading-tight text-label-primary"
          >
            {text('protocolCompatibilityTitle')}
          </h1>
          <p className="mt-3 max-w-xl text-[17px] leading-7 text-label-secondary">
            {text('protocolCompatibilityBody')}
          </p>
          <button
            type="button"
            onClick={refresh}
            className="btn-primary mt-6 min-h-11 min-w-[44px]"
          >
            {text('refreshBoard')}
          </button>
        </section>
      </main>
    )
  }

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
            : 'bg-[var(--surface-grouped)] [&_[data-testid=region-dinner]]:bg-accent-tint [&_[data-testid=region-dinner]]:border-transparent'
        }
      >
        {fridgeMode && <style>{FRIDGE_CHROME_CSS}</style>}
        {banner}

        <header className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 md:mb-5 2xl:mb-8">
          <div className="min-w-0">
            <p className="mb-1 text-[13px] font-semibold uppercase tracking-[0.12em] text-label-secondary md:text-[14px] 2xl:text-[20px]">
              {text('today')}
            </p>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <h1
                data-testid="board-date"
                className="font-display text-[30px] font-semibold tracking-tight leading-tight text-label-primary md:text-[40px] lg:text-[44px] 2xl:text-[56px]"
              >
                {now ? formatLongDate(now, displayLocale) : text('today')}
              </h1>
              {now && (
                <p
                  data-testid="board-clock"
                  className="text-[20px] font-medium tabular-nums text-label-secondary md:text-[26px] lg:text-[32px] 2xl:text-[44px]"
                >
                  <span className="sr-only">{text('time')}</span>
                  {formatTime(now, displayLocale)}
                </p>
              )}
            </div>
          </div>

          {/* Right cluster: weather (#262, only when the household opted in and a
            forecast is available) above the refresh time and the mode action. */}
          <div className="flex w-full min-w-0 flex-col items-start gap-2 sm:w-auto sm:items-end">
            {view?.weather && (
              <div className="w-full min-w-0 sm:w-auto">
                <LazyWeatherTile view={view.weather} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              {now && (
                <UpdatedLine
                  lastSyncAt={shownSyncAt}
                  now={now.getTime()}
                  className="text-[13px] text-label-secondary md:text-[15px] 2xl:text-[19px]"
                />
              )}
              {actions ? (
                actions
              ) : fridgeMode ? (
                <Link href="/dashboard/today" className={actionLinkClass}>
                  <Minimize2 className="h-5 w-5" aria-hidden="true" />
                  {text('exitFridgeMode')}
                </Link>
              ) : (
                <Link href="/dashboard/today?mode=fridge" className={actionLinkClass}>
                  <Maximize2 className="h-5 w-5" aria-hidden="true" />
                  {text('fridgeMode')}
                </Link>
              )}
            </div>
          </div>
        </header>

        {!fridgeMode && viewer && !tileActions && (
          <TodayControls links={data.links} role={viewer.role} onRefresh={refresh} online={online} />
        )}

        {now && (
          <SyncNotice
            lastSyncAt={shownSyncAt}
            now={now.getTime()}
            online={online}
            canGoStale={failing || cachedSnapshot}
            what="board"
            appBanner={!fridgeMode}
            className="mb-5"
          />
        )}
        <SyncAnnouncer message={announcement} testId="board-sync-announce" />

        {view ? (
          <div data-testid="board-grid" className={boardGridClass(fridgeMode, Boolean(useSoonSlot), showChores)}>
            <ScheduleRegion events={view.today} calendarHref={data.links.calendar} people={view.people} />
            <DinnerRegion
              dinner={view.dinner}
              compactLandscape={fridgeMode}
              mealsEnabled={data.dinners !== null}
              mealsHref={data.links.meals}
              featuresHref={data.links.features}
            />
            {/* A personal summary may already contain all today's chore rows. */}
            {showChores && (
              <ChoresRegion
                people={view.chores}
                choresHref={data.links.chores}
                onTick={tiles.tickChore}
                canTick={tiles.canTickChore}
              />
            )}
            <GroceriesRegion compactLandscape={fridgeMode} shopping={tiles.shopping} listsHref={data.links.lists} onTick={tiles.tickGrocery} action={groceryAction} />
            <ComingUpRegion days={view.comingUp} mealsEnabled={data.dinners !== null} stackInLandscape={fridgeMode} />
            {useSoonSlot && (
              <div ref={useSoonSlotRef} data-testid="board-slot-use-soon" className={`min-w-0 ${areaClass.usesoon} ${USE_SOON_SLOT_FIT}`}>
                {useSoonSlot}
              </div>
            )}
          </div>
        ) : (
          <BoardSkeleton />
        )}
      </div>
      {covered && now && (
        <LazyAmbientCover
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
