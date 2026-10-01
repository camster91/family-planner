import { shareExpiry, SHARE_TOKEN_MAX_MS, SHARE_TOKEN_TTL_MS } from '../handoff-share'

describe('shareExpiry', () => {
  const now = Date.UTC(2026, 9, 1, 12, 0)
  const HOUR = 60 * 60 * 1000

  it('lasts 6h when there is no departure time', () => {
    expect(shareExpiry(null, now).getTime()).toBe(now + SHARE_TOKEN_TTL_MS)
  })
  it('stretches to 6h after a departure later than now', () => {
    const departure = new Date(now + 2 * 24 * HOUR)
    expect(shareExpiry(departure, now).getTime()).toBe(departure.getTime() + SHARE_TOKEN_TTL_MS)
  })
  it('never runs past 7 days', () => {
    const departure = new Date(now + 30 * 24 * HOUR)
    expect(shareExpiry(departure, now).getTime()).toBe(now + SHARE_TOKEN_MAX_MS)
  })
  it('still gives 6h when the departure has passed or is invalid', () => {
    expect(shareExpiry(new Date(now - 24 * HOUR), now).getTime()).toBe(now + SHARE_TOKEN_TTL_MS)
    expect(shareExpiry(new Date('nope'), now).getTime()).toBe(now + SHARE_TOKEN_TTL_MS)
  })
})
