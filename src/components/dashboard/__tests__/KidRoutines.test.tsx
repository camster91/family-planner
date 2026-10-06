/**
 * @jest-environment jsdom
 */
// Picture routines on the kid home (#272): today's routine steps as big
// picture cards in order, one highlighted next step, one tap to complete with
// Undo, done steps ticked with text, and an unchanged kid home without routines.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KidHome from '../KidHome'
import { ToastProvider } from '@/components/ui/toast'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { defaultFeatures } from '@/lib/features'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))

type Reply = { status: number; body?: unknown } | 'network'
let replies: Record<string, Reply[]> = {}
let calls: { url: string; body: any }[] = []

beforeEach(() => {
  replies = {}
  calls = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const next = replies[url]?.shift() ?? { status: 200, body: { success: true } }
    if (next === 'network') throw new TypeError('Failed to fetch')
    return { ok: next.status < 300, status: next.status, json: async () => next.body ?? {} } as Response
  }) as unknown as typeof fetch
})

// Date-only values are stored at UTC midnight of the local calendar day.
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T00:00:00.000Z`
const TOMORROW = (() => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00.000Z`
})()

type C = { id: string; title: string; status?: string; icon?: string | null; routine?: string | null; routine_order?: number | null; due_date?: string }
const chore = (c: C) => ({ status: 'pending', due_date: TODAY, icon: null, routine: null, routine_order: null, ...c })

const user = { name: 'Casey', role: 'child' as const }

function renderHome(chores: C[]) {
  return render(
    <ToastProvider>
      <KidHome user={user} chores={chores.map(chore)} events={[]} rewards={[]} />
    </ToastProvider>
  )
}

const steps = (routine: HTMLElement) => within(routine).getAllByTestId('routine-step')
const routineByName = (name: string) =>
  screen.getByRole('region', { name }) as HTMLElement

const MORNING: C[] = [
  // Deliberately out of order: the view sorts by step.
  { id: 'shoes', title: 'Shoes on', icon: 'shoes', routine: 'Morning', routine_order: 3 },
  { id: 'teeth', title: 'Brush teeth', icon: 'brush-teeth', routine: 'Morning', routine_order: 1 },
  { id: 'dress', title: 'Get dressed', icon: 'get-dressed', routine: 'Morning', routine_order: 2 },
]

