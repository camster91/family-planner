/**
 * @jest-environment jsdom
 */
// Kid home (O-42): ticking the last to-do of the day shows a short "You did
// it!" celebration (the brand motion, or its still under reduced motion) that
// settles into "All done for today!"; it never shows on load, and an Undo
// takes it away. Quick ticks leave one Undo card, and that Undo reopens the
// newest chore.
import * as React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KidHome, { CELEBRATE_MS } from '../KidHome'
import { ToastProvider } from '@/components/ui/toast'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { defaultFeatures } from '@/lib/features'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))

let calls: { url: string; body: unknown }[] = []

beforeEach(() => {
  calls = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return { ok: true, status: 200, json: async () => ({ success: true }) } as Response
  }) as unknown as typeof fetch
})

const originalMatchMedia = window.matchMedia
beforeAll(() => {
  // jsdom has no media playback.
  window.HTMLMediaElement.prototype.play = jest.fn(() => Promise.resolve())
  window.HTMLMediaElement.prototype.pause = jest.fn()
})
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

const pad = (n: number) => String(n).padStart(2, '0')
function day(offset: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00.000Z`
}

type C = { id: string; title: string; status?: string; due_date: string }
const chore = (c: C) => ({ status: 'pending', icon: null, routine: null, routine_order: null, ...c })

function renderHome(chores: C[]) {
  return render(
    <FeaturesProvider initial={{ ...defaultFeatures(), gamification: true, rewards: true }}>
      <ToastProvider>
        <KidHome user={{ name: 'Casey', role: 'child' }} chores={chores.map(chore)} events={[]} rewards={[]} />
      </ToastProvider>
    </FeaturesProvider>
  )
}

const mission = (title: string) => screen.getByText(title).closest('button') as HTMLButtonElement

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = jest.fn((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia
}

describe('KidHome: finishing the day', () => {
  beforeEach(() => jest.useFakeTimers({ advanceTimers: true }))
  afterEach(() => jest.useRealTimers())

  it('celebrates once when the last to-do is ticked, then settles into "All done"', async () => {
    mockReducedMotion(false)
    renderHome([
      { id: 'a', title: 'Make bed', due_date: day(0) },
      { id: 'b', title: 'Feed the cat', due_date: day(0) },
      { id: 'y', title: 'Water plants', due_date: day(-1) },
    ])
    expect(screen.queryByTestId('kid-celebration')).toBeNull()

    await userEvent.click(mission('Make bed'))
    await userEvent.click(mission('Water plants'))
    // Something is still to do: no celebration yet.
    expect(screen.queryByTestId('kid-celebration')).toBeNull()
    expect(screen.queryByText('All done for today!')).toBeNull()

    await userEvent.click(mission('Feed the cat'))
    const party = await screen.findByTestId('kid-celebration')
    expect(party.getAttribute('role')).toBe('status')
    expect(within(party).getByText('You did it!')).toBeTruthy()
    expect(within(party).getByText('All done for today.')).toBeTruthy()
    // The animated loop, since motion is allowed.
    expect(party.querySelector('video[data-brand-motion]')).not.toBeNull()
    expect(screen.getAllByTestId('kid-celebration')).toHaveLength(1)
    // It does not block the page: the list is still there.
    expect(screen.getByText("Today's Missions")).toBeTruthy()

    await act(async () => {
      jest.advanceTimersByTime(CELEBRATE_MS)
    })
    expect(screen.queryByTestId('kid-celebration')).toBeNull()
    expect(screen.getByText('All done for today!')).toBeTruthy()
    expect(screen.queryByText('Nothing new today!')).toBeNull()
  })

  it('uses the still picture under reduced motion, and can be closed', async () => {
    mockReducedMotion(true)
    renderHome([{ id: 'a', title: 'Make bed', due_date: day(0) }])
    await userEvent.click(mission('Make bed'))
    const party = await screen.findByTestId('kid-celebration')
    expect(party.querySelector('video')).toBeNull()
    expect(party.querySelector('img')).not.toBeNull()

    await userEvent.click(within(party).getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('kid-celebration')).toBeNull()
    expect(screen.getByText('All done for today!')).toBeTruthy()
  })

  it('does not celebrate on load when there is nothing to do', () => {
    renderHome([{ id: 'done', title: 'Feed the fish', status: 'completed', due_date: day(0) }])
    expect(screen.queryByTestId('kid-celebration')).toBeNull()
    expect(screen.getByText('All done for today!')).toBeTruthy()
  })

  it('does not celebrate while an earlier chore is still waiting', async () => {
    renderHome([
      { id: 'a', title: 'Make bed', due_date: day(0) },
      { id: 'y', title: 'Water plants', due_date: day(-1) },
    ])
    await userEvent.click(mission('Make bed'))
    expect(await screen.findByTestId('undo-toast')).toBeTruthy()
    expect(screen.queryByTestId('kid-celebration')).toBeNull()
    expect(screen.queryByText('All done for today!')).toBeNull()
  })

  it('Undo on the last tick takes the celebration away', async () => {
    renderHome([{ id: 'a', title: 'Make bed', due_date: day(0) }])
    await userEvent.click(mission('Make bed'))
    expect(await screen.findByTestId('kid-celebration')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(calls.map((c) => c.url)).toContain('/api/chores/uncomplete')
    await waitFor(() => expect(screen.queryByTestId('kid-celebration')).toBeNull())
    expect(screen.queryByText('All done for today!')).toBeNull()
    expect(mission('Make bed').disabled).toBe(false)
  })
})

describe('KidHome: one Undo at a time', () => {
  it('shows one Undo after three ticks, and it reopens the newest chore only', async () => {
    renderHome([
      { id: 'a', title: 'Make bed', due_date: day(0) },
      { id: 'b', title: 'Feed the cat', due_date: day(0) },
      { id: 'c', title: 'Brush teeth', due_date: day(0) },
    ])
    await userEvent.click(mission('Make bed'))
    await userEvent.click(mission('Feed the cat'))
    await userEvent.click(mission('Brush teeth'))
    const toasts = await screen.findAllByTestId('undo-toast')
    expect(toasts).toHaveLength(1)
    expect(toasts[0].textContent).toContain('Brush teeth')

    await userEvent.click(within(toasts[0]).getByRole('button', { name: 'Undo' }))
    await act(async () => {})
    const undone = calls.filter((c) => c.url === '/api/chores/uncomplete')
    expect(undone).toHaveLength(1)
    expect(undone[0].body).toMatchObject({ choreId: 'c' })
    expect(mission('Brush teeth').disabled).toBe(false)
    // The earlier ticks stay done.
    expect(mission('Make bed').disabled).toBe(true)
    expect(mission('Feed the cat').disabled).toBe(true)
  })
})
