/**
 * @jest-environment jsdom
 */
// Kid home: a group shows three chores still to do at a time. Ticking one
// brings the next open chore in without a reload (the ticked row stays, with
// "You did it!"), and the last-chore celebration (O-42) still waits for every
// open chore, including the ones not shown yet.
import * as React from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KidHome, { MISSIONS_AT_ONCE, visibleMissions } from '../KidHome'
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

beforeAll(() => {
  window.HTMLMediaElement.prototype.play = jest.fn(() => Promise.resolve())
  window.HTMLMediaElement.prototype.pause = jest.fn()
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
    <FeaturesProvider initial={{ ...defaultFeatures(), gamification: false, rewards: true }}>
      <ToastProvider>
        <KidHome user={{ name: 'Casey', role: 'child' }} chores={chores.map(chore)} events={[]} rewards={[]} />
      </ToastProvider>
    </FeaturesProvider>
  )
}

const mission = (title: string) => screen.getByText(title).closest('button') as HTMLButtonElement
const sectionRows = (header: string) => {
  const section = screen.getByText(header).closest('section') as HTMLElement
  return within(section)
    .getAllByRole('button')
    // Points are off here, so a row reads "<title>" or "<title>You did it!".
    .map((b) => ({
      title: (b.textContent ?? '').replace('You did it!', '').trim(),
      done: (b as HTMLButtonElement).disabled,
    }))
}

const FIVE_TODAY: C[] = [
  { id: 'a', title: 'Make bed', due_date: day(0) },
  { id: 'b', title: 'Feed the cat', due_date: day(0) },
  { id: 'c', title: 'Brush teeth', due_date: day(0) },
  { id: 'd', title: 'Tidy toys', due_date: day(0) },
  { id: 'e', title: 'Water plants', due_date: day(0) },
]

describe('visibleMissions', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }))
  it('shows the first three open ones', () => {
    expect(MISSIONS_AT_ONCE).toBe(3)
    expect(visibleMissions(list, new Set()).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })
  it('keeps ticked ones and fills up with the next open ones, in order', () => {
    expect(visibleMissions(list, new Set(['b'])).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(visibleMissions(list, new Set(['a', 'b', 'c'])).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('KidHome: the next chore comes in without a reload', () => {
  it('shows three, then the 4th and 5th as the visible ones are ticked', async () => {
    renderHome(FIVE_TODAY)
    expect(sectionRows("Today's Missions").map((r) => r.title)).toEqual(['Make bed', 'Feed the cat', 'Brush teeth'])
    expect(screen.queryByText('Tidy toys')).toBeNull()

    await userEvent.click(mission('Make bed'))
    // The ticked row stays (with "You did it!") and the next open chore joins.
    expect(sectionRows("Today's Missions")).toEqual([
      { title: 'Make bed', done: true },
      { title: 'Feed the cat', done: false },
      { title: 'Brush teeth', done: false },
      { title: 'Tidy toys', done: false },
    ])
    expect(screen.queryByText('Water plants')).toBeNull()

    await userEvent.click(mission('Feed the cat'))
    expect(mission('Water plants').disabled).toBe(false)
    expect(sectionRows("Today's Missions").filter((r) => !r.done)).toHaveLength(3)
  })

  it('does not celebrate when the shown three are done but more are waiting', async () => {
    renderHome(FIVE_TODAY)
    await userEvent.click(mission('Make bed'))
    await userEvent.click(mission('Feed the cat'))
    await userEvent.click(mission('Brush teeth'))
    expect(screen.queryByTestId('kid-celebration')).toBeNull()
    expect(screen.queryByText('All done for today!')).toBeNull()
    expect(screen.queryByText('Nothing new today!')).toBeNull()

    await userEvent.click(mission('Tidy toys'))
    expect(screen.queryByTestId('kid-celebration')).toBeNull()

    await userEvent.click(mission('Water plants'))
    expect(await screen.findByTestId('kid-celebration')).toBeTruthy()
    expect(sectionRows("Today's Missions").every((r) => r.done)).toBe(true)
  })

  it('Undo puts the chore back and the list returns to three to do', async () => {
    renderHome(FIVE_TODAY)
    await userEvent.click(mission('Make bed'))
    expect(screen.getByText('Tidy toys')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await act(async () => {})
    expect(calls.filter((c) => c.url === '/api/chores/uncomplete')).toHaveLength(1)
    expect(sectionRows("Today's Missions")).toEqual([
      { title: 'Make bed', done: false },
      { title: 'Feed the cat', done: false },
      { title: 'Brush teeth', done: false },
    ])
  })

  it('a failed tick rolls back without showing an extra chore', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response) as unknown as typeof fetch
    renderHome(FIVE_TODAY)
    await userEvent.click(mission('Make bed'))
    await act(async () => {})
    expect(mission('Make bed').disabled).toBe(false)
    expect(screen.queryByText('Tidy toys')).toBeNull()
  })

  it('earlier chores work the same way', async () => {
    renderHome([
      { id: 'y1', title: 'Old one 1', due_date: day(-1) },
      { id: 'y2', title: 'Old one 2', due_date: day(-1) },
      { id: 'y3', title: 'Old one 3', due_date: day(-2) },
      { id: 'y4', title: 'Old one 4', due_date: day(-3) },
    ])
    expect(screen.queryByText('Old one 4')).toBeNull()
    // No chores today, but older ones wait: "Nothing new today!", not "All done".
    expect(screen.getByText('Nothing new today!')).toBeTruthy()
    await userEvent.click(mission('Old one 1'))
    expect(mission('Old one 4').disabled).toBe(false)
    expect(screen.queryByTestId('kid-celebration')).toBeNull()
  })

  it('reserves room under the page while an Undo shows (kept clear of the card)', async () => {
    renderHome(FIVE_TODAY)
    expect(screen.queryByTestId('undo-room')).toBeNull()
    await userEvent.click(mission('Make bed'))
    expect(await screen.findByTestId('undo-room')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('undo-room')).toBeNull()
  })
})
