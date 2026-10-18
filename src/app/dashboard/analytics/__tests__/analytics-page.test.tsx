/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/i18n'

jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import AnalyticsPage from '../page'

function mockFetch(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch
}

const trend = [
  { date: '2026-10-01', day: 'Thu', count: 0, points: 0 },
  { date: '2026-10-02', day: 'Fri', count: 1, points: 10 },
  { date: '2026-10-03', day: 'Sat', count: 0, points: 0 },
]

function summary(overrides: Partial<{
  totalChores: number
  completedChores: number
  completionRate: number
  currentStreak: number
}> = {}) {
  return {
    totalChores: 2,
    completedChores: 2,
    completionRate: 100,
    currentStreak: 3,
    ...overrides,
  }
}

describe('Analytics page', () => {
  afterEach(() => jest.restoreAllMocks())

  it('shows calm per-member progress and no points when Points & streaks is off', async () => {
    mockFetch({
      weeklyCompletion: 50,
      gamification: false,
      summary: summary({ totalChores: 4, completedChores: 2, completionRate: 50 }),
      weeklyTrend: trend,
      members: [{ id: 'c', name: 'Kid One', role: 'child', completedChores: 2, totalChores: 4 }],
    })
    render(<AnalyticsPage />)
    expect(await screen.findByText('2 of 4 chores done')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('Weekly progress')).toBeInTheDocument()
    expect(screen.getByTestId('weekly-trend')).toBeInTheDocument()
    expect(screen.queryByText(/points|streak/i)).not.toBeInTheDocument()
  })

  it('shows family progress and member points when Points & streaks is on', async () => {
    mockFetch({
      weeklyCompletion: 100,
      gamification: true,
      summary: summary(),
      weeklyTrend: trend,
      futureField: { source: 'additive', ignoredByThisClient: true },
      members: [
        { id: 'c', name: 'Kid One', role: 'child', completedChores: 2, totalChores: 2, xp: 120, level: 3, streak: 2, best_streak: 5 },
      ],
    })
    render(<AnalyticsPage />)
    expect((await screen.findByTestId('member-points')).textContent).toBe('120 points')
    expect(screen.getByText('Level 3')).toBeInTheDocument()
    expect(screen.getByText('Family points')).toBeInTheDocument()
    expect(screen.getByText('Best streak')).toBeInTheDocument()
    expect(screen.getByText('3 day streak')).toBeInTheDocument()
  })

  it('shows a localized Spanish loading and empty state', async () => {
    mockFetch({ weeklyCompletion: 0, gamification: true, summary: summary({ totalChores: 0, completedChores: 0, completionRate: 0, currentStreak: 0 }), weeklyTrend: [], members: [] })
    render(
      <I18nProvider locale="es">
        <AnalyticsPage />
      </I18nProvider>,
    )
    expect(await screen.findByText('Aún no hay progreso')).toBeInTheDocument()
    expect(screen.getByText('No hay tareas completadas en este período.')).toBeInTheDocument()
    expect(screen.getByText('Progreso')).toBeInTheDocument()
  })

  it('localizes the compact streak unit', async () => {
    mockFetch({
      weeklyCompletion: 100,
      gamification: true,
      summary: summary(),
      weeklyTrend: trend,
      members: [{ id: 'c', name: 'Cameron', role: 'child', completedChores: 2, totalChores: 2, best_streak: 5 }],
    })
    render(
      <I18nProvider locale="es">
        <AnalyticsPage />
      </I18nProvider>,
    )
    expect(await screen.findByTestId('best-streak')).toHaveTextContent('5 d')
  })

  it('shows an error and retries the read', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'nope' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ weeklyCompletion: 25, gamification: false, summary: summary({ totalChores: 0, completedChores: 0, completionRate: 0, currentStreak: 0 }), weeklyTrend: [], members: [] }),
      })
    global.fetch = fetchMock as unknown as typeof fetch
    render(<AnalyticsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load progress.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No progress yet')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a malformed 200 response as an error instead of a false empty state', async () => {
    mockFetch({
      weeklyCompletion: 0,
      gamification: false,
      summary: summary({ totalChores: 0, completedChores: 0, completionRate: 0, currentStreak: 0 }),
      weeklyTrend: [],
      // `members` is required by the canonical response but is missing here.
    })
    render(<AnalyticsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load progress.')
    expect(screen.queryByText('No progress yet')).not.toBeInTheDocument()
  })

  it('rejects invalid and duplicate trend dates', async () => {
    mockFetch({
      weeklyCompletion: 50,
      gamification: false,
      summary: summary({ totalChores: 2, completedChores: 1, completionRate: 50 }),
      members: [],
      weeklyTrend: [
        { date: '2026-02-30', day: 'Mon', count: 1 },
        { date: '2026-02-30', day: 'Mon', count: 1 },
      ],
    })
    render(<AnalyticsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load progress.')
  })
})