describe('KidHome picture routines', () => {
  it('exposes routine progress without points and updates it after a step is done', async () => {
    renderHome(MORNING)
    const progress = screen.getByRole('progressbar', { name: 'Morning progress' }) as HTMLProgressElement
    expect(progress.value).toBe(0)
    expect(progress.max).toBe(3)
    await userEvent.click(steps(routineByName('Morning'))[0])
    await waitFor(() => expect(progress.value).toBe(1))
    expect(screen.getByText('Waiting for a parent')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(progress.value).toBe(0))
  })
  it('gives routines whose names differ only in punctuation or script their own headings', () => {
    renderHome([
      { id: 'a', title: 'Snack', icon: null, routine: 'After school', routine_order: 1 },
      { id: 'b', title: 'Homework', icon: null, routine: 'After-school', routine_order: 1 },
      { id: 'c', title: 'Teeth', icon: null, routine: 'ночь', routine_order: 1 },
      { id: 'd', title: 'Bath', icon: null, routine: '夜', routine_order: 1 },
    ])
    const ids = screen.getAllByTestId('kid-routine').map((section) => section.getAttribute('aria-labelledby'))
    expect(new Set(ids).size).toBe(4)
    for (const name of ['After school', 'After-school', 'ночь', '夜']) {
      expect(within(routineByName(name)).getByRole('heading').textContent).toBe(name)
    }
  })

  it('shows today’s routine steps in order as picture cards with the first open step marked next', () => {
    renderHome([
      ...MORNING,
      { id: 'pj', title: 'Pyjamas', icon: 'pyjamas', routine: 'Bedtime', routine_order: 1 },
      // Not today: not shown.
      { id: 'later', title: 'Tomorrow thing', icon: 'hat', routine: 'Morning', routine_order: 4, due_date: TOMORROW },
    ])
    const regions = screen.getAllByTestId('kid-routine')
    expect(regions.map((r) => within(r).getByRole('heading').textContent)).toEqual(['Morning', 'Bedtime'])

    const morning = routineByName('Morning')
    expect(steps(morning).map((s) => s.getAttribute('aria-label'))).toEqual([
      'Brush teeth, step 1 of 3, next step',
      'Get dressed, step 2 of 3',
      'Shoes on, step 3 of 3',
    ])
    // Big pictures (h-24 = 96px >= 88px), label visible under them.
    const firstIcon = steps(morning)[0].querySelector('svg[data-icon="brush-teeth"]')!
    expect(firstIcon.getAttribute('class')).toMatch(/h-24 w-24/)
    expect(within(steps(morning)[0]).getByText('Brush teeth')).toBeTruthy()
    // One next step across all routines, shown with the word "Next" too.
    expect(screen.getAllByText('Next')).toHaveLength(1)
    expect(steps(morning)[0].getAttribute('aria-current')).toBe('step')
    expect(steps(routineByName('Bedtime'))[0].getAttribute('aria-current')).toBeNull()
    expect(within(morning).getByTestId('routine-progress').textContent).toBe('0 of 3 done')
    expect(screen.queryByText('Tomorrow thing')).toBeNull()
  })

  it('a tap completes the step, ticks it with text, moves "next", and Undo puts it back', async () => {
    renderHome(MORNING)
    const morning = routineByName('Morning')
    await userEvent.click(steps(morning)[0])

    expect(calls).toEqual([{ url: '/api/chores/complete', body: { choreId: 'teeth' } }])
    await waitFor(() => expect(steps(morning)[0].getAttribute('data-state')).toBe('waiting'))
    expect(steps(morning)[0].getAttribute('aria-label')).toBe(
      'Brush teeth, step 1 of 3, done, waiting for a parent to check'
    )
    expect(within(steps(morning)[0]).getByText('Done')).toBeTruthy()
    expect((steps(morning)[0] as HTMLButtonElement).disabled).toBe(true)
    expect(steps(morning)[1].getAttribute('aria-current')).toBe('step')
    expect(within(morning).getByTestId('routine-progress').textContent).toBe('1 of 3 done')
    // The existing approval copy.
    expect(screen.getByText('A parent will check it.')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(calls[1]).toEqual({ url: '/api/chores/uncomplete', body: { choreId: 'teeth' } })
    await waitFor(() => expect(steps(morning)[0].getAttribute('aria-current')).toBe('step'))
    expect(within(morning).getByTestId('routine-progress').textContent).toBe('0 of 3 done')
  })

  it('rolls back a refused tap', async () => {
    replies['/api/chores/complete'] = [{ status: 500, body: { error: 'nope' } }]
    renderHome(MORNING)
    const morning = routineByName('Morning')
    await userEvent.click(steps(morning)[0])
    await waitFor(() => expect(steps(morning)[0].getAttribute('data-state')).toBe('next'))
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    // The child is told, instead of the tick silently disappearing.
    expect(await screen.findByText("Couldn't mark it done")).toBeTruthy()
    expect(screen.getByText('nope')).toBeTruthy()
  })

  it('says so when the tap cannot reach the server', async () => {
    replies['/api/chores/complete'] = ['network']
    renderHome(MORNING)
    await userEvent.click(steps(routineByName('Morning'))[0])
    expect(await screen.findByText('Check your connection and try again.')).toBeTruthy()
  })

  it('a failed reward claim shows an error instead of an unhandled rejection', async () => {
    replies['/api/rewards/claim'] = ['network']
    render(
      <FeaturesProvider initial={{ ...defaultFeatures(), gamification: true, rewards: true }}>
        <ToastProvider>
          <KidHome
            user={{ ...user, xp: 20 }}
            chores={[]}
            events={[]}
            rewards={[{ id: 'r1', name: 'Movie night', cost: 10, status: 'available' }]}
          />
        </ToastProvider>
      </FeaturesProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }))
    expect(await screen.findByText("Couldn't claim that")).toBeTruthy()
  })

  it('shows done and checked steps from the server, and "All done" when the routine is finished', () => {
    renderHome([
      { id: 'teeth', title: 'Brush teeth', icon: 'brush-teeth', routine: 'Morning', routine_order: 1, status: 'verified' },
      { id: 'dress', title: 'Get dressed', icon: 'get-dressed', routine: 'Morning', routine_order: 2, status: 'completed' },
    ])
    const morning = routineByName('Morning')
    expect(steps(morning).map((s) => s.getAttribute('aria-label'))).toEqual([
      'Brush teeth, step 1 of 2, done, checked by a parent',
      'Get dressed, step 2 of 2, done, waiting for a parent to check',
    ])
    expect(within(morning).getByTestId('routine-progress').textContent).toBe('All done')
    expect(screen.queryByText('Next')).toBeNull()
    // No "All done for today" card competing with the routine.
    expect(screen.queryByText('All done for today!')).toBeNull()
  })

  it('a step with no picture gets the neutral picture and still its name', () => {
    renderHome([{ id: 'x', title: 'Feed fish', routine: 'Morning', routine_order: 1 }])
    const step = steps(routineByName('Morning'))[0]
    expect(step.querySelector('svg[data-icon="none"]')).toBeTruthy()
    expect(within(step).getByText('Feed fish')).toBeTruthy()
  })

  it('routine steps are not repeated in Today’s Missions; other chores still are', () => {
    renderHome([...MORNING, { id: 'room', title: 'Tidy room' }])
    const missions = screen.getByText('Today’s Missions'.replace('’', "'")).closest('section')!
    expect(within(missions).getByText('Tidy room')).toBeTruthy()
    expect(within(missions).queryByText('Brush teeth')).toBeNull()
  })

  it('a child without routines sees the kid home exactly as before', () => {
    renderHome([{ id: 'room', title: 'Tidy room' }, { id: 'bins', title: 'Bins', icon: 'trash' }])
    expect(screen.queryByTestId('kid-routines')).toBeNull()
    expect(screen.getByText("Today's Missions")).toBeTruthy()
    expect(screen.getByText('Tidy room')).toBeTruthy()
    expect(screen.getByText('Bins')).toBeTruthy()
  })

  it('with nothing at all, the usual all-done card', () => {
    renderHome([])
    expect(screen.getByText('All done for today!')).toBeTruthy()
  })
})
