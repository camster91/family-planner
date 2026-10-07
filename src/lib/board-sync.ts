/**
 * Visible sync for the Today board (#271), client side.
 *
 * The board asks a cheap version endpoint (GET /api/family/board-version for
 * people, GET /api/device/today/version for a paired tablet) about every
 * BOARD_POLL_MS while the page is visible and online, and re-fetches the full
 * board only when the answer differs from the version of the data it shows.
 * A slower full refresh (BOARD_FULL_REFRESH_MS) still runs for what the
 * version cannot see: the weather forecast ageing out and the view-driven
 * subscribed-calendar refresh. No server job is involved (AGENTS.md).
 *
 * `BoardVersionPoller` holds the rules without timers or the DOM, so they are
 * unit-tested directly; `useBoardSync` (src/components/fridge) wires it to
 * intervals and browser events.
 */
import { PRODUCT_BRAND } from './brand'
import { formatRelativeTime } from './relative-time'

/** Version check interval while visible. */
export const BOARD_POLL_MS = 25 * 1000
/** Full board re-fetch even without a version change (weather, subscribed feeds). */
export const BOARD_FULL_REFRESH_MS = 15 * 60 * 1000
/** After this long without a successful check the board says it may be out of date. */
export const BOARD_STALE_AFTER_MS = 2 * 60 * 1000

export interface PollerDeps {
  /** Resolves the server's current version, or rejects (network, 429, 5xx). */
  fetchVersion: () => Promise<string>
  /** Re-fetch the full board (router.refresh or the device DTO). */
  refresh: () => void
  now: () => number
  isVisible: () => boolean
  isOnline: () => boolean
  /** Called whenever `lastSyncAt` or the failure state changes. */
  onChange?: () => void
}

export type TickResult = 'skipped' | 'unchanged' | 'refreshing' | 'failed' | 'busy'

export class BoardVersionPoller {
  /** Version of the data on screen. */
  private current: string | null = null
  /** When the data on screen was last confirmed current (viewer's clock). */
  lastSyncAt: number | null = null
  /** When the data on screen was fetched. */
  private loadedAt: number | null = null
  /** Consecutive failed checks. */
  failures = 0
  private inFlight = false
  /** A refresh was requested and new data has not arrived yet. */
  private pending: string | null = null
  private pendingAt = 0
  /** When the slow full refresh was last requested; cleared when data arrives. */
  private fullRequestedAt: number | null = null

  constructor(private readonly deps: PollerDeps) {}

  /** New board data arrived (first render or after a refresh). */
  loaded(version: string | null | undefined) {
    const t = this.deps.now()
    this.current = version ?? null
    this.loadedAt = t
    this.lastSyncAt = t
    this.failures = 0
    this.pending = null
    this.fullRequestedAt = null
    this.deps.onChange?.()
  }

  /** One check. Safe to call from a timer, `online` or `visibilitychange`. */
  async tick(): Promise<TickResult> {
    const { deps } = this
    if (!deps.isVisible() || !deps.isOnline()) return 'skipped'
    if (this.inFlight) return 'busy'
    const t = deps.now()
    // The slow full refresh (weather, subscribed feeds, boards without a
    // version). The clock only restarts when new data arrives (`loaded`), so
    // a refresh lost to a dropped connection is asked for again after a
    // couple of polls instead of waiting another full interval.
    if (
      this.loadedAt !== null &&
      t - this.loadedAt >= BOARD_FULL_REFRESH_MS &&
      (this.fullRequestedAt === null || t - this.fullRequestedAt >= 2 * BOARD_POLL_MS)
    ) {
      this.fullRequestedAt = t
      this.requestRefresh(this.current ?? '')
      return 'refreshing'
    }
    this.inFlight = true
    try {
      const version = await deps.fetchVersion()
      this.failures = 0
      if (this.current !== null && version === this.current) {
        this.lastSyncAt = deps.now()
        this.pending = null
        deps.onChange?.()
        return 'unchanged'
      }
      // A refresh for this same version is already on its way; don't stack
      // another unless it seems lost (e.g. the navigation was dropped).
      if (this.pending === version && deps.now() - this.pendingAt < 2 * BOARD_POLL_MS) return 'busy'
      this.requestRefresh(version)
      return 'refreshing'
    } catch {
      this.failures += 1
      deps.onChange?.()
      return 'failed'
    } finally {
      this.inFlight = false
    }
  }

  private requestRefresh(version: string) {
    this.pending = version
    this.pendingAt = this.deps.now()
    this.deps.refresh()
  }
}

export type SyncState = 'fresh' | 'stale' | 'offline'

/** Fresh, stale (no successful check for a while) or offline. */
export function syncState(lastSyncAt: number | null, now: number, online: boolean): SyncState {
  if (!online) return 'offline'
  if (lastSyncAt !== null && now - lastSyncAt > BOARD_STALE_AFTER_MS) return 'stale'
  return 'fresh'
}

/**
 * The notice under the header, in words, or null when all is well. `what`
 * names the surface ("board", "calendar").
 *
 * `bannerSaysOffline`: the app-wide OfflineBanner (O-41) is on screen and
 * already says "You're offline", so the offline notice keeps only what is
 * specific to this page (how old the data is, when it refreshes). Fridge mode
 * hides the banner, so there the notice still says it is offline
 * (docs/architecture/OFFLINE_SYNC.md, "One offline message per page").
 */
export function syncNotice(
  state: SyncState,
  lastSyncAt: number | null,
  now: number,
  what: string,
  { bannerSaysOffline = false }: { bannerSaysOffline?: boolean } = {}
): string | null {
  if (state === 'fresh' || lastSyncAt === null) return null
  const ago = formatRelativeTime(lastSyncAt, now)
  if (state === 'offline') {
    const detail = `Showing what was here ${ago}. The ${what} refreshes when the connection returns.`
    return bannerSaysOffline ? detail : `You're offline. ${detail}`
  }
  return `Can't reach ${PRODUCT_BRAND.name} right now. Showing what was here ${ago}. The ${what} keeps trying on its own.`
}
