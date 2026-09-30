/**
 * @jest-environment jsdom
 */
// Shared-tablet route error state (route inventory F-9): plain words, a retry,
// and nothing from the error or the household on the shared screen.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'
import DeviceError from '../error'

function secretError() {
  const error = new Error('device token dt_live_abc123 rejected for household Smith') as Error & { digest?: string }
  error.stack = 'Error: at loadBoard (/app/src/app/device/today/page.tsx:12)'
  error.digest = 'digest-9001'
  return error
}

it('shows a calm alert with a Try again button that calls reset()', async () => {
  const reset = jest.fn()
  render(
    <I18nProvider>
      <DeviceError error={secretError()} reset={reset} />
    </I18nProvider>
  )
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.getByRole('heading', { level: 1, name: 'This page did not load' })).toBeTruthy()
  expect(screen.getByText(/Try again in a moment/)).toBeTruthy()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
  expect(reset).toHaveBeenCalledTimes(1)
})

it('never renders the error message, stack or digest', () => {
  const { container } = render(
    <I18nProvider>
      <DeviceError error={secretError()} reset={jest.fn()} />
    </I18nProvider>
  )
  expect(container.textContent ?? '').not.toMatch(/dt_live_abc123|Smith|loadBoard|page\.tsx|digest-9001/)
})
