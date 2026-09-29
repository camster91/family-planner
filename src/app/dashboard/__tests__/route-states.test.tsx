/**
 * @jest-environment jsdom
 */
// Route-level error and loading states for /dashboard (route inventory F-9).
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'
import DashboardError from '../error'
import RouteLoading from '@/components/ui/route-loading'
import TodayLoading from '../today/loading'
import fs from 'fs'
import path from 'path'

const DASHBOARD = path.join(__dirname, '..')

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

describe('dashboard tab loading.tsx', () => {
  it('is a polite, busy status region with a spoken label', () => {
    render(
      <I18nProvider>
        <RouteLoading />
      </I18nProvider>
    )
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(status.textContent).toBe('Loading…')
  })

  it('each server-rendered tab re-exports the shared state', () => {
    expect(TodayLoading).toBe(RouteLoading)
    for (const tab of ['today', 'chores', 'lists', 'calendar', 'rewards']) {
      expect(fs.existsSync(path.join(DASHBOARD, tab, 'loading.tsx'))).toBe(true)
    }
  })

  // A loading boundary streams the page: a server redirect() becomes a
  // client-side one and notFound() answers 200. These segments rely on both.
  it.each(['', 'projects', 'settings'])('there is no loading boundary above /dashboard/%s', (segment) => {
    expect(fs.existsSync(path.join(DASHBOARD, segment, 'loading.tsx'))).toBe(false)
  })
})
