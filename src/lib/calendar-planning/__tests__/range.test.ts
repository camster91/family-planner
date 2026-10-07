import { CalendarRangeError, parseCalendarInstant, parseCalendarRange, encodeCalendarCursor } from '../range'

const query = { start: '2026-12-31T00:00:00Z', end: '2027-01-02T00:00:00Z' }
const parse = (q: Record<string, string> = query) => parseCalendarRange(new URLSearchParams(q), 'family-a')!
const token = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString('base64url')

test.each([
  '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-00-01T00:00:00Z',
  '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z', '2026-01-01T00:60:00Z',
  '2026-01-01T00:00:60Z', '2026-01-01T00:00:00+05:60',
  '2026-01-01T00:00Z', '2026-01-01T00:00:00.1234Z',
  ' 2026-01-01T00:00:00Z', '2026-01-01t00:00:00z',
])('rejects malformed instant %s without Date rollover', value => {
  expect(() => parseCalendarInstant(value)).toThrow(CalendarRangeError)
})

test('accepts leap day, explicit offset and fractional milliseconds', () => {
  expect(parseCalendarInstant('2028-02-29T03:15:00.1+03:15').toISOString()).toBe('2028-02-29T00:00:00.100Z')
})

test.each([
  '0000-01-01T00:00:00Z',
  '0001-01-01T00:00:00+23:59',
  '9999-12-31T22:00:00-23:59',
])('rejects unsupported normalized UTC year in instant and range bounds: %s', value => {
  expect(() => parseCalendarInstant(value)).toThrow(CalendarRangeError)
  expect(() => parse({ start: value, end: value })).toThrow('Invalid calendar instant')
})

test.each(['0000-12-31T23:59:59.999Z', '+010000-01-01T00:00:00.000Z'])('rejects unsupported UTC cursor year: %s', time => {
  const range = parse()
  expect(() => encodeCalendarCursor('family-a', range, { id: 'a', start_time: new Date(time) })).toThrow(CalendarRangeError)
})

test('rejects a year-zero continuing-event cursor independently of its valid range bounds', () => {
  const range = parse()
  expect(() => parse({ ...query, cursor: token({ v: 1, family: 'family-a',
    start: range.start.toISOString(), end: range.end.toISOString(), time: '0000-12-31T23:59:59.999Z', id: 'a' }) })).toThrow(CalendarRangeError)
})

test.each([
  { start: '0001-01-01T23:59:00+23:59', end: '0001-01-02T00:00:00+23:59', utc: '0001-01-01T00:00:00.000Z' },
  { start: '9999-12-30T23:59:00-23:59', end: '9999-12-31T00:00:00-23:59', utc: '9999-12-31T23:58:00.000Z' },
  { start: '0000-12-31T23:59:00-00:01', end: '0001-01-01T00:01:00Z', utc: '0001-01-01T00:00:00.000Z' },
])('generated cursors round trip supported boundary instants on the same UTC day: %j', ({ start, end, utc }) => {
  const bounds = { start, end }
  const range = parse(bounds)
  expect(range.start.toISOString()).toBe(utc)
  const cursor = encodeCalendarCursor('family-a', range, { id: 'a', start_time: range.start })
  expect(parse({ ...bounds, cursor }).after).toEqual({ id: 'a', start: range.start })
})

test('accepts exactly 45 elapsed days and rejects one millisecond more', () => {
  const bounds = { start: '2026-01-01T00:00:00Z', end: '2026-02-15T00:00:00Z' }
  expect(parse(bounds).limit).toBe(200)
  expect(() => parse({ ...bounds, end: '2026-02-15T00:00:00.001Z' })).toThrow(CalendarRangeError)
})

test('legacy params do not opt into range mode', () => {
  expect(parseCalendarRange(new URLSearchParams('upcoming=true'), 'family-a')).toBeNull()
  expect(parseCalendarRange(new URLSearchParams(), 'family-a')).toBeNull()
})

test('cursor round trips continuing-event starts before the range and equivalent offset bounds', () => {
  const range = parse()
  const cursor = encodeCalendarCursor('family-a', range, { id: 'trip', start_time: new Date('2026-11-01T00:00:00Z') })
  const next = parse({ start: '2026-12-30T19:00:00-05:00', end: query.end, cursor, limit: '1' })
  expect(next.after).toEqual({ id: 'trip', start: new Date('2026-11-01T00:00:00Z') })
})

const validPayload = { v: 1, family: 'family-a', start: '2026-12-31T00:00:00.000Z',
  end: '2027-01-02T00:00:00.000Z', time: '2026-12-31T00:00:00.000Z', id: 'a' }
test.each([
  null, [], 'text', {}, { ...validPayload, v: 2 }, { ...validPayload, extra: true },
  { ...validPayload, family: 'family-b' }, { ...validPayload, start: '2026-12-30T00:00:00.000Z' },
  { ...validPayload, end: '2027-01-03T00:00:00.000Z' }, { ...validPayload, id: '' },
  { ...validPayload, id: '../foreign' }, { ...validPayload, id: 1 },
  { ...validPayload, time: 'bad' }, { ...validPayload, time: '2027-01-02T00:00:00.000Z' },
  { ...validPayload, time: '2026-12-31T00:00:00Z' },
])('rejects invalid cursor shape or context %j', payload => {
  expect(() => parse({ ...query, cursor: token(payload) })).toThrow(CalendarRangeError)
})

test.each(['start', 'end', 'limit', 'cursor', 'upcoming'])('rejects duplicate %s in range mode', key => {
  const params = new URLSearchParams(query)
  params.append(key, 'a'); params.append(key, 'b')
  expect(() => parseCalendarRange(params, 'family-a')).toThrow(CalendarRangeError)
})
