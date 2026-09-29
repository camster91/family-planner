/**
 * @jest-environment jsdom
 */
// Route-level error and loading states for /dashboard (route inventory F-9).
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'
import DashboardError from '../error'
import DashboardLoading from '../loading'

function secretError() {
  const error = new Error('relation "Transaction" family_id=fam-secret-123 failed') as Error & { digest?: string }
  error.stack = 'Error: at prisma.transaction.groupBy (/app/src/app/dashboard/budget/page.tsx:89)'
  error.digest = 'digest-4242'
  return error
}

describe('dashboard error.tsx', () => {
  it('shows a calm plain-words message as an alert and focuses it', () => {
    render(
      <I18nProvider>
        <DashboardError error={secretError()} reset={jest.fn()} />
      </I18nProvider>
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    const heading = screen.getByRole('heading', { name: 'This page did not load' })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByText(/Try again, or come back in a minute/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Today' }).getAttribute('href')).toBe('/dashboard')
  })

  it('never renders the error message, stack or digest', () => {
    const { container } = render(
      <I18nProvider>
        <DashboardError error={secretError()} reset={jest.fn()} />
      </I18nProvider>
    )
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/fam-secret-123|Transaction|prisma|page\.tsx|digest-4242/)
  })

  it('Try again calls reset()', async () => {
    const reset = jest.fn()
    render(
      <I18nProvider>
        <DashboardError error={secretError()} reset={reset} />
      </I18nProvider>
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('follows the active locale', () => {
    render(
      <I18nProvider locale="es">
        <DashboardError error={secretError()} reset={jest.fn()} />
      </I18nProvider>
    )
    expect(screen.getByRole('heading', { name: 'Esta pagina no se cargo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeTruthy()
  })
})

describe('dashboard loading.tsx', () => {
  it('is a polite, busy status region with a spoken label', () => {
    render(
      <I18nProvider>
        <DashboardLoading />
      </I18nProvider>
    )
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(status.textContent).toBe('Loading…')
  })
})
