/**
 * Local-day logic for the Today board. Instants are built with local-time
 * constructors so the expectations hold in any runner zone; west of UTC (as in
 * the E2E zone, America/Toronto) the evening cases also land on a different
 * UTC day, which is the bug class these helpers exist to avoid.
 */

import {
  choresDueTodayByPerson,
  comingUp,
  dinnerOn,
  eventsLeftToday,
  firstName,
  localDayKey,
} from '../board-model'
import type { BoardChore, BoardEvent } from '@/app/dashboard/today/today-board-data'

/** Local wall-clock instant as an ISO string. */
const local = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute).toISOString()

// Monday 2026-01-05, 07:00 local.
const NOW = new Date(2026, 0, 5, 7, 0)

const ev = (id: string, start: string, end: string, extra: Partial<BoardEvent> = {}): BoardEvent => ({
  id,
  title: id,
  start,
  end,
  isTask: false,
  source: null,
  ...extra,
})

describe('localDayKey', () => {
  it('uses the local calendar day, not the UTC one', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
    expect(localDayKey(NOW, 1)).toBe('2026-01-06')
  })
})

describe('eventsLeftToday', () => {
  const events = [
    ev('ended', local(5, 3), local(5, 3, 30)),
    ev('now', local(5, 6, 30), local(5, 8)),
    ev('later', local(5, 12), local(5, 13)),
    // 21:00 local (already the next UTC day west of UTC): still today.
    ev('late-evening', local(5, 21), local(5, 22)),
    ev('tomorrow', local(6, 10), local(6, 11)),
    ev('multi-day', local(3, 10), local(7, 10)),
  ]

  it('keeps unfinished events that start on or before the local today', () => {
    const out = eventsLeftToday(events, NOW)
    expect(out.map((e) => e.id)).toEqual(['multi-day', 'now', 'later', 'late-evening'])
    expect(out.find((e) => e.id === 'now')).toMatchObject({ happeningNow: true, startedEarlier: false })
    expect(out.find((e) => e.id === 'later')).toMatchObject({ happeningNow: false, startedEarlier: false })
    expect(out.find((e) => e.id === 'multi-day')).toMatchObject({ happeningNow: true, startedEarlier: true })
  })
})

describe('choresDueTodayByPerson', () => {
  const members = [
    { id: 'p', name: 'Avery Parent' },
    { id: 't', name: 'Taylor Teen' },
    { id: 'c', name: 'Casey Child' },
  ]
  const chore = (id: string, assigneeId: string, dueDay: string, status = 'pending'): BoardChore => ({
    id,
    title: id,
    assigneeId,
    dueDay,
    status,
  })

  it('groups chores due on the local today by person, in household order, without points', () => {
    const out = choresDueTodayByPerson(
      [
        chore('c-open', 'c', '2026-01-05', 'in_progress'),
        chore('t-open', 't', '2026-01-05'),
        chore('t-done', 't', '2026-01-05', 'verified'),
        chore('t-tomorrow', 't', '2026-01-06'),
        chore('p-yesterday', 'p', '2026-01-04'),
      ],
      members,
      NOW
    )
    expect(out.map((p) => [p.member.id, p.open.map((c) => c.id), p.doneCount])).toEqual([
      ['t', ['t-open'], 1],
      ['c', ['c-open'], 0],
    ])
  })

  it('compares date-only due days by string, so a UTC-midnight chore is not shifted a day', () => {
    // 20:00 local on Jan 5 (01:00 UTC Jan 6 in Toronto). A chore due "2026-01-05" is still today.
    const evening = new Date(2026, 0, 5, 20, 0)
    const out = choresDueTodayByPerson([chore('x', 'p', '2026-01-05')], members, evening)
    expect(out).toHaveLength(1)
  })

  it('reports a person with everything done', () => {
    const out = choresDueTodayByPerson([chore('d', 'p', '2026-01-05', 'completed')], members, NOW)
    expect(out).toEqual([{ member: members[0], open: [], doneCount: 1 }])
  })

  it('is empty when nothing is due today', () => {
    expect(choresDueTodayByPerson([], members, NOW)).toEqual([])
  })
})

describe('comingUp and dinnerOn', () => {
  const dinners = [
    { id: 'd0', day: '2026-01-05', recipeName: 'Soup', cookName: null },
    { id: 'd1', day: '2026-01-06', recipeName: 'Tacos', cookName: 'Avery' },
  ]

  it('finds tonight by local day', () => {
    expect(dinnerOn(dinners, '2026-01-05')?.id).toBe('d0')
    expect(dinnerOn(dinners, '2026-01-07')).toBeNull()
    expect(dinnerOn(null, '2026-01-05')).toBeNull()
  })

  it('lists the next three local days with their events and dinners', () => {
    const events = [
      ev('tue-morning', local(6, 9), local(6, 10)),
      ev('wed', local(7, 18), local(7, 21)),
      ev('fri', local(9, 9), local(9, 10)),
    ]
    const days = comingUp(events, dinners, NOW, 3)
    expect(days.map((d) => [d.dayKey, d.label, d.dateLabel])).toEqual([
      ['2026-01-06', 'Tomorrow', 'Jan 6'],
      ['2026-01-07', 'Wednesday', 'Jan 7'],
      ['2026-01-08', 'Thursday', 'Jan 8'],
    ])
    expect(days.map((d) => d.events.map((e) => e.id))).toEqual([['tue-morning'], ['wed'], []])
    expect(days.map((d) => d.dinner?.id ?? null)).toEqual(['d1', null, null])
  })
})

describe('firstName', () => {
  it('returns the first word', () => {
    expect(firstName('Avery Fixture-A')).toBe('Avery')
    expect(firstName('  Solo ')).toBe('Solo')
  })
})
