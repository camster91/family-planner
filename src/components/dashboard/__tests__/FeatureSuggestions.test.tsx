/**
 * @jest-environment jsdom
 */
// "Turn on more" (O-38): after Get started is done or hidden, a parent sees up
// to three popular sections that are still off. Turn on calls the existing
// PATCH /api/family/features optimistically with Undo; Not now is remembered
// per household; teens and children never see it.
import * as React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeatureSuggestions, {
  featureSuggestionsStorageKey,
  pickSuggestions,
  type FeatureSuggestionsProps,
} from '../FeatureSuggestions'
import { getStartedStorageKey } from '../GetStarted'
import { FeaturesProvider, useFeatures } from '@/components/providers/features-provider'
import { ToastProvider } from '@/components/ui/toast'
import { defaultFeatures, normalizeFeatures, type FamilyFeatures } from '@/lib/features'

const FAMILY = 'fam_lean'

type Call = { method: string; body: any }
let calls: Call[]
let stored: FamilyFeatures
let failNext = false

beforeEach(() => {
  window.localStorage.clear()
  calls = []
  failNext = false
  stored = defaultFeatures()
  global.fetch = jest.fn(async (_url: any, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, body })
    if (failNext) {
      failNext = false
      return { ok: false, status: 500, json: async () => ({ error: 'nope' }) } as Response
    }
    if (method === 'PATCH') stored = { ...stored, ...body.features }
    return { ok: true, status: 200, json: async () => ({ features: stored }) } as Response
  }) as any
})

// Shows the provider's live flags so a test can see the optimistic change.
function Flags() {
  const { features } = useFeatures()
  return <output data-testid="flags">{JSON.stringify(features)}</output>
}
const flags = (): FamilyFeatures => JSON.parse(screen.getByTestId('flags').textContent || '{}')

function renderCard(
  props: Partial<FeatureSuggestionsProps> = {},
  opts: { features?: FamilyFeatures; canManage?: boolean } = {}
) {
  return render(
    <ToastProvider>
      <FeaturesProvider initial={opts.features ?? defaultFeatures()} canManage={opts.canManage ?? true}>
        <FeatureSuggestions viewer={{ role: 'parent' }} familyId={FAMILY} setupDone {...props} />
        <Flags />
      </FeaturesProvider>
    </ToastProvider>
  )
}

describe('pickSuggestions', () => {
  it('offers at most three popular sections that are off, in order', () => {
    expect(pickSuggestions(defaultFeatures()).map((s) => s.key)).toEqual(['rewards', 'budget', 'messages'])
    expect(pickSuggestions({ ...defaultFeatures(), budget: true }).map((s) => s.key)).toEqual([
      'rewards',
      'messages',
      'notes',
    ])
  })

  it('counts Rewards as off while Points & streaks is off', () => {
    const f = { ...defaultFeatures(), rewards: true, budget: true, messages: true, notes: true }
    expect(pickSuggestions(f).map((s) => s.key)).toEqual(['rewards'])
  })

  it('offers nothing to an existing household that kept the old defaults', () => {
    expect(pickSuggestions(normalizeFeatures({}))).toEqual([])
  })
})

