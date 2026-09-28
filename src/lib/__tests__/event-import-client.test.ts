// Browser helpers for the event import (#270): suggestion → draft → event body.
import { confidenceLabel, draftToEventBody, toDrafts, type ImportDraft } from '@/lib/event-import-client'

const ZONE = 'America/Toronto'

function draft(overrides: Partial<ImportDraft> = {}): ImportDraft {
  return {
    key: 's0', include: true, title: 'Bake sale', date: '2026-10-09', allDay: false, startTime: '15:30', endTime: '17:00',
    endDate: '', location: 'Gym', notes: 'Bring $2', confidence: 0.9, error: null, ...overrides,
  }
}

describe('toDrafts', () => {
  it('splits timed suggestions into wall-clock fields and unticks low confidence', () => {
    const [timed, allDay, low] = toDrafts([
      { title: 'Bake sale', start: '2026-10-09T15:30:00-04:00', end: '2026-10-09T17:00:00-04:00', allDay: false, location: 'Gym', notes: null, confidence: 0.9 },
      { title: 'Break', start: '2026-10-12', end: '2026-10-16', allDay: true, location: null, notes: null, confidence: 0.6 },
      { title: 'Maybe', start: '2026-10-20', end: null, allDay: true, location: null, notes: null, confidence: 0.3 },
    ])
    expect(timed).toMatchObject({ include: true, date: '2026-10-09', allDay: false, startTime: '15:30', endTime: '17:00', location: 'Gym', notes: '' })
    expect(allDay).toMatchObject({ include: true, allDay: true, date: '2026-10-12', endDate: '2026-10-16', startTime: '' })
    // Same-day timed events have no separate last day.
    expect(timed.endDate).toBe('')
    expect(low.include).toBe(false)
    expect([confidenceLabel(0.9), confidenceLabel(0.6), confidenceLabel(0.3)]).toEqual(['Likely', 'Check this', 'Unsure'])
  })
})

describe('multi-day timed events', () => {
  const [weekend] = toDrafts([
    {
      title: 'Camp', start: '2026-10-09T09:00:00-04:00', end: '2026-10-11T17:00:00-04:00', allDay: false,
      location: null, notes: null, confidence: 0.9,
    },
  ])

  it('keeps the last day of a timed suggestion', () => {
    expect(weekend).toMatchObject({ date: '2026-10-09', startTime: '09:00', endDate: '2026-10-11', endTime: '17:00', allDay: false })
  })

  it('saves Fri 09:00 to Sun 17:00, not Fri 17:00', () => {
    const r = draftToEventBody(weekend, ZONE)
    expect(r.ok && [r.body.start_time, r.body.end_time]).toEqual(['2026-10-09T13:00:00.000Z', '2026-10-11T21:00:00.000Z'])
  })

  it('refuses a last day without an end time, or an end before the start', () => {
    expect(draftToEventBody({ ...weekend, endTime: '' }, ZONE)).toEqual({ ok: false, error: 'Enter an end time for the last day.' })
    expect(draftToEventBody({ ...weekend, endDate: '2026-10-09', endTime: '08:00' }, ZONE)).toEqual({
      ok: false,
      error: 'The end is before the start.',
    })
  })
})

describe('draftToEventBody', () => {
  it('builds instants in the zone for timed events', () => {
    expect(draftToEventBody(draft(), ZONE)).toEqual({
      ok: true,
      body: {
        title: 'Bake sale',
        description: 'Bring $2',
        start_time: '2026-10-09T19:30:00.000Z',
        end_time: '2026-10-09T21:00:00.000Z',
        location: 'Gym',
      },
    })
  })

  it('moves an overnight end to the next local day across DST, not by 24 hours', () => {
    // Toronto falls back on 2026-11-01 at 02:00: 22:00 EDT to 03:00 EST.
    const fall = draftToEventBody(draft({ date: '2026-10-31', startTime: '22:00', endTime: '03:00' }), ZONE)
    expect(fall.ok && [fall.body.start_time, fall.body.end_time]).toEqual(['2026-11-01T02:00:00.000Z', '2026-11-01T08:00:00.000Z'])
    // Springs forward on 2027-03-14 at 02:00: 22:00 EST to 03:00 EDT.
    const spring = draftToEventBody(draft({ date: '2027-03-13', startTime: '22:00', endTime: '03:00' }), ZONE)
    expect(spring.ok && [spring.body.start_time, spring.body.end_time]).toEqual(['2027-03-14T03:00:00.000Z', '2027-03-14T07:00:00.000Z'])
  })

  it('reads an end at or before the start as the next day, and omits a missing end', () => {
    const r = draftToEventBody(draft({ startTime: '22:00', endTime: '01:00' }), ZONE)
    expect(r.ok && r.body.end_time).toBe('2026-10-10T05:00:00.000Z')
    const noEnd = draftToEventBody(draft({ endTime: '' }), ZONE)
    expect(noEnd.ok && 'end_time' in noEnd.body).toBe(false)
  })

  it('spans all-day events from 00:00 on the first day to 23:59 on the last', () => {
    const r = draftToEventBody(draft({ allDay: true, date: '2026-12-01', endDate: '2026-12-03', location: '', notes: '' }), ZONE)
    expect(r).toEqual({
      ok: true,
      body: {
        title: 'Bake sale',
        description: null,
        start_time: '2026-12-01T05:00:00.000Z',
        end_time: '2026-12-04T04:59:00.000Z',
        location: null,
      },
    })
  })

  it('returns a message for a missing title, date, time or a backwards range', () => {
    expect(draftToEventBody(draft({ title: '  ' }), ZONE)).toEqual({ ok: false, error: 'Enter a title.' })
    expect(draftToEventBody(draft({ date: '' }), ZONE)).toEqual({ ok: false, error: 'Choose a date.' })
    expect(draftToEventBody(draft({ startTime: '' }), ZONE)).toEqual({ ok: false, error: 'Enter a start time, or tick All day.' })
    expect(draftToEventBody(draft({ allDay: true, endDate: '2026-10-01' }), ZONE)).toEqual({
      ok: false,
      error: 'The end date is before the start date.',
    })
    expect(draftToEventBody(draft({ date: '2026-02-30', allDay: true }), ZONE)).toEqual({ ok: false, error: 'Choose a date.' })
  })
})
