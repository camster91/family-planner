// Morning summary builder (O-38): each part, empty -> nothing, role rules
// (only your own chores; "to check" for parents only), features, and the
// person's local day and clock (O-31), including date-line and DST edges.
import {
  MAX_SUMMARY_TEXT,
  buildMorningSummary,
  cleanTitle,
  dayLabelOf,
  eventsOnDay,
  formatClock,
  type MorningSummaryInput,
} from '../morning-summary'

const TZ = 'America/Toronto'
const DAY = '2026-10-03' // a Saturday; Toronto is UTC-4 (EDT)
const ALL = { chores: true, calendar: true, meals: true }

function input(over: Partial<MorningSummaryInput> = {}): MorningSummaryInput {
  return {
    person: { id: 'kid', role: 'child' },
    dayKey: DAY,
    timeZone: TZ,
    features: ALL,
    chores: [],
    events: [],
    dinners: [],
    toCheckCount: 0,
    ...over,
  }
}

const chore = (title: string, assigneeId = 'kid', dueDay = DAY, status = 'pending') => ({
  title,
  assigneeId,
  dueDay,
  status,
})
const at = (iso: string) => new Date(iso)

describe('buildMorningSummary', () => {
  it('returns null when there is nothing at all (send nothing)', () => {
    expect(buildMorningSummary(input())).toBeNull()
    // Only other people's chores, done chores, other days: still nothing.
    expect(
      buildMorningSummary(
        input({
          chores: [
            chore('Sibling', 'sib'),
            chore('Done', 'kid', DAY, 'completed'),
            chore('Tomorrow', 'kid', '2026-10-04'),
          ],
          dinners: [{ day: '2026-10-04', name: 'Pizza' }],
          toCheckCount: 4, // a child never gets "to check"
        })
      )
    ).toBeNull()
  })

  it('builds the owner example: chores, an event with a time, and dinner', () => {
    const s = buildMorningSummary(
      input({
        chores: [chore('Feed the cat'), chore('Make bed')],
        events: [
          {
            title: 'Dentist',
            start: at('2026-10-03T19:00:00Z'),
            end: at('2026-10-03T20:00:00Z'),
          },
        ],
        dinners: [{ day: DAY, name: 'Tacos' }],
      })
    )!
    expect(s.text).toBe('Today: 2 chores (Feed the cat, Make bed), Dentist at 3pm, Tacos for dinner.')
    expect(s.lines).toEqual([
      'Your 2 chores: Feed the cat, Make bed',
      'On the calendar: Dentist at 3pm',
      'Dinner: Tacos',
    ])
    expect(s.dayLabel).toBe('Saturday, October 3')
    expect(s.toCheck).toBeNull()
  })

  it('names up to 3 chores, then "and N more"; counts only open ones', () => {
    const s = buildMorningSummary(
      input({
        chores: [
          chore('A'),
          chore('B', 'kid', DAY, 'in_progress'),
          chore('C', 'kid', DAY, 'overdue'),
          chore('D'),
          chore('E'),
          chore('Done', 'kid', DAY, 'verified'),
        ],
      })
    )!
    expect(s.chores).toEqual({ count: 5, titles: ['A', 'B', 'C'] })
    expect(s.text).toBe('Today: 5 chores (A, B, C and 2 more).')
    expect(buildMorningSummary(input({ chores: [chore('Only one')] }))!.text).toBe('Today: 1 chore (Only one).')
  })

  it('names the first 3 events in time order, then "and N more events"', () => {
    const ev = (title: string, h: number) => ({
      title,
      start: at(`2026-10-03T${String(h).padStart(2, '0')}:30:00Z`),
      end: at(`2026-10-03T${String(h + 1).padStart(2, '0')}:00:00Z`),
    })
    const s = buildMorningSummary(
      input({
        events: [ev('Late', 21), ev('Early', 13), ev('Mid', 17), ev('Later', 22), ev('Last', 23)],
      })
    )!
    expect(s.events!.items.map((e) => e.title)).toEqual(['Early', 'Mid', 'Late'])
    expect(s.events!.more).toBe(2)
    expect(s.text).toBe('Today: Early at 9:30am, Mid at 1:30pm, Late at 5:30pm and 2 more events.')
  })

  it('dinner alone is enough; the first named dinner of the day wins', () => {
    const s = buildMorningSummary(
      input({
        dinners: [
          { day: DAY, name: '  ' },
          { day: DAY, name: 'Soup' },
          { day: DAY, name: 'Pasta' },
        ],
      })
    )!
    expect(s.text).toBe('Today: Soup for dinner.')
  })

  describe('roles (ROLE_AND_ISOLATION_MATRIX "Morning summary")', () => {
    const household = {
      chores: [chore('Mine', 'me'), chore('Sibling dishes', 'sib'), chore('Partner errand', 'partner')],
      events: [
        {
          title: 'Soccer',
          start: at('2026-10-03T21:00:00Z'),
          end: at('2026-10-03T22:00:00Z'),
        },
      ],
      dinners: [{ day: DAY, name: 'Curry' }],
      toCheckCount: 3,
    }

    it('a parent gets their own chores, family events, dinner and "N chores to check"', () => {
      const s = buildMorningSummary(input({ person: { id: 'me', role: 'parent' }, ...household }))!
      expect(s.text).toBe('Today: 1 chore (Mine), Soccer at 5pm, Curry for dinner, 3 chores to check.')
      expect(s.lines).toContain('Waiting for your check: 3 chores')
      expect(s.text).not.toContain('Sibling')
      expect(s.text).not.toContain('Partner')
    })

    it.each(['teen', 'child', 'unknown-role'])(
      'a %s gets only their own chores, events and dinner (no "to check")',
      (role) => {
        const s = buildMorningSummary(input({ person: { id: 'me', role }, ...household }))!
        expect(s.text).toBe('Today: 1 chore (Mine), Soccer at 5pm, Curry for dinner.')
        expect(s.toCheck).toBeNull()
        expect(s.text).not.toMatch(/check|Sibling|Partner/)
      }
    )

    it('a parent with only chores to check still gets a summary; with 0 to check and nothing else, none', () => {
      expect(buildMorningSummary(input({ person: { id: 'me', role: 'parent' }, toCheckCount: 1 }))!.text).toBe(
        'Today: 1 chore to check.'
      )
      expect(buildMorningSummary(input({ person: { id: 'me', role: 'parent' }, toCheckCount: 0 }))).toBeNull()
    })
  })

  it('leaves out parts whose household feature is off', () => {
    const base = {
      person: { id: 'kid', role: 'parent' },
      chores: [chore('Mine')],
      events: [
        {
          title: 'Soccer',
          start: at('2026-10-03T21:00:00Z'),
          end: at('2026-10-03T22:00:00Z'),
        },
      ],
      dinners: [{ day: DAY, name: 'Curry' }],
      toCheckCount: 2,
    }
    expect(buildMorningSummary(input({ ...base, features: { ...ALL, chores: false } }))!.text).toBe(
      'Today: Soccer at 5pm, Curry for dinner.'
    )
    expect(buildMorningSummary(input({ ...base, features: { ...ALL, calendar: false } }))!.text).toBe(
      'Today: 1 chore (Mine), Curry for dinner, 2 chores to check.'
    )
    expect(buildMorningSummary(input({ ...base, features: { ...ALL, meals: false } }))!.text).toBe(
      'Today: 1 chore (Mine), Soccer at 5pm, 2 chores to check.'
    )
    expect(
      buildMorningSummary(
        input({
          ...base,
          features: { chores: false, calendar: false, meals: false },
        })
      )
    ).toBeNull()
  })

  it('cleans and caps long or messy titles and caps the whole line', () => {
    expect(cleanTitle('  Feed\n the   cat ')).toBe('Feed the cat')
    expect(cleanTitle('x'.repeat(100))).toHaveLength(60)
    expect(cleanTitle('x'.repeat(100)).endsWith('…')).toBe(true)
    const s = buildMorningSummary(
      input({
        chores: [chore('a'.repeat(200)), chore('b'.repeat(200)), chore('c'.repeat(200))],
        events: Array.from({ length: 3 }, (_, i) => ({
          title: 'e'.repeat(200) + i,
          start: at(`2026-10-03T1${i}:00:00Z`),
          end: at(`2026-10-03T1${i}:30:00Z`),
        })),
        dinners: [{ day: DAY, name: 'd'.repeat(200) }],
      })
    )!
    expect(s.text.length).toBeLessThanOrEqual(MAX_SUMMARY_TEXT)
  })

  it('keeps user text as plain text (escaping is the email template’s job)', () => {
    const s = buildMorningSummary(input({ chores: [chore('<b>Clean</b> & tidy')] }))!
    expect(s.text).toBe('Today: 1 chore (<b>Clean</b> & tidy).')
  })
})

