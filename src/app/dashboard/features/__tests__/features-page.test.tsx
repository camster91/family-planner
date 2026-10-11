/**
 * @jest-environment jsdom
 */
// Features page switches: the tap target is the 44px-tall button, while the
// switch picture inside stays the familiar 51x31 track (AGENTS.md >= 44x44).
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeaturesPage from '../page'

const setFeature = jest.fn(async () => undefined)
const mockFeatures = jest.fn()
jest.mock('@/components/providers/features-provider', () => {
  return {
    useFeatures: () => ({
      features: mockFeatures(),
      setFeature,
    }),
  }
})

describe('Features page switches', () => {
  beforeEach(() => {
    const { defaultFeatures } = jest.requireActual('@/lib/features')
    mockFeatures.mockReturnValue({ ...defaultFeatures(), gamification: true })
    setFeature.mockClear()
  })

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
      // Pinned left: inside a <button> (text-align: center) an absolute knob
      // with no `left` would start from the centre and stick out.
      expect((track.firstElementChild as HTMLElement).className).toMatch(
        /\bleft-0\b/,
      )
    }
  })

  it('still toggles a feature when tapped', async () => {
    render(<FeaturesPage />)
    await userEvent.click(
      screen.getByRole('switch', { name: 'Disable Points & streaks' }),
    )
    expect(setFeature).toHaveBeenCalledWith('gamification', false)
  })

  it('describes Points & streaks without "XP"', () => {
    render(<FeaturesPage />)
    expect(
      screen.getByText(
        'Points for chores, levels, streaks and a family leaderboard.',
      ),
    ).toBeTruthy()
  })

  it('filters locally and restores all groups when the search is cleared', async () => {
    const user = userEvent.setup()
    render(<FeaturesPage />)
    const search = screen.getByRole('searchbox', { name: 'Search features' })

    await user.type(search, 'budget')
    expect(screen.getByText('Budget', { exact: true })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Clear feature search' }),
    ).toBeTruthy()
    expect(screen.queryByText('Chores', { exact: true })).toBeNull()
    expect(setFeature).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Clear feature search' }))
    expect(document.activeElement).toBe(search)
    await waitFor(() =>
      expect(screen.getByText('Chores', { exact: true })).toBeTruthy(),
    )
  })

  it('supports keyboard-friendly group disclosure and explicit states', async () => {
    const user = userEvent.setup()
    render(<FeaturesPage />)
    const planningDisclosure = screen.getByRole('button', {
      name: 'Hide Planning',
    })
    expect(
      document.getElementById('feature-group-heading-planning')?.className,
    ).toContain('focus:outline')
    expect(planningDisclosure.getAttribute('aria-expanded')).toBe('true')

    await user.click(planningDisclosure)
    expect(planningDisclosure.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('switch', { name: 'Disable Budget' })).toBeNull()

    await user.click(planningDisclosure)
    expect(screen.getByRole('switch', { name: 'Enable Budget' })).toBeTruthy()
    expect(screen.getAllByText('On', { exact: true }).length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Locked', { exact: true }).length,
    ).toBeGreaterThan(0)
  })

  it('labels dependent features as blocked instead of available Off', () => {
    const { defaultFeatures } = jest.requireActual('@/lib/features')
    mockFeatures.mockReturnValue({
      ...defaultFeatures(),
      gamification: false,
      rewards: true,
      analytics: true,
    })
    render(<FeaturesPage />)

    expect(
      screen
        .getByRole('switch', { name: 'Enable Rewards' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getAllByText('Blocked', { exact: true })).toHaveLength(2)
    expect(
      screen.getAllByText('Needs Points & streaks. Turn that on first.', {
        exact: true,
      }),
    ).toHaveLength(2)
  })

  it('opens only the useful group on a narrow viewport', () => {
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn(() => ({
        matches: true,
        media: '(max-width: 767px)',
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    })
    try {
      render(<FeaturesPage />)
      expect(
        screen.getByRole('switch', { name: 'Disable Meal planning' }),
      ).toBeTruthy()
      expect(
        screen.queryByRole('switch', { name: 'Disable Chores' }),
      ).toBeNull()
      expect(
        screen.queryByRole('switch', { name: 'Enable Locations' }),
      ).toBeNull()
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      })
    }
  })

  it('keeps a pending switch focusable and blocks duplicate activation', async () => {
    const user = userEvent.setup()
    let resolveRequest: (() => void) | undefined
    const request = new Promise<undefined>((resolve) => {
      resolveRequest = () => resolve(undefined)
    })
    setFeature.mockImplementation(() => request)
    render(<FeaturesPage />)
    const toggle = screen.getByRole('switch', {
      name: 'Disable Points & streaks',
    })
    toggle.focus()

    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-disabled')).toBe('true')
    expect(toggle.hasAttribute('disabled')).toBe(false)
    expect(document.activeElement).toBe(toggle)

    await user.click(toggle)
    expect(setFeature).toHaveBeenCalledTimes(1)
    resolveRequest?.()
    await waitFor(() => expect(toggle.getAttribute('aria-disabled')).toBeNull())
  })
})
