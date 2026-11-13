import {
  EVENT_REPEAT_READY_ENV, eventRepeatReady, isLocalDay, localDayIn, seriesEventId, seriesOccurrences,
  seriesRuleFor, seriesTopUpTarget, SERIES_HORIZON_MS, SERIES_MAX_AHEAD_MS, wallTimeIn, type SeriesRule,
} from '@/lib/event-series'

const TORONTO = 'America/Toronto'
const iso = (ms: number) => new Date(ms).toISOString()
const at = (value: string) => Date.parse(value)
const rule = (every: SeriesRule['every'], anchor: string, untilDay: string | null = null, timeZone = TORONTO): SeriesRule =>
  ({ every, timeZone, anchorStart: at(anchor), untilDay })
const FAR = at('2100-01-01T00:00:00Z')

describe('repeating events: capability and inputs', () => {
  afterEach(() => { delete process.env[EVENT_REPEAT_READY_ENV] })
  it('is off unless the switch is exactly "1"', () => {
    expect(eventRepeatReady()).toBe(false)
    process.env[EVENT_REPEAT_READY_ENV] = 'true'; expect(eventRepeatReady()).toBe(false)
    process.env[EVENT_REPEAT_READY_ENV] = '1'; expect(eventRepeatReady()).toBe(true)
  })
  it('accepts only real calendar days', () => {
    expect(isLocalDay('2026-02-28')).toBe(true)
    for (const bad of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '', null, 20260101]) expect(isLocalDay(bad)).toBe(false)
  })
  it('reads wall-clock time in the series zone', () => {
    expect(wallTimeIn(at('2026-01-05T14:00:00Z'), TORONTO)).toMatchObject({ year: 2026, month: 1, day: 5, hour: 9, minute: 0 })
    expect(localDayIn(at('2026-01-06T03:30:00Z'), TORONTO)).toBe('2026-01-05')
  })
  it('builds a rule only from a known repeat, a real zone and a last day on or after the start', () => {
    const start = at('2026-01-05T14:00:00Z')
    expect(seriesRuleFor({ every: 'week', time_zone: TORONTO }, start)).toEqual({ every: 'week', timeZone: TORONTO, anchorStart: start, untilDay: null })
    expect(seriesRuleFor({ every: 'week', time_zone: TORONTO, until: '2026-01-05' }, start)?.untilDay).toBe('2026-01-05')
    expect(seriesRuleFor({ every: 'week', time_zone: TORONTO, until: '2026-01-04' }, start)).toBeNull()
    expect(seriesRuleFor({ every: 'week', time_zone: 'Mars/Olympus' }, start)).toBeNull()
    expect(seriesRuleFor({ every: 'hourly' as never, time_zone: TORONTO }, start)).toBeNull()
    expect(seriesRuleFor({ every: 'week', time_zone: TORONTO, until: '2026-02-30' }, start)).toBeNull()
  })
})

