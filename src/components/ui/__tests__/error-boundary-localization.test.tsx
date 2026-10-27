/** @jest-environment jsdom */
// Source cases only: deferred QA, no rendered/privacy acceptance claimed.
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../error-boundary'
import { I18nProvider, useTranslation } from '@/i18n'
import { log } from '@/lib/logger'
jest.mock('@/lib/logger', () => {
  const actual = jest.requireActual('@/lib/logger')
  return { ...actual, log: { ...actual.log, error: jest.fn() } }
})
function LocaleControl() {
  const { setLocale } = useTranslation()
  return <button onClick={() => setLocale('es')}>Fixture language</button>
}
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.mocked(log.error).mockClear()
})
afterEach(() => { jest.restoreAllMocks() })
it('localizes a caught fallback, redacts its own diagnostic and retains explicit retry', () => {
  let failed = true
  function Fragile() {
    if (failed) throw new Error('fixture-private-household-content')
    return <p>Fixture recovered</p>
  }
  render(<I18nProvider locale="en" persistLocale={false}>
    <LocaleControl /><ErrorBoundary><Fragile /></ErrorBoundary>
  </I18nProvider>)
  expect(screen.getByRole('alert').textContent).toContain('Something went wrong')
  expect(screen.queryByText('fixture-private-household-content')).toBeNull()
  expect(log.error).toHaveBeenCalledWith('ui.error_boundary', { errorName: 'Error' })
  expect(JSON.stringify(jest.mocked(log.error).mock.calls)).not.toContain('fixture-private-household-content')
  fireEvent.click(screen.getByRole('button', { name: 'Fixture language' }))
  expect(screen.getByRole('alert').textContent).toContain('Algo salió mal')
  failed = false
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
  expect(screen.getByText('Fixture recovered')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})
it('retains a caller-supplied fallback', () => {
  function Fragile(): React.ReactNode { throw new Error('fixture-private') }
  render(<ErrorBoundary fallback={<p>Fixture custom recovery</p>}><Fragile /></ErrorBoundary>)
  expect(screen.getByText('Fixture custom recovery')).toBeTruthy()
  expect(screen.queryByText('Something went wrong')).toBeNull()
})