describe('FeatureSuggestions', () => {
  it('lists up to three sections, each with one line, a Turn on button and a link to all features', () => {
    renderCard()
    const card = screen.getByRole('region', { name: 'Turn on more' })
    const items = within(within(card).getByRole('list')).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items.map((li) => li.getAttribute('data-testid'))).toEqual([
      'feature-suggestion-rewards',
      'feature-suggestion-budget',
      'feature-suggestion-messages',
    ])
    expect(items[0].textContent).toContain('Rewards & points')
    expect(items[0].textContent).toContain('Kids earn points for chores')
    expect(within(card).getByRole('button', { name: 'Turn on Budget' })).toBeTruthy()
    expect(within(card).getByRole('link', { name: /See all features/ }).getAttribute('href')).toBe(
      '/dashboard/features'
    )
  })

  it('waits while Get started is open, and shows once it is hidden', () => {
    const { unmount } = renderCard({ setupDone: false })
    expect(screen.queryByTestId('feature-suggestions')).toBeNull()
    unmount()
    // Hidden Get started (stored per household by GetStarted's Hide).
    window.localStorage.setItem(getStartedStorageKey(FAMILY), '1')
    renderCard({ setupDone: false })
    expect(screen.getByTestId('feature-suggestions')).toBeTruthy()
  })

  it('is hidden when every popular section is already on', () => {
    renderCard({}, { features: normalizeFeatures({}) })
    expect(screen.queryByTestId('feature-suggestions')).toBeNull()
  })

  it.each(['teen', 'child'])('is never shown to a %s', (role) => {
    renderCard({ viewer: { role } }, { canManage: false })
    expect(screen.queryByTestId('feature-suggestions')).toBeNull()
  })

  it('Turn on calls the features API, flips at once, and Undo puts it back', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(screen.getByRole('button', { name: 'Turn on Budget' }))
    expect(flags().budget).toBe(true)
    expect(calls).toEqual([{ method: 'PATCH', body: { features: { budget: true } } }])
    const row = screen.getByTestId('feature-suggestion-budget')
    await waitFor(() => expect(row.textContent).toContain('On for your household'))
    expect(within(row).getByRole('link', { name: 'Open Budget' }).getAttribute('href')).toBe('/dashboard/budget')

    const toast = await screen.findByTestId('undo-toast')
    expect(toast.textContent).toContain('Budget turned on')
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(flags().budget).toBe(false))
    expect(calls[1]).toEqual({ method: 'PATCH', body: { features: { budget: false } } })
    expect(stored.budget).toBe(false)
    expect(screen.getByRole('button', { name: 'Turn on Budget' })).toBeTruthy()
  })

  it('Rewards turns on Points & streaks too, and Undo turns both back off', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(screen.getByRole('button', { name: 'Turn on Rewards & points' }))
    expect(calls[0].body).toEqual({ features: { gamification: true, rewards: true } })
    await waitFor(() => expect(stored).toMatchObject({ gamification: true, rewards: true }))
    const toast = await screen.findByTestId('undo-toast')
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(stored).toMatchObject({ gamification: false, rewards: false }))
    expect(calls[1].body).toEqual({ features: { gamification: false, rewards: false } })
  })

  it('a refused save puts the flag back and says so', async () => {
    const user = userEvent.setup()
    renderCard()
    failNext = true
    await user.click(screen.getByRole('button', { name: 'Turn on Family chat' }))
    await waitFor(() => expect(flags().messages).toBe(false))
    expect(await screen.findByText('Could not turn on Family chat')).toBeTruthy()
    expect(screen.queryByText('Family chat turned on')).toBeNull()
  })

  it('Not now hides it for this household, remembers it, and Undo brings it back', async () => {
    const user = userEvent.setup()
    const { unmount } = renderCard()
    await user.click(screen.getByRole('button', { name: 'Not now, hide suggestions' }))
    expect(screen.queryByTestId('feature-suggestions')).toBeNull()
    expect(window.localStorage.getItem(featureSuggestionsStorageKey(FAMILY))).toBe('1')
    expect(calls).toEqual([])

    const toast = await screen.findByTestId('undo-toast')
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('feature-suggestions')).toBeTruthy()
    expect(window.localStorage.getItem(featureSuggestionsStorageKey(FAMILY))).toBeNull()
    unmount()
  })

  it('stays hidden on the next visit once dismissed, for that household only', () => {
    window.localStorage.setItem(featureSuggestionsStorageKey(FAMILY), '1')
    const { unmount } = renderCard()
    expect(screen.queryByTestId('feature-suggestions')).toBeNull()
    unmount()
    renderCard({ familyId: 'fam_other' })
    expect(screen.getByTestId('feature-suggestions')).toBeTruthy()
  })

  it('still hides for this visit when storage throws', async () => {
    const user = userEvent.setup()
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      renderCard()
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Not now, hide suggestions' }))
      })
      expect(screen.queryByTestId('feature-suggestions')).toBeNull()
    } finally {
      setItem.mockRestore()
    }
  })
})
