// Visible sync (#271): version polling rules, without timers or the DOM.
import {
  BOARD_FULL_REFRESH_MS,
  BOARD_POLL_MS,
  BOARD_STALE_AFTER_MS,
  BoardVersionPoller,
  syncNotice,
  syncState,
  type PollerDeps,
} from '../board-sync'

function setup(overrides: Partial<PollerDeps> = {}) {
  let t = 1_000_000
  const state = { visible: true, online: true, server: 'v1' as string | Error }
  const refresh = jest.fn()
  const fetchVersion = jest.fn(async () => {
    if (state.server instanceof Error) throw state.server
    return state.server
  })
  const poller = new BoardVersionPoller({
    fetchVersion,
    refresh,
    now: () => t,
    isVisible: () => state.visible,
    isOnline: () => state.online,
    ...overrides,
  })
  return {
    poller,
    refresh,
    fetchVersion,
    state,
    advance: (ms: number) => {
      t += ms
    },
    now: () => t,
  }
}

describe('BoardVersionPoller', () => {
  it('confirms unchanged data without re-fetching and moves lastSyncAt', async () => {
    const s = setup()
    s.poller.loaded('v1')
    const loadedAt = s.poller.lastSyncAt
    s.advance(BOARD_POLL_MS)
    expect(await s.poller.tick()).toBe('unchanged')
    expect(s.refresh).not.toHaveBeenCalled()
    expect(s.poller.lastSyncAt).toBe(loadedAt! + BOARD_POLL_MS)
  })

  it('re-fetches once when the version changes, then settles on the new data', async () => {
    const s = setup()
    s.poller.loaded('v1')
    s.state.server = 'v2'
    s.advance(BOARD_POLL_MS)
    expect(await s.poller.tick()).toBe('refreshing')
    expect(s.refresh).toHaveBeenCalledTimes(1)
    // The refresh has not landed yet: a second tick does not stack another.
    s.advance(1000)
    expect(await s.poller.tick()).toBe('busy')
    expect(s.refresh).toHaveBeenCalledTimes(1)
    // The data "not current" until the new data arrives.
    const before = s.poller.lastSyncAt
    s.poller.loaded('v2')
    expect(s.poller.lastSyncAt).toBeGreaterThan(before!)
    s.advance(BOARD_POLL_MS)
    expect(await s.poller.tick()).toBe('unchanged')
    expect(s.refresh).toHaveBeenCalledTimes(1)
  })

  it('asks again if a requested refresh seems lost', async () => {
    const s = setup()
    s.poller.loaded('v1')
    s.state.server = 'v2'
    await s.poller.tick()
    s.advance(2 * BOARD_POLL_MS)
    expect(await s.poller.tick()).toBe('refreshing')
    expect(s.refresh).toHaveBeenCalledTimes(2)
  })

  it('pauses while hidden or offline (no request at all)', async () => {
    const s = setup()
    s.poller.loaded('v1')
    s.state.visible = false
    expect(await s.poller.tick()).toBe('skipped')
    s.state.visible = true
    s.state.online = false
    expect(await s.poller.tick()).toBe('skipped')
    expect(s.fetchVersion).not.toHaveBeenCalled()
  })

  it('counts failures without moving lastSyncAt, and recovers', async () => {
    const onChange = jest.fn()
    const s = setup({ onChange })
    s.poller.loaded('v1')
    const loadedAt = s.poller.lastSyncAt
    s.state.server = new Error('429')
    s.advance(BOARD_POLL_MS)
    expect(await s.poller.tick()).toBe('failed')
    expect(await s.poller.tick()).toBe('failed')
    expect(s.poller.failures).toBe(2)
    expect(s.poller.lastSyncAt).toBe(loadedAt)
    expect(s.refresh).not.toHaveBeenCalled()
    s.state.server = 'v1'
    expect(await s.poller.tick()).toBe('unchanged')
    expect(s.poller.failures).toBe(0)
    expect(onChange).toHaveBeenCalled()
  })

  it('never runs two checks at once', async () => {
    let release!: (v: string) => void
    const s = setup({ fetchVersion: () => new Promise<string>((r) => (release = r)) })
    s.poller.loaded('v1')
    const first = s.poller.tick()
    expect(await s.poller.tick()).toBe('busy')
    release('v1')
    expect(await first).toBe('unchanged')
  })

  it('still does the slow full refresh (weather, subscribed feeds) without a version change', async () => {
    const s = setup()
    s.poller.loaded('v1')
    s.advance(BOARD_FULL_REFRESH_MS)
    expect(await s.poller.tick()).toBe('refreshing')
    expect(s.refresh).toHaveBeenCalledTimes(1)
    expect(s.fetchVersion).not.toHaveBeenCalled()
  })

  it('refreshes a board that arrived without a version (older server)', async () => {
    const s = setup()
    s.poller.loaded(undefined)
    expect(await s.poller.tick()).toBe('refreshing')
  })
})

describe('syncState and syncNotice', () => {
  const now = 10_000_000
  it('is fresh right after a check, stale after a while, offline when offline', () => {
    expect(syncState(now - 1000, now, true)).toBe('fresh')
    expect(syncState(now - BOARD_STALE_AFTER_MS - 1, now, true)).toBe('stale')
    expect(syncState(now, now, false)).toBe('offline')
    expect(syncState(null, now, true)).toBe('fresh')
  })

  it('says it in words', () => {
    expect(syncNotice('fresh', now, now, 'board')).toBeNull()
    expect(syncNotice('offline', now - 3 * 60 * 1000, now, 'board')).toBe(
      "You're offline. Showing what was here 3 min ago. The board refreshes when the connection returns."
    )
    expect(syncNotice('stale', now - 5 * 60 * 1000, now, 'board')).toBe(
      "Can't reach Family Planner right now. Showing what was here 5 min ago. The board keeps trying on its own."
    )
    expect(syncNotice('offline', now - 30 * 1000, now, 'calendar')).toContain('just now. The calendar refreshes')
  })
})
