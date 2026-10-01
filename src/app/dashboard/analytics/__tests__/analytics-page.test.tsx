/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import React from 'react'
import { render, screen } from '@testing-library/react'

jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import AnalyticsPage from '../page'

function mockFetch(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch
}

describe('Analytics page', () => {
  it('shows per-member chore counts and no XP when Points & streaks is off', async () => {
    mockFetch({
      weeklyCompletion: 50,
      gamification: false,
      members: [{ id: 'c', name: 'Kid One', role: 'child', completedChores: 2, totalChores: 4 }],
    })
    render(<AnalyticsPage />)
    expect(await screen.findByText('2 of 4 chores done')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('Who did what')).toBeInTheDocument()
    expect(screen.queryByText(/XP/)).not.toBeInTheDocument()
  })

  it('shows the leaderboard with XP when Points & streaks is on', async () => {
    mockFetch({
      weeklyCompletion: 100,
      gamification: true,
      members: [
        { id: 'c', name: 'Kid One', role: 'child', completedChores: 2, totalChores: 2, xp: 120, level: 3, streak: 2, best_streak: 5 },
      ],
    })
    render(<AnalyticsPage />)
    expect(await screen.findByText('120 XP')).toBeInTheDocument()
    expect(screen.getByText('Leaderboard')).toBeInTheDocument()
    expect(screen.getByText('Level 3')).toBeInTheDocument()
  })

  it('shows an error with Try again when loading fails', async () => {
    mockFetch({ error: 'nope' }, false)
    render(<AnalyticsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load analytics.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
