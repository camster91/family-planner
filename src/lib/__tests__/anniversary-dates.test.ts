import { buildDateItems, type ApiDateItem } from '../anniversary-dates'

function item(id: string, type: ApiDateItem['type'], date: string, days_until = 999): ApiDateItem {
  return { id, name: id, type, date, days_until, next_occurrence: date }
}

describe('buildDateItems', () => {
  it('keeps custom dates in their own group', () => {
    const { birthdays, anniversaries, others } = buildDateItems(
      [
        item('bday', 'birthday', '1990-03-20T00:00:00.000Z'),
        item('wed', 'anniversary', '2010-06-01T00:00:00.000Z'),
        item('move', 'custom', '2020-04-01T00:00:00.000Z'),
      ],
      '2026-03-15'
    )
    expect(birthdays.map((d) => d.id)).toEqual(['bday'])
    expect(anniversaries.map((d) => d.id)).toEqual(['wed'])
    expect(others.map((d) => d.id)).toEqual(['move'])
  })

  it('recounts days from the given local day, so the day itself is 0', () => {
    // The server (UTC) may already be on the next day; the client passes its own.
    const { birthdays } = buildDateItems([item('bday', 'birthday', '1990-03-15T00:00:00.000Z', 364)], '2026-03-15')
    expect(birthdays[0].daysUntil).toBe(0)
  })

  it('sorts each group soonest first', () => {
    const { others } = buildDateItems(
      [item('later', 'custom', '2020-12-01T00:00:00.000Z'), item('soon', 'custom', '2020-03-16T00:00:00.000Z')],
      '2026-03-15'
    )
    expect(others.map((d) => [d.id, d.daysUntil])).toEqual([
      ['soon', 1],
      ['later', 261],
    ])
  })
})
