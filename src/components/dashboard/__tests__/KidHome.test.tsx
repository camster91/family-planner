/**
 * @jest-environment jsdom
 */
// Kid home: "Today's Missions" are the child's open chores due on their local
// today (recurring chores keep future copies, so status alone is not enough),
// earlier open chores sit in their own small group, tomorrow's are a read-only
// peek, and a reward claim updates the XP ring and is not offered again.
import * as React from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KidHome from '../KidHome'
import { ToastProvider } from '@/components/ui/toast'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { defaultFeatures } from '@/lib/features'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: jest.fn() }),
}))

type Reply = { status: number; body?: unknown }
let replies: Record<string, Reply[]> = {}
let calls: string[] = []

beforeEach(() => {
  replies = {}
  calls = []
  refresh.mockClear()
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const next = replies[url]?.shift() ?? { status: 200, body: { success: true } }
    return { ok: next.status < 300, status: next.status, json: async () => next.body ?? {} } as Response
  }) as unknown as typeof fetch
})

// Date-only values are stored at UTC midnight of the local calendar day.
const pad = (n: number) => String(n).padStart(2, '0')
function day(offset: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00.000Z`
}

type C = { id: string; title: string; status?: string; due_date: string }
const chore = (c: C) => ({ status: 'pending', icon: null, routine: null, routine_order: null, ...c })

function renderHome(chores: C[], extra: Partial<React.ComponentProps<typeof KidHome>> = {}) {
  return render(
    <FeaturesProvider initial={{ ...defaultFeatures(), gamification: true, rewards: true }}>
      <ToastProvider>
        <KidHome user={{ name: 'Casey', role: 'child' }} chores={chores.map(chore)} events={[]} rewards={[]} {...extra} />
      </ToastProvider>
    </FeaturesProvider>
  )
}

const section = (heading: string) => screen.getByText(heading).closest('section') as HTMLElement

describe('KidHome missions by due day', () => {
  it("shows only today's chores as missions; a daily chore's future copies are not today's", () => {
    renderHome([
      { id: 'd0', title: 'Make bed', due_date: day(0) },
      { id: 'd1', title: 'Make bed', due_date: day(1) },
      { id: 'd2', title: 'Make bed', due_date: day(2) },
      { id: 'd3', title: 'Make bed', due_date: day(3) },
    ])
    const missions = section("Today's Missions")
    expect(within(missions).getAllByText('Make bed')).toHaveLength(1)
    // Tomorrow's copy is a read-only peek, not a button.
    const tomorrow = section('Tomorrow')
    expect(within(tomorrow).getByText('Make bed')).toBeTruthy()
    expect(within(tomorrow).queryByRole('button')).toBeNull()
    expect(screen.queryByText('All done for today!')).toBeNull()
  })

  it('says "All done for today!" when only future chores are left', () => {
    renderHome([
      { id: 'done', title: 'Feed the fish', status: 'verified', due_date: day(0) },
      { id: 'd1', title: 'Pack school bag', due_date: day(1) },
      { id: 'd5', title: 'Pack school bag', due_date: day(5) },
    ])
    expect(screen.getByText('All done for today!')).toBeTruthy()
    expect(screen.queryByText("Today's Missions")).toBeNull()
    expect(within(section('Tomorrow')).getByText('Pack school bag')).toBeTruthy()
    // Later days are not listed at all.
    expect(screen.getAllByText('Pack school bag')).toHaveLength(1)
  })

  it('puts earlier open chores in their own group, labelled with when they were due, and still tickable', async () => {
    renderHome([
      { id: 'today', title: 'Tidy bedroom', status: 'in_progress', due_date: day(0) },
      { id: 'y', title: 'Water plants', due_date: day(-1) },
      { id: 'old', title: 'Sort socks', status: 'overdue', due_date: day(-4) },
      { id: 'olddone', title: 'Old done', status: 'completed', due_date: day(-2) },
    ])
    const missions = section("Today's Missions")
    expect(within(missions).getByText('Tidy bedroom')).toBeTruthy()
    expect(within(missions).queryByText('Water plants')).toBeNull()

    const earlier = section('Still to do')
    const rows = within(earlier).getAllByRole('button')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Water plants'),
      expect.stringContaining('Sort socks'),
    ])
    expect(within(rows[0]).getByText('Was due yesterday')).toBeTruthy()
    expect(within(rows[1]).getByText(/^Was due [A-Z][a-z]{2} \d{1,2}$/)).toBeTruthy()
    expect(screen.queryByText('Old done')).toBeNull()

    await userEvent.click(rows[0])
    expect(calls).toContain('/api/chores/complete')
    expect(await within(rows[0]).findByText('You did it!')).toBeTruthy()
  })
})

describe('KidHome reward claim', () => {
  beforeEach(() => jest.useFakeTimers({ advanceTimers: true }))
  afterEach(() => jest.useRealTimers())

  it('updates the XP ring from the response, then drops the reward and refreshes', async () => {
    replies['/api/rewards/claim'] = [{ status: 200, body: { reward: { id: 'r1' }, xp: 30 } }]
    renderHome([], {
      user: { name: 'Casey', role: 'child', xp: 80, level: 1 },
      rewards: [
        { id: 'r1', name: 'Movie night', cost: 50, status: 'available' },
        { id: 'r2', name: 'Ice cream', cost: 40, status: 'available' },
      ],
    })
    expect(screen.getByText('80')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Claim' }))
    expect(await screen.findByText('You got it!')).toBeTruthy()
    expect(screen.getByText('30')).toBeTruthy()
    expect(screen.getByText('70 XP to go!')).toBeTruthy()

    await act(async () => {
      jest.advanceTimersByTime(2000)
    })
    // The claimed reward is not offered again; the next one is.
    expect(screen.queryByText('Movie night')).toBeNull()
    expect(screen.getByText('Ice cream')).toBeTruthy()
    expect(screen.getByText('30')).toBeTruthy()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(calls.filter((u) => u === '/api/rewards/claim')).toHaveLength(1)
  })

  it('keeps the reward and balance when the claim fails', async () => {
    replies['/api/rewards/claim'] = [{ status: 409, body: { error: 'Reward is no longer available' } }]
    renderHome([], {
      user: { name: 'Casey', role: 'child', xp: 80, level: 1 },
      rewards: [{ id: 'r1', name: 'Movie night', cost: 50, status: 'available' }],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }))
    expect(await screen.findByText('Reward is no longer available')).toBeTruthy()
    expect(screen.getByText('80')).toBeTruthy()
    expect(screen.getByText('Movie night')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })
})
