/**
 * @jest-environment jsdom
 */
// Features page: setups (presets) with a preview and Undo, then one plain
// switch list. Switch tap targets stay 44px tall around the 51x31 track.
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeaturesPage from '../page'
import { FEATURES } from '@/lib/features'

const setFeature = jest.fn(async (..._args: unknown[]) => undefined)
const updateFeatures = jest.fn(async (..._args: unknown[]) => undefined)
const mockFeatures = jest.fn()
const mockCanManage = jest.fn(() => true)
jest.mock('@/components/providers/features-provider', () => {
  return {
    useFeatures: () => ({
      features: mockFeatures(),
      setFeature,
      updateFeatures,
      canManage: mockCanManage(),
    }),
  }
})

const SWITCHABLE = FEATURES.filter((feature) => feature.group !== 'core')
const CORE = FEATURES.filter((feature) => feature.group === 'core')

describe('Features page', () => {
  beforeEach(() => {
    const { defaultFeatures } = jest.requireActual('@/lib/features')
    mockFeatures.mockReturnValue({ ...defaultFeatures(), gamification: true })
    mockCanManage.mockReturnValue(true)
    setFeature.mockReset()
    setFeature.mockImplementation(async () => undefined)
    updateFeatures.mockReset()
    updateFeatures.mockImplementation(async () => undefined)
  })

  it('switches are at least 44px tall and 51px wide, with the 51x31 track drawn inside', () => {
    render(<FeaturesPage />)
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(SWITCHABLE.length)
    for (const sw of switches) {
      expect(sw.className).toMatch(/\bh-11\b/)
      expect(sw.className).toContain('min-w-[51px]')
      const track = sw.firstElementChild as HTMLElement
      expect(track.getAttribute('aria-hidden')).toBe('true')
      expect(track.className).toContain('h-[31px]')
      expect(track.className).toContain('w-[51px]')
      expect((track.firstElementChild as HTMLElement).className).toMatch(
        /\bleft-0\b/,
      )
    }
  })

  it('shows every feature in one open list, core as always on, without counts or search', () => {
    render(<FeaturesPage />)
    for (const feature of FEATURES) {
      expect(screen.getByText(feature.title, { exact: true })).toBeTruthy()
      expect(screen.getByText(feature.description, { exact: true })).toBeTruthy()
    }
    const always = document.getElementById('feature-group-core')!
    expect(within(always).queryAllByRole('switch')).toHaveLength(0)
    expect(
      within(always).getByRole('heading', { name: 'Always on' }),
    ).toBeTruthy()
    for (const feature of CORE)
      expect(within(always).getByText(feature.title, { exact: true })).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByText(/ of \d+ on/)).toBeNull()
    expect(screen.queryByText(/\d+ features/)).toBeNull()
    expect(screen.queryByText('Blocked', { exact: true })).toBeNull()
    expect(screen.queryByRole('button', { name: /Open all groups/ })).toBeNull()
  })

  it('still toggles a feature when tapped', async () => {
    const user = userEvent.setup()
    render(<FeaturesPage />)
    await user.click(
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

  it('explains a dependency instead of a Blocked badge', () => {
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
    expect(
      screen.getAllByText('Needs Points & streaks. Turn that on first.', {
        exact: true,
      }),
    ).toHaveLength(2)
  })

  it('wraps long feature copy instead of truncating it', () => {
    render(<FeaturesPage />)
    const title = screen.getByText('Birthdays & anniversaries', { exact: true })
    expect(title.className).toContain('break-words')
    expect(title.className).not.toContain('truncate')
    const description = screen.getByText('Reminders for upcoming family dates.', {
      exact: true,
    })
    expect(description.className).toContain('break-words')
    expect(description.className).not.toContain('line-clamp')
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

  it('shows each concurrently pending switch as Updating', async () => {
    const user = userEvent.setup()
    const requests = new Map<string, () => void>()
    setFeature.mockImplementation(
      (key?: unknown) =>
        new Promise<undefined>((resolve) => {
          requests.set(String(key ?? ''), () => resolve(undefined))
        }),
    )
    render(<FeaturesPage />)
    const first = screen.getByRole('switch', { name: 'Disable Meal planning' })
    const second = screen.getByRole('switch', { name: 'Enable Budget' })
    await user.click(first)
    await user.click(second)
    expect(first.getAttribute('aria-disabled')).toBe('true')
    expect(second.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getAllByText('Updating…', { exact: true })).toHaveLength(2)
    requests.get('meals')?.()
    await waitFor(() => expect(first.getAttribute('aria-disabled')).toBeNull())
    expect(second.getAttribute('aria-disabled')).toBe('true')
    requests.get('budget')?.()
    await waitFor(() => expect(second.getAttribute('aria-disabled')).toBeNull())
  })

  describe('Pick a setup', () => {
    it('marks the setup in use, or Custom when none matches', () => {
      const { defaultFeatures } = jest.requireActual('@/lib/features')
      mockFeatures.mockReturnValue(defaultFeatures())
      const { unmount } = render(<FeaturesPage />)
      expect(
        screen.getByRole('button', { name: /^Essentials/ }).getAttribute('aria-pressed'),
      ).toBe('true')
      expect(
        within(screen.getByRole('button', { name: /^Essentials/ })).getByText(
          'In use now',
        ),
      ).toBeTruthy()
      unmount()

      mockFeatures.mockReturnValue({ ...defaultFeatures(), budget: true })
      render(<FeaturesPage />)
      expect(
        screen.getByRole('button', { name: /^Custom/ }).getAttribute('aria-pressed'),
      ).toBe('true')
    })

    it('previews exactly what turns on and off, then applies it in one change with Undo', async () => {
      const user = userEvent.setup()
      const { defaultFeatures } = jest.requireActual('@/lib/features')
      const current = { ...defaultFeatures(), budget: true, gamification: true, rewards: true }
      mockFeatures.mockReturnValue(current)
      render(<FeaturesPage />)

      await user.click(screen.getByRole('button', { name: /^Busy school year/ }))
      const preview = screen.getByRole('region', { name: 'Use Busy school year?' })
      expect(document.activeElement).toBe(
        within(preview).getByRole('heading', { name: 'Use Busy school year?' }),
      )
      const turnsOn = within(preview).getByText('Turns on').parentElement!
      expect(
        within(turnsOn).getAllByRole('listitem').map((item) => item.textContent),
      ).toEqual([
        'Pinned notes',
        'Locations',
        'Pickups & dropoffs',
        'Babysitter handoff',
        'Sick days & meds',
      ])
      const turnsOff = within(preview).getByText('Turns off').parentElement!
      expect(
        within(turnsOff).getAllByRole('listitem').map((item) => item.textContent),
      ).toEqual(['Points & streaks', 'Rewards', 'Budget'])
      expect(updateFeatures).not.toHaveBeenCalled()

      await user.click(within(preview).getByRole('button', { name: 'Use this setup' }))
      expect(updateFeatures).toHaveBeenCalledTimes(1)
      expect(updateFeatures).toHaveBeenCalledWith({
        notes: true,
        locations: true,
        pickups: true,
        handoff: true,
        'sick-days': true,
        gamification: false,
        rewards: false,
        budget: false,
      })
      expect(await screen.findByText('Busy school year is set up.')).toBeTruthy()
      expect(screen.queryByRole('region', { name: 'Use Busy school year?' })).toBeNull()

      await user.click(screen.getByRole('button', { name: 'Undo' }))
      expect(updateFeatures).toHaveBeenLastCalledWith({
        notes: false,
        locations: false,
        pickups: false,
        handoff: false,
        'sick-days': false,
        gamification: true,
        rewards: true,
        budget: true,
      })
      expect(
        await screen.findByText('Your features are back how they were.'),
      ).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    })

    it('turns on what a feature needs when Everything is chosen', async () => {
      const user = userEvent.setup()
      const { defaultFeatures } = jest.requireActual('@/lib/features')
      mockFeatures.mockReturnValue(defaultFeatures())
      render(<FeaturesPage />)
      await user.click(screen.getByRole('button', { name: /^Everything/ }))
      await user.click(screen.getByRole('button', { name: 'Use this setup' }))
      const sent = updateFeatures.mock.calls[0]![0] as Record<string, boolean>
      expect(sent.rewards).toBe(true)
      expect(sent.analytics).toBe(true)
      expect(sent.gamification).toBe(true)
      for (const feature of CORE) expect(sent).not.toHaveProperty(feature.key)
    })

    it('says so when the setup already matches, and cannot apply nothing', async () => {
      const user = userEvent.setup()
      const { defaultFeatures } = jest.requireActual('@/lib/features')
      mockFeatures.mockReturnValue(defaultFeatures())
      render(<FeaturesPage />)
      await user.click(screen.getByRole('button', { name: /^Essentials/ }))
      expect(
        screen.getByText('Your features already match this setup.'),
      ).toBeTruthy()
      expect(
        screen.getByRole('button', { name: 'Use this setup' }).hasAttribute('disabled'),
      ).toBe(true)
    })

    it('Cancel closes the preview without a change', async () => {
      const user = userEvent.setup()
      render(<FeaturesPage />)
      await user.click(screen.getByRole('button', { name: /^Everything/ }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('region', { name: 'Use Everything?' })).toBeNull()
      expect(updateFeatures).not.toHaveBeenCalled()
    })

    it('reports a failed change plainly and offers no Undo', async () => {
      const user = userEvent.setup()
      updateFeatures.mockImplementation(async () => {
        throw new Error('403')
      })
      render(<FeaturesPage />)
      await user.click(screen.getByRole('button', { name: /^Everything/ }))
      await user.click(screen.getByRole('button', { name: 'Use this setup' }))
      expect(
        await screen.findByText(
          'Could not change your features. Nothing was changed.',
        ),
      ).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    })

    it('is parent-only: no setups and no working switches for someone who cannot manage', async () => {
      mockCanManage.mockReturnValue(false)
      render(<FeaturesPage />)
      expect(screen.queryByRole('heading', { name: 'Pick a setup' })).toBeNull()
      expect(screen.queryByRole('button', { name: /^Everything/ })).toBeNull()
      for (const toggle of screen.getAllByRole('switch')) {
        expect(toggle.hasAttribute('disabled')).toBe(true)
        fireEvent.click(toggle)
      }
      expect(setFeature).not.toHaveBeenCalled()
      expect(updateFeatures).not.toHaveBeenCalled()
    })
  })
})
