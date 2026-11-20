import { formatHandoffTime, splitPhoneNumbers, telHref } from '../handoff-format'

describe('formatHandoffTime', () => {
  it('shows weekday, day, month and time without seconds', () => {
    const text = formatHandoffTime('2027-01-08T18:00:00', 'en-GB-u-hc-h12')
    expect(text).toMatch(/Fri/)
    expect(text).toMatch(/8/)
    expect(text).toMatch(/Jan/)
    expect(text).toMatch(/6:00/)
    expect(text).not.toMatch(/6:00:00/)
  })

  it('follows a 24-hour locale', () => {
    expect(formatHandoffTime('2027-01-08T18:05:00', 'en-GB')).toMatch(/18:05/)
  })

  it('returns null for missing or invalid values', () => {
    expect(formatHandoffTime(null, 'en')).toBeNull()
    expect(formatHandoffTime('not a date', 'en')).toBeNull()
  })
})

describe('telHref', () => {
  it('keeps digits and a leading plus', () => {
    expect(telHref('(555) 123-4567')).toBe('tel:5551234567')
    expect(telHref('+44 20 7946 0958')).toBe('tel:+442079460958')
  })

  it('rejects things that are not phone numbers', () => {
    expect(telHref('911')).toBeNull()
    expect(telHref('2026-01-09')).toBeNull()
    expect(telHref('')).toBeNull()
  })
})

describe('splitPhoneNumbers', () => {
  it('finds numbers the parent typed and keeps the text as written', () => {
    const segments = splitPhoneNumbers('Call Mom on 555-0100 or Dr. Lee (555) 222-3333.')
    expect(segments).toEqual([
      { kind: 'text', text: 'Call Mom on ' },
      { kind: 'phone', text: '555-0100', href: 'tel:5550100' },
      { kind: 'text', text: ' or Dr. Lee ' },
      { kind: 'phone', text: '(555) 222-3333', href: 'tel:5552223333' },
      { kind: 'text', text: '.' },
    ])
    expect(segments.map((segment) => segment.text).join('')).toBe('Call Mom on 555-0100 or Dr. Lee (555) 222-3333.')
  })

  it('leaves times, short numbers and dates alone', () => {
    const text = 'Bed at 8:30, EpiPen in drawer 2, back 2026-01-09'
    expect(splitPhoneNumbers(text)).toEqual([{ kind: 'text', text }])
  })
})
