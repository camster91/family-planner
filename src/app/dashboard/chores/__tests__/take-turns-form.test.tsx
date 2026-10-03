/**
 * @jest-environment jsdom
 */
// Take turns (O-39) on the chore forms: a switch that shows only for
// repeating chores, an ordered member picker (tap in order, numbers shown, tap
// again to take out, at least two), and what the forms send. The chores list
// shows "Takes turns · next: Alex" on a rotating row.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TakeTurnsPicker } from '@/components/chores/TakeTurnsPicker'
import CreateChorePage from '../create/page'
import EditChorePage from '../edit/page'
import ChoresContent from '../ChoresContent'
import { ToastProvider } from '@/components/ui/toast'

const mockPush = jest.fn()
let mockSearch = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: mockPush }),
  useSearchParams: () => mockSearch,
}))
jest.mock('@/components/providers/features-provider', () => ({
  useFeatureEnabled: () => true,
}))

const members = [
  { id: 'sam', name: 'Sam', role: 'parent' },
  { id: 'alex', name: 'Alex', role: 'teen' },
  { id: 'jo', name: 'Jo', role: 'child' },
]

type Call = { url: string; init?: RequestInit }
let calls: Call[] = []
let choreResponse: Record<string, unknown> = {}

beforeEach(() => {
  calls = []
  mockPush.mockClear()
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url === '/api/family/members') return { ok: true, status: 200, json: async () => ({ members }) }
    if (url.startsWith('/api/chores?id=')) return { ok: true, status: 200, json: async () => choreResponse }
    return { ok: true, status: 200, json: async () => ({ chore: { id: 'new' } }) }
  }) as unknown as typeof fetch
})

const sent = (url: string) => {
  const call = calls.find((c) => c.url === url && c.init?.method)
  return call ? JSON.parse(String(call.init!.body)) : undefined
}

