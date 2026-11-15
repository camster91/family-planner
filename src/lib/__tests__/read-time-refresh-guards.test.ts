import { mayUseFeedValidators } from '@/lib/calendar-import/sync-values'
import { SERIES_HORIZON_MS, SERIES_TOP_UP_SLACK_MS, seriesTopUpDueBefore, seriesTopUpTarget } from '@/lib/event-series'

const DAY = 86_400_000
const NOW = new Date('2026-11-15T12:00:00Z')

describe('mayUseFeedValidators', () => {
  it('reads an unchanged feed in full on the first refresh of each day, so later repeats are written', () => {
    expect(mayUseFeedValidators(null, NOW)).toBe(false)
    expect(mayUseFeedValidators(new Date(NOW.getTime() - DAY), NOW)).toBe(false)
    expect(mayUseFeedValidators(NOW.getTime() - 13 * 3_600_000, NOW)).toBe(false)
  })
  it('asks "has it changed?" again within the same day', () => {
    expect(mayUseFeedValidators(new Date(NOW.getTime() - 3_600_000), NOW)).toBe(true)
    expect(mayUseFeedValidators(NOW.getTime() - 60_000, NOW)).toBe(true)
  })
})

describe('seriesTopUpDueBefore', () => {
  const now = NOW.getTime()
  it('does not find a series due again right after it was topped up to the horizon', () => {
    const writtenThrough = seriesTopUpTarget(now)
    expect(writtenThrough).toBe(now + SERIES_HORIZON_MS)
    // A read one minute, and one day, later.
    expect(writtenThrough < seriesTopUpDueBefore(now + 60_000)).toBe(false)
    expect(writtenThrough < seriesTopUpDueBefore(now + DAY)).toBe(false)
    // Due again once the written rows fall a week short of the horizon.
    expect(writtenThrough < seriesTopUpDueBefore(now + SERIES_TOP_UP_SLACK_MS + 1)).toBe(true)
  })
  it('gives a reader looking further ahead exactly the range they asked for', () => {
    const wanted = now + SERIES_HORIZON_MS + 30 * DAY
    expect(seriesTopUpDueBefore(now, wanted)).toBe(wanted)
  })
})
