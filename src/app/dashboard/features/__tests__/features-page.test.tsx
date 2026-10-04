/**
 * @jest-environment jsdom
 */
// Features page switches: the tap target is the 44px-tall button, while the
// switch picture inside stays the familiar 51x31 track (AGENTS.md >= 44x44).
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeaturesPage from '../page'

const setFeature = jest.fn(async () => undefined)
jest.mock('@/components/providers/features-provider', () => {
  const { defaultFeatures } = jest.requireActual('@/lib/features')
  return { useFeatures: () => ({ features: { ...defaultFeatures(), gamification: true }, setFeature }) }
})

describe('Features page switches', () => {
  it('are at least 44px tall and 51px wide, with the 51x31 track drawn inside', () => {
    render(<FeaturesPage />)
    const switches = screen.getAllByRole('switch')
    expect(switches.length).toBeGreaterThan(0)
    for (const sw of switches) {
      expect(sw.className).toMatch(/\bh-11\b/)
      expect(sw.className).toContain('min-w-[51px]')
      const track = sw.firstElementChild as HTMLElement
      expect(track.getAttribute('aria-hidden')).toBe('true')
      expect(track.className).toContain('h-[31px]')
      expect(track.className).toContain('w-[51px]')
    }
  })

  it('still toggles a feature when tapped', async () => {
    render(<FeaturesPage />)
    await userEvent.click(screen.getByRole('switch', { name: 'Disable Points & streaks' }))
    expect(setFeature).toHaveBeenCalledWith('gamification', false)
  })

  it('describes Points & streaks without "XP"', () => {
    render(<FeaturesPage />)
    expect(screen.getByText('Points for chores, levels, streaks and a family leaderboard.')).toBeTruthy()
  })
})