describe('local day and clock (O-31)', () => {
  it('formats times in the person’s zone, with minutes only when needed', () => {
    expect(formatClock(at('2026-10-03T19:00:00Z'), TZ)).toBe('3pm')
    expect(formatClock(at('2026-10-03T13:30:00Z'), TZ)).toBe('9:30am')
    expect(formatClock(at('2026-10-03T04:00:00Z'), TZ)).toBe('12am')
    expect(formatClock(at('2026-10-03T19:00:00Z'), 'Asia/Kolkata')).toBe('12:30am')
    expect(dayLabelOf('2026-12-31')).toBe('Thursday, December 31')
  })

  it('places an event on the local day, not the UTC day', () => {
    // 01:00 UTC on Oct 4 is 9pm on Oct 3 in Toronto.
    const evening = {
      title: 'Movie',
      start: at('2026-10-04T01:00:00Z'),
      end: at('2026-10-04T03:00:00Z'),
    }
    expect(eventsOnDay([evening], '2026-10-03', TZ)).toEqual([{ title: 'Movie', when: 'at 9pm' }])
    expect(eventsOnDay([evening], '2026-10-04', TZ)).toEqual([])
    // ...and on Oct 4 in UTC.
    expect(eventsOnDay([evening], '2026-10-04', 'UTC')).toEqual([{ title: 'Movie', when: 'at 1am' }])
  })

  it('date-line edge: the same instant is a different "today" in Auckland and Honolulu', () => {
    const lunch = {
      title: 'Lunch',
      start: at('2026-10-03T23:30:00Z'),
      end: at('2026-10-04T00:30:00Z'),
    }
    // Auckland (UTC+13 in October): Oct 4, 12:30pm. Honolulu (UTC-10): Oct 3, 1:30pm.
    expect(eventsOnDay([lunch], '2026-10-04', 'Pacific/Auckland')).toEqual([{ title: 'Lunch', when: 'at 12:30pm' }])
    expect(eventsOnDay([lunch], '2026-10-03', 'Pacific/Auckland')).toEqual([])
    expect(eventsOnDay([lunch], '2026-10-03', 'Pacific/Honolulu')).toEqual([{ title: 'Lunch', when: 'at 1:30pm' }])
  })

  it('all-day and multi-day events read "all day" or "until <end>"', () => {
    const allDay = {
      title: 'Holiday',
      start: at('2026-10-03T04:00:00Z'),
      end: at('2026-10-04T04:00:00Z'),
    }
    const trip = {
      title: 'Trip',
      start: at('2026-10-01T16:00:00Z'),
      end: at('2026-10-05T16:00:00Z'),
    }
    const overnight = {
      title: 'Sleepover',
      start: at('2026-10-03T00:00:00Z'),
      end: at('2026-10-03T14:00:00Z'),
    }
    expect(eventsOnDay([allDay, trip, overnight], DAY, TZ)).toEqual([
      { title: 'Trip', when: 'all day' },
      { title: 'Sleepover', when: 'until 10am' },
      { title: 'Holiday', when: 'all day' },
    ])
    const s = buildMorningSummary(input({ events: [allDay] }))!
    expect(s.text).toBe('Today: Holiday (all day).')
  })

  it('an event that ends exactly at local midnight belongs only to the day it ran', () => {
    const ev = {
      title: 'Party',
      start: at('2026-10-03T22:00:00Z'),
      end: at('2026-10-04T04:00:00Z'),
    }
    expect(eventsOnDay([ev], '2026-10-03', TZ)).toEqual([{ title: 'Party', when: 'at 6pm' }])
    expect(eventsOnDay([ev], '2026-10-04', TZ)).toEqual([])
  })

  it('DST: times on the fall-back day use the right offset', () => {
    // Toronto falls back on 2026-11-01 at 2am EDT -> 1am EST.
    const morning = {
      title: 'Swim',
      start: at('2026-11-01T14:00:00Z'),
      end: at('2026-11-01T15:00:00Z'),
    }
    expect(eventsOnDay([morning], '2026-11-01', TZ)).toEqual([{ title: 'Swim', when: 'at 9am' }])
    const before = {
      title: 'Swim',
      start: at('2026-10-31T13:00:00Z'),
      end: at('2026-10-31T14:00:00Z'),
    }
    expect(eventsOnDay([before], '2026-10-31', TZ)).toEqual([{ title: 'Swim', when: 'at 9am' }])
  })

  it('a zero-length event (a task) on the day reads with its start time', () => {
    const task = {
      title: 'Call school',
      start: at('2026-10-03T14:00:00Z'),
      end: at('2026-10-03T14:00:00Z'),
    }
    expect(eventsOnDay([task], DAY, TZ)).toEqual([{ title: 'Call school', when: 'at 10am' }])
    const broken = {
      title: 'Backwards',
      start: at('2026-10-03T15:00:00Z'),
      end: at('2026-10-03T14:00:00Z'),
    }
    expect(eventsOnDay([broken], DAY, TZ)).toEqual([])
  })
})