describe('TakeTurnsPicker', () => {
  function Harness() {
    const [on, setOn] = React.useState(false)
    const [order, setOrder] = React.useState<string[]>([])
    return <TakeTurnsPicker members={members} on={on} onToggle={setOn} order={order} onOrderChange={setOrder} />
  }

  it('the switch reveals a picker; taps add people in order with their numbers; a second tap takes them out', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const toggle = screen.getByRole('switch', { name: 'Take turns' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Sam' })).toBeNull()

    await user.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Pick at least 2 people.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Jo' }))
    await user.click(screen.getByRole('button', { name: 'Sam' }))
    expect(screen.getByRole('button', { name: 'Jo, turn 1' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Sam, turn 2' })).toBeTruthy()
    expect(screen.getByText('Order: Jo → Sam → Jo')).toBeTruthy()
    expect(screen.queryByText('Pick at least 2 people.')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Jo, turn 1' }))
    expect(screen.getByRole('button', { name: 'Sam, turn 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Jo' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('member buttons are at least 44px tall', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('switch', { name: 'Take turns' }))
    expect(screen.getByRole('button', { name: 'Alex' }).className).toContain('min-h-[44px]')
    expect(screen.getByRole('switch', { name: 'Take turns' }).className).toContain('min-h-[44px]')
  })
})

describe('New chore form', () => {
  async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
    render(<CreateChorePage />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Sam' })).toBeTruthy())
    await user.type(screen.getByLabelText('Title'), 'Dishes')
    await user.type(screen.getByLabelText('Due Date'), '2099-10-05')
  }

  it('"Take turns" shows only for repeating chores', async () => {
    const user = userEvent.setup()
    await fillBasics(user)
    expect(screen.queryByRole('switch', { name: 'Take turns' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(screen.getByRole('switch', { name: 'Take turns' })).toBeTruthy()
  })

  it('sends the order instead of an assignee, and needs two people', async () => {
    const user = userEvent.setup()
    await fillBasics(user)
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    await user.click(screen.getByRole('switch', { name: 'Take turns' }))
    // The order decides who goes first, so "Assign To" is hidden.
    expect(screen.queryByLabelText('Assign To')).toBeNull()
    const submit = screen.getByRole('button', { name: 'Create Chore' }) as HTMLButtonElement
    const picker = screen.getByRole('group', { name: /Tap people in the order/ })
    await user.click(within(picker).getByRole('button', { name: 'Alex' }))
    expect(submit.disabled).toBe(true)
    await user.click(within(picker).getByRole('button', { name: 'Jo' }))
    expect(submit.disabled).toBe(false)
    await user.click(submit)
    await waitFor(() => expect(sent('/api/chores/create')).toBeDefined())
    const body = sent('/api/chores/create')
    expect(body).toMatchObject({ frequency: 'weekly', rotation: ['alex', 'jo'] })
    expect(body.assigned_to).toBeUndefined()
  })

  it('switching back to Once sends a plain assignment', async () => {
    const user = userEvent.setup()
    await fillBasics(user)
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    await user.click(screen.getByRole('switch', { name: 'Take turns' }))
    await user.click(screen.getByRole('button', { name: 'Once' }))
    await user.click(screen.getByRole('button', { name: 'Create Chore' }))
    await waitFor(() => expect(sent('/api/chores/create')).toBeDefined())
    const body = sent('/api/chores/create')
    expect(body).toMatchObject({ frequency: 'once', assigned_to: 'sam' })
    expect(body.rotation).toBeUndefined()
  })
})

describe('Edit chore form', () => {
  const copy = {
    id: 'copy-1',
    title: 'Dishes',
    description: null,
    points: 10,
    assigned_to: 'alex',
    due_date: '2099-10-12T00:00:00.000Z',
    difficulty: 'easy',
    frequency: 'once',
    recurrence_id: 'tmpl',
    icon: null,
    routine: null,
    routine_order: null,
  }

  beforeEach(() => {
    mockSearch = new URLSearchParams({ id: 'copy-1' })
    choreResponse = { chore: copy, template: { id: 'tmpl', frequency: 'weekly' }, rotation: ['sam', 'alex', 'jo'] }
  })

  it('shows the series order, and a plain save does not send it', async () => {
    const user = userEvent.setup()
    render(<EditChorePage />)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Take turns' })).toBeTruthy())
    expect(screen.getByRole('switch', { name: 'Take turns' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: 'Sam, turn 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Jo, turn 3' })).toBeTruthy()
    // This occurrence's own person can still be changed by hand.
    expect(screen.getByLabelText('This time')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(sent('/api/chores')).toBeDefined())
    expect(sent('/api/chores').rotation).toBeUndefined()
  })

  it('a changed order is sent; turning it off sends null', async () => {
    const user = userEvent.setup()
    render(<EditChorePage />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Alex, turn 2' })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'Alex, turn 2' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(sent('/api/chores')).toBeDefined())
    expect(sent('/api/chores').rotation).toEqual(['sam', 'jo'])

    calls = []
    await user.click(screen.getByRole('switch', { name: 'Take turns' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(sent('/api/chores')).toBeDefined())
    expect(sent('/api/chores').rotation).toBeNull()
  })

  it('a one-person list reads as not taking turns and is left alone', async () => {
    choreResponse = { ...choreResponse, rotation: ['jo'] }
    const user = userEvent.setup()
    render(<EditChorePage />)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Take turns' })).toBeTruthy())
    expect(screen.getByRole('switch', { name: 'Take turns' }).getAttribute('aria-checked')).toBe('false')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(sent('/api/chores')).toBeDefined())
    expect(sent('/api/chores').rotation).toBeUndefined()
  })
})

describe('chores list', () => {
  it('a rotating row says who is next', () => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    render(
      <ToastProvider>
        <ChoresContent
          chores={[
            {
              id: 'c1',
              family_id: 'fam',
              title: 'Dishes',
              points: 10,
              assigned_to: 'sam',
              due_date: `${today}T00:00:00.000Z`,
              status: 'pending',
              frequency: 'once',
              difficulty: 'easy',
              created_at: '2026-09-01T00:00:00.000Z',
              assignee: { name: 'Sam' },
              creator: { name: 'Sam' },
              rotation_next_name: 'Alex',
            },
          ]}
          familyMembers={members}
          currentUserId="sam"
          userRole="parent"
        />
      </ToastProvider>
    )
    expect(screen.getAllByText(/Takes turns · next: Alex/).length).toBeGreaterThan(0)
  })
})