describe('repeating events: occurrences', () => {
  it('keeps 9:00 local across both daylight-saving changes (weekly, Toronto)', () => {
    // Spring forward 2026-03-08, fall back 2026-11-01.
    const spring = seriesOccurrences(rule('week', '2026-03-02T14:00:00Z'), -1, at('2026-03-20T00:00:00Z')).starts.map(iso)
    expect(spring).toEqual(['2026-03-02T14:00:00.000Z', '2026-03-09T13:00:00.000Z', '2026-03-16T13:00:00.000Z'])
    const fall = seriesOccurrences(rule('week', '2026-10-26T13:00:00Z'), -1, at('2026-11-12T00:00:00Z')).starts.map(iso)
    expect(fall).toEqual(['2026-10-26T13:00:00.000Z', '2026-11-02T14:00:00.000Z', '2026-11-09T14:00:00.000Z'])
  })
  it('steps daily, every two weeks and yearly', () => {
    expect(seriesOccurrences(rule('day', '2026-01-05T14:00:00Z'), -1, at('2026-01-08T00:00:00Z')).starts).toHaveLength(3)
    expect(seriesOccurrences(rule('2weeks', '2026-01-05T14:00:00Z'), -1, at('2026-02-10T00:00:00Z')).starts.map(iso))
      .toEqual(['2026-01-05T14:00:00.000Z', '2026-01-19T14:00:00.000Z', '2026-02-02T14:00:00.000Z'])
    expect(seriesOccurrences(rule('year', '2026-07-04T16:00:00Z'), -1, at('2029-01-01T00:00:00Z')).starts.map(iso))
      .toEqual(['2026-07-04T16:00:00.000Z', '2027-07-04T16:00:00.000Z', '2028-07-04T16:00:00.000Z'])
  })
  it('monthly on the 31st skips short months; yearly on Feb 29 skips common years', () => {
    expect(seriesOccurrences(rule('month', '2026-01-31T15:00:00Z'), -1, at('2026-06-01T00:00:00Z')).starts.map((ms) => localDayIn(ms, TORONTO)))
      .toEqual(['2026-01-31', '2026-03-31', '2026-05-31'])
    expect(seriesOccurrences(rule('year', '2028-02-29T15:00:00Z'), -1, at('2033-01-01T00:00:00Z')).starts.map((ms) => localDayIn(ms, TORONTO)))
      .toEqual(['2028-02-29', '2032-02-29'])
  })
  it('includes the last local day and stops after it', () => {
    const result = seriesOccurrences(rule('day', '2026-01-05T14:00:00Z', '2026-01-07'), -1, FAR)
    expect(result.starts.map((ms) => localDayIn(ms, TORONTO))).toEqual(['2026-01-05', '2026-01-06', '2026-01-07'])
    expect(result.done).toBe(true)
  })
  it('a late-evening event ends on its local last day, not the UTC one', () => {
    // 23:30 Toronto is the next day in UTC.
    const result = seriesOccurrences(rule('day', '2026-01-06T04:30:00Z', '2026-01-06'), -1, FAR)
    expect(result.starts.map(iso)).toEqual(['2026-01-06T04:30:00.000Z', '2026-01-07T04:30:00.000Z'])
  })
  it('returns only occurrences after the last one written, in order, within the cap', () => {
    const weekly = rule('week', '2026-01-05T14:00:00Z')
    const first = seriesOccurrences(weekly, -1, at('2026-01-20T00:00:00Z'))
    expect(first).toEqual({ starts: [at('2026-01-05T14:00:00Z'), at('2026-01-12T14:00:00Z'), at('2026-01-19T14:00:00Z')], done: false })
    const next = seriesOccurrences(weekly, first.starts[2], at('2026-02-03T00:00:00Z'))
    expect(next.starts.map(iso)).toEqual(['2026-01-26T14:00:00.000Z', '2026-02-02T14:00:00.000Z'])
    expect(seriesOccurrences(weekly, first.starts[2], first.starts[2]).starts).toEqual([])
    const capped = seriesOccurrences(rule('day', '2026-01-05T14:00:00Z'), -1, FAR, 5)
    expect(capped.starts).toHaveLength(5)
    expect(capped.done).toBe(false)
  })
  it('keeps the anchor instant exactly, including seconds', () => {
    expect(seriesOccurrences(rule('day', '2026-01-05T14:00:07.250Z'), -1, at('2026-01-05T23:00:00Z')).starts).toEqual([at('2026-01-05T14:00:07.250Z')])
  })
  it('gives each occurrence one stable, safe id', () => {
    const id = seriesEventId('0b1c2d3e-aaaa-4bbb-8ccc-1234567890ab', at('2026-01-05T14:00:00Z'))
    expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/)
    expect(id).toBe(seriesEventId('0b1c2d3e-aaaa-4bbb-8ccc-1234567890ab', at('2026-01-05T14:00:00Z')))
    expect(id).not.toBe(seriesEventId('0b1c2d3e-aaaa-4bbb-8ccc-1234567890ab', at('2026-01-12T14:00:00Z')))
  })
  it('tops up to the horizon, further when a reader looks further, never past the bound', () => {
    expect(seriesTopUpTarget(1000)).toBe(1000 + SERIES_HORIZON_MS)
    expect(seriesTopUpTarget(1000, 1000 + SERIES_HORIZON_MS + 5)).toBe(1000 + SERIES_HORIZON_MS + 5)
    expect(seriesTopUpTarget(1000, Number.MAX_SAFE_INTEGER)).toBe(1000 + SERIES_MAX_AHEAD_MS)
  })
})
