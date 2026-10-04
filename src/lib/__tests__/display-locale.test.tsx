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
