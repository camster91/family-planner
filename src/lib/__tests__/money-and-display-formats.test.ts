// One money formatter for everyday screens, plain month labels and times
// without seconds (UI review: "$10.00 → Taylor", "Approx. 18", "2026-01").
import { DEFAULT_CURRENCY, formatMoney, formatPriceText } from '@/lib/money'
import { formatClockTime, formatDateTime } from '@/lib/dates'
import { formatBudgetMonth } from '@/components/budget/BudgetDashboard'

describe('formatMoney', () => {
  it('always writes a currency symbol, in the existing USD default', () => {
    expect(DEFAULT_CURRENCY).toBe('USD')
    expect(formatMoney(10, 'en-US')).toBe('$10.00')
    expect(formatMoney(1234.5, 'en-US')).toBe('$1,234.50')
    expect(formatMoney(10, 'es-ES')).toMatch(/10,00\s?US\$/)
  })
  it('takes another currency when one is given', () => {
    expect(formatMoney(5, 'en-US', 'EUR')).toBe('€5.00')
  })
})

describe('formatPriceText', () => {
  it('shows a plain typed number as money', () => {
    expect(formatPriceText('18', 'en-US')).toBe('$18.00')
    expect(formatPriceText(' 18.5 ', 'en-US')).toBe('$18.50')
    expect(formatPriceText('1,200', 'en-US')).toBe('$1,200.00')
  })
  it('keeps any other text exactly as typed', () => {
    expect(formatPriceText('$18', 'en-US')).toBe('$18')
    expect(formatPriceText('10-15', 'en-US')).toBe('10-15')
    expect(formatPriceText('about 20 euros', 'en-US')).toBe('about 20 euros')
  })
})

describe('formatBudgetMonth', () => {
  it('writes the month in words, never 2026-01', () => {
    expect(formatBudgetMonth('2026-01', 'en-US')).toBe('January 2026')
    expect(formatBudgetMonth('2026-12', 'en-US')).toBe('December 2026')
    expect(formatBudgetMonth('2026-01', 'es-ES')).toMatch(/enero de 2026/)
  })
  it('leaves anything else alone', () => {
    expect(formatBudgetMonth('2026-13', 'en-US')).toBe('2026-13')
    expect(formatBudgetMonth('soon', 'en-US')).toBe('soon')
  })
})

describe('formatDateTime / formatClockTime', () => {
  const at = new Date(2026, 0, 5, 15, 4, 37)
  it('never shows seconds', () => {
    expect(formatDateTime(at, 'en-US')).not.toMatch(/:37/)
    expect(formatDateTime(at, 'en-US')).toMatch(/3:04/)
    expect(formatClockTime(at, 'en-US')).toMatch(/^3:04\sPM$/)
    expect(formatClockTime(at.toISOString(), 'en-US')).not.toMatch(/:37/)
  })
  it('returns nothing for an invalid value', () => {
    expect(formatDateTime('not a date', 'en-US')).toBe('')
    expect(formatClockTime(Number.NaN, 'en-US')).toBe('')
  })
})
