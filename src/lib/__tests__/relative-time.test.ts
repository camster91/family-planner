// Visible sync wording (#271): "Updated just now / 3 min ago", and the words
// for a calendar connection's last sync.
import { formatRelativeTime, updatedAgo } from '../relative-time'
import { describeCalendarSync } from '../calendar-sync-status'

const NOW = new Date('2026-01-05T17:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('formatRelativeTime', () => {
  it.each<[string, number, string]>([
    ['under a minute', 59 * 1000, 'just now'],
    ['exactly now', 0, 'just now'],
    ['one minute', MIN, '1 min ago'],
    ['three minutes', 3 * MIN + 20 * 1000, '3 min ago'],
    ['59 minutes', 59 * MIN, '59 min ago'],
    ['one hour', HOUR, '1 hour ago'],
    ['five hours', 5 * HOUR + 10 * MIN, '5 hours ago'],
    ['a day', DAY, 'yesterday'],
    ['three days', 3 * DAY, '3 days ago'],
  ])('%s', (_label, age, expected) => {
    expect(formatRelativeTime(ago(age), NOW)).toBe(expected)
  })

  it('reads a slightly future time (clock skew) as just now', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 5 * MIN), NOW)).toBe('just now')
  })

  it('accepts ISO strings and epoch numbers, and never prints NaN', () => {
    expect(formatRelativeTime(ago(2 * MIN).toISOString(), NOW.getTime())).toBe('2 min ago')
    expect(formatRelativeTime(ago(2 * MIN).getTime(), NOW)).toBe('2 min ago')
    expect(formatRelativeTime('not a date', NOW)).toBe('a while ago')
  })

  it('prefixes "Updated"', () => {
    expect(updatedAgo(ago(10 * 1000), NOW)).toBe('Updated just now')
    expect(updatedAgo(ago(3 * MIN), NOW)).toBe('Updated 3 min ago')
  })
})

describe('describeCalendarSync', () => {
  const base = { now: NOW.getTime(), verb: 'synced' as const, failedFallback: 'The last sync failed.' }

  it('says when it last synced, in words', () => {
    expect(describeCalendarSync({ ...base, lastAttemptAt: ago(3 * MIN).toISOString(), failed: false, error: null })).toEqual({
      problem: false,
      text: 'Last synced 3 min ago.',
    })
  })

  it('waits for the first sync or refresh', () => {
    expect(describeCalendarSync({ ...base, lastAttemptAt: null, failed: false, error: null }).text).toBe(
      'Waiting for first sync.'
    )
    expect(
      describeCalendarSync({ ...base, verb: 'updated', lastAttemptAt: null, failed: false, error: null }).text
    ).toBe('Waiting for first refresh.')
  })

  it('reports a failure with its stored message and when it was last tried', () => {
    expect(
      describeCalendarSync({
        ...base,
        lastAttemptAt: ago(2 * HOUR).toISOString(),
        failed: true,
        error: 'Reconnect this calendar to keep it in sync',
      })
    ).toEqual({ problem: true, text: 'Reconnect this calendar to keep it in sync. Last tried 2 hours ago.' })
    expect(describeCalendarSync({ ...base, lastAttemptAt: null, failed: true, error: null })).toEqual({
      problem: true,
      text: 'The last sync failed.',
    })
  })

  it('keeps a note on a successful refresh', () => {
    expect(
      describeCalendarSync({
        ...base,
        verb: 'updated',
        lastAttemptAt: ago(30 * 1000).toISOString(),
        failed: false,
        error: 'Some events were skipped because the feed is very large',
      }).text
    ).toBe('Last updated just now. Some events were skipped because the feed is very large.')
  })
})
