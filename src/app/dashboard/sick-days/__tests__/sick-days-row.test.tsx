/**
 * @jest-environment jsdom
 */
// A sickness started minutes ago (or a phone clock a little behind) used to
// show a negative day count, and each row named the severity twice.
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import { ToastProvider } from '@/components/ui/toast'

const mockT = (
  key: string,
  params?: Record<string, string | number>,
  scoped?: Record<string, Record<string, string>>,
) => {
  const message = scoped?.en?.[key] ?? key
  return message.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
}
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT, locale: 'en' }) }))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import SickDaysPage from '../page'

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

function serve(startedAt: string) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/sick-days')
      return reply({
        sickDays: [
          {
            id: 'sd1',
            person_id: 'kid1',
            person_name: 'Sam',
            person_avatar: null,
            started_at: startedAt,
            ended_at: null,
            symptoms: null,
            severity: 'mild',
            status: 'active',
            temperature_log: [],
            notes: null,
            medications: [],
          },
        ],
      })
    if (url === '/api/medications') return reply({ medications: [] })
    if (url === '/api/family/members') return reply({ members: [{ id: 'kid1', name: 'Sam' }] })
    if (url === '/api/auth/me') return reply({ user: { id: 'p1', role: 'parent' } })
    return reply({})
  }) as unknown as typeof fetch
}

const renderPage = () =>
  render(
    <ToastProvider>
      <SickDaysPage />
    </ToastProvider>,
  )

it('shows "Started today", never a negative count, when the start is slightly in the future', async () => {
  serve(new Date(Date.now() + 2 * 60 * 1000).toISOString())
  renderPage()
  const row = (await screen.findByText('Sam')).closest('button') as HTMLElement
  expect(within(row).getByText('Started today')).toBeTruthy()
  expect(row.textContent).not.toMatch(/-\d/)
})

it('names the severity once per row', async () => {
  serve(new Date(Date.now() - 3 * 86_400_000).toISOString())
  renderPage()
  const row = (await screen.findByText('Sam')).closest('button') as HTMLElement
  expect(within(row).getAllByText(/sickDays\.severity\.mild/)).toHaveLength(1)
  expect(within(row).getByText('Started 3 days ago')).toBeTruthy()
})
