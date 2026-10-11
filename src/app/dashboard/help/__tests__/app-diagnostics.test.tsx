/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'
import { readAppDiagnostics } from '@/lib/app-diagnostics'
import AppDiagnostics from '../AppDiagnostics'
jest.mock('@/lib/app-diagnostics', () => ({ readAppDiagnostics: jest.fn() }))
const report = { format: 1, client: { platform: 'web', installed: 'not-native', version: 'unknown', build: 'unknown', id: 'unknown', plugins: { App: false, Network: false, Share: false } }, server: null }
beforeEach(() => { jest.resetAllMocks(); (readAppDiagnostics as jest.Mock).mockResolvedValue(report) })
test('reading and copying require separate deliberate actions; denied copy stays selectable', async () => {
  const user = userEvent.setup()
  render(<I18nProvider><AppDiagnostics /></I18nProvider>)
  expect(readAppDiagnostics).not.toHaveBeenCalled()
  expect(screen.queryByTestId('app-diagnostics-report')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'View app details' }))
  expect(await screen.findByText('Web browser')).toBeTruthy()
  const copy = jest.fn().mockRejectedValue(new Error('Denied'))
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
  expect(copy).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Copy app report' }))
  expect(await screen.findByText('Could not copy. Select the report below and copy it yourself.')).toBeTruthy()
  expect(screen.getByTestId('app-diagnostics-report').textContent).toContain('not-native')
})
test('Spanish labels and unavailable state use the shared dictionary', async () => {
  const user = userEvent.setup()
  render(<I18nProvider locale="es"><AppDiagnostics /></I18nProvider>)
  await user.click(screen.getByRole('button', { name: 'Ver detalles de la aplicación' }))
  expect(await screen.findByText('Navegador web')).toBeTruthy()
  expect(screen.getByText('No disponible')).toBeTruthy()
})
test('pending read disables repeat actions and announces status', async () => {
  let resolve!: (value: typeof report) => void
  ;(readAppDiagnostics as jest.Mock).mockReturnValue(new Promise(done => { resolve = done }))
  const user = userEvent.setup(); render(<I18nProvider><AppDiagnostics /></I18nProvider>)
  await user.click(screen.getByRole('button', { name: 'View app details' }))
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toBe('Checking app details…')
  resolve(report)
  expect(await screen.findByText('Web browser')).toBeTruthy()
})
