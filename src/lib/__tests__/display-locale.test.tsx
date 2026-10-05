/**
 * @jest-environment jsdom
 */
// Dates show in the viewer's locale (app language + device region), not
// hard-coded US English. Stored dates and URL params are not affected.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { formatMonthYear, pickDisplayLocale } from '../display-locale'
import { buildDayPlans } from '../meal-slots'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import { I18nProvider } from '@/i18n'
import { formatDateOnly, formatRelativeDueDate, formatRelativePastDate } from '../dates'
import { comingUp, formatLongDate, formatTime, nextEvent, shortWeekday } from '@/components/fridge/board-model'
import { eventTime, shortDate } from '@/components/device/DevicesManager'

describe('pickDisplayLocale', () => {
  it('adds the device region when the device speaks the app language', () => {
    expect(pickDisplayLocale('en', ['en-CA', 'fr-CA'])).toBe('en-CA')
    expect(pickDisplayLocale('en', ['fr-CA', 'en-GB'])).toBe('en-GB')
    expect(pickDisplayLocale('es', ['es-MX'])).toBe('es-MX')
  })

  it('keeps the app language when the device uses another one', () => {
    expect(pickDisplayLocale('es', ['en-US'])).toBe('es')
    expect(pickDisplayLocale('en', ['fr-FR'])).toBe('en')
  })

  it('copes with no device list (server) and junk tags', () => {
    expect(pickDisplayLocale('en', [])).toBe('en')
    expect(pickDisplayLocale('en', null)).toBe('en')
    expect(pickDisplayLocale('en', ['', 'en-'])).toBe('en')
  })
})

describe('formatMonthYear', () => {
  it('names the month in the locale’s language', () => {
    expect(formatMonthYear(2026, 10, 'en')).toBe('October 2026')
    expect(formatMonthYear(2026, 10, 'es')).toMatch(/^octubre/)
  })
})

describe('meal day labels', () => {
  const FROM = new Date(2026, 9, 4) // Sun 4 Oct 2026, local

  it('use a short month name, never a numeric 10/5, in the given locale', () => {
    const us = buildDayPlans([], FROM, 'en-US')
    expect(us[0].label).toBe('Today')
    expect(us[1].label).toBe('Mon, Oct 5')
    expect(us[1].label).not.toMatch(/\d+\/\d+/)
    expect(buildDayPlans([], FROM, 'en-GB')[1].label).toMatch(/^Mon,? 5 Oct$/)
    expect(buildDayPlans([], FROM, 'es')[1].label).toMatch(/^lun, 5 oct/)
    expect(buildDayPlans([], FROM, 'es')[1].longLabel).toMatch(/^lunes, 5 de octubre/)
  })

  it('keeps the YYYY-MM-DD day key whatever the locale', () => {
    expect(buildDayPlans([], FROM, 'en-GB')[1].dateKey).toBe('2026-10-05')
    expect(buildDayPlans([], FROM, 'es')[1].dateKey).toBe('2026-10-05')
  })
})

describe('useDisplayLocale', () => {
  function Probe() {
    return <p data-testid="loc">{useDisplayLocale()}</p>
  }

  function withLanguages(langs: string[], fn: () => void) {
    const spy = jest.spyOn(window.navigator, 'languages', 'get').mockReturnValue(langs)
    try {
      fn()
    } finally {
      spy.mockRestore()
    }
  }

  it('is the app language plus the device region', () => {
    withLanguages(['en-CA', 'en'], () => {
      render(<Probe />)
      expect(screen.getByTestId('loc').textContent).toBe('en-CA')
    })
  })

  it('follows the app language from Settings (Spanish app on an English phone)', () => {
    withLanguages(['en-CA'], () => {
      render(
        <I18nProvider locale="es">
          <Probe />
        </I18nProvider>
      )
      expect(screen.getByTestId('loc').textContent).toBe('es')
    })
  })
})

// Fridge board, chores, inventory and devices (follow-up to #350): display
// dates take the display locale, with a month name instead of "10/5".
describe('other display dates follow the locale', () => {
  it('date-only values (chore due days, best-before days) stay on their UTC day in any locale', () => {
    expect(formatDateOnly('2026-10-05T00:00:00.000Z')).toBe('Oct 5')
    expect(formatDateOnly('2026-10-05', undefined, 'en-GB')).toBe('5 Oct')
    expect(formatDateOnly('2026-10-05', undefined, 'es')).toMatch(/^5 oct/)
    const now = new Date(2026, 9, 1, 12)
    expect(formatRelativeDueDate('2026-10-05', now, 'en-GB')).toBe('5 Oct')
    expect(formatRelativeDueDate('2026-10-02', now, 'en-GB')).toBe('Tomorrow')
    expect(formatRelativePastDate('2026-09-20', now, 'en-GB')).toMatch(/^20 Sept?$/)
  })

  it('the Today board labels (coming up, long date, clock, weather days, next event)', () => {
    const now = new Date(2026, 9, 4, 12, 0) // Sun 4 Oct 2026, local noon
    const gb = comingUp([], null, now, 3, 'en-GB')
    expect(gb.map((d) => d.dateLabel)).toEqual(['5 Oct', '6 Oct', '7 Oct'])
    expect(gb[0].dayKey).toBe('2026-10-05')
    expect(comingUp([], null, now, 2)[1].dateLabel).toBe('Oct 6')
    expect(formatLongDate(now, 'en-GB')).toBe('Sunday 4 October')
    expect(formatLongDate(now)).toBe('Sunday, October 4')
    expect(formatTime(new Date(2026, 9, 4, 15, 5), 'en-GB')).toBe('15:05')
    expect(formatTime(new Date(2026, 9, 4, 15, 5))).toMatch(/^3:05\sPM$/)
    expect(shortWeekday('2026-10-05', 'es')).toMatch(/^lun/)
    const start = new Date(2026, 9, 6, 9, 30).toISOString()
    const next = nextEvent(
      [{ id: 'e', title: 'Dentist', start, end: start, isTask: false, source: null, addedById: null }],
      now,
      'en-GB'
    )
    expect(next?.when).toBe('Tue 9:30')
  })

  it('device paired/removed days and activity times', () => {
    const iso = new Date(2026, 9, 4, 15, 5).toISOString()
    expect(shortDate(iso, 'en-US')).toBe('Oct 4')
    expect(shortDate(iso, 'en-GB')).toBe('4 Oct')
    expect(eventTime(iso, 'en-GB')).toBe('4 Oct, 15:05')
    expect(eventTime(iso, 'en-US')).toMatch(/^Oct 4, 3:05\sPM$/)
  })
})
