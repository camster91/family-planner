/**
 * @jest-environment jsdom
 */
// O-31: the chores page's default "Today" filter is the viewer's local day,
// which the server (UTC) does not know. The server HTML and the first client
// render show a placeholder for the day-based list, so hydration never
// disagrees; after mount the local "Today" list shows. Also: Reassign opens a
// real dialog (role="dialog", labelled, Escape closes).
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChoresContent from '../ChoresContent'
import { ToastProvider } from '@/components/ui/toast'
import { serverRenderThenHydrate, type Hydrated } from '@/components/ui/__tests__/ssr-hydration'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))

function chore(id: string, title: string, due: string, status: 'pending' | 'completed' = 'pending') {
  return {
    id,
    family_id: 'fam',
    title,
    points: 10,
    assigned_to: 'kid',
    due_date: `${due}T00:00:00.000Z`,
    status,
    frequency: 'once' as const,
    difficulty: 'easy' as const,
    photo_verified: false,
    created_at: '2026-09-01T00:00:00.000Z',
    assignee: { name: 'Casey' },
    creator: { name: 'Pat' },
  }
}

const members = [
  { id: 'kid', name: 'Casey', role: 'child' },
  { id: 'kid2', name: 'Robin', role: 'child' },
]

function page(chores: ReturnType<typeof chore>[]) {
  return (
    <ToastProvider>
      <ChoresContent chores={chores} familyMembers={members} currentUserId="parent" userRole="parent" />
    </ToastProvider>
  )
}

describe('ChoresContent server render vs hydration', () => {
  // Server just before local midnight, browser just after (see ssr-hydration).
  const SERVER_NOW = new Date(2026, 9, 1, 23, 59, 30)
  const CLIENT_NOW = new Date(2026, 9, 2, 0, 0, 30)
  const chores = [
    chore('c1', 'Feed the cat', '2026-10-01'),
    chore('c2', 'Water plants', '2026-10-02'),
    chore('c3', 'Tidy room', '2026-10-02', 'completed'),
  ]
  let hydrated: Hydrated | null = null
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    hydrated?.unmount()
    hydrated = null
    jest.useRealTimers()
  })

  it('server HTML has no day-based list, only a placeholder', () => {
    hydrated = serverRenderThenHydrate(page(chores), { serverNow: SERVER_NOW, clientNow: CLIENT_NOW })
    expect(hydrated.html).toContain('data-testid="chores-pending"')
    expect(hydrated.html).not.toContain('Feed the cat')
    expect(hydrated.html).not.toContain('Water plants')
    expect(hydrated.html).not.toContain(' to do')
    expect(hydrated.html).not.toContain('All clear!')
    // Not day-based: the parent's check queue renders on the server too.
    expect(hydrated.html).toContain('To check')
  })

  it('hydrates with no mismatch, then filters to the local today', () => {
    hydrated = serverRenderThenHydrate(page(chores), { serverNow: SERVER_NOW, clientNow: CLIENT_NOW })
    expect(hydrated.recoverable).toEqual([])
    expect(hydrated.errors).toEqual([])

    expect(screen.queryByTestId('chores-pending')).toBeNull()
    expect(screen.getByText(/^1 to do( · \d+ to check)?$/)).toBeTruthy()
    const today = screen.getByText('Today', { selector: 'p' }).closest('section') as HTMLElement
    expect(within(today).getByText('Water plants')).toBeTruthy()
    expect(within(today).getByText('Casey · Today')).toBeTruthy()
    expect(within(today).queryByText('Feed the cat')).toBeNull()
  })
})

describe('ChoresContent reassign dialog', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    })) as unknown as typeof fetch
  })

  const today = () => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  async function openReassign() {
    const user = userEvent.setup()
    render(page([chore('c1', 'Feed the cat', today())]))
    await user.click(screen.getByRole('button', { name: 'More actions for “Feed the cat”' }))
    await user.click(screen.getByRole('button', { name: 'Reassign' }))
    return user
  }

  it('is a labelled modal dialog with a named close button, and Escape closes it', async () => {
    const user = await openReassign()
    const dialog = await screen.findByRole('dialog', { name: 'Reassign chore' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy()
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('confirms the picked person through PATCH /api/chores', async () => {
    const user = await openReassign()
    const dialog = await screen.findByRole('dialog', { name: 'Reassign chore' })
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: /Robin/ }))
    expect(within(dialog).getByRole('button', { name: /Robin/ }).getAttribute('aria-pressed')).toBe('true')
    await user.click(confirm)
    expect(await screen.findByText('Chore reassigned')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/chores',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ choreId: 'c1', assigned_to: 'kid2' }) })
    )
  })
})

describe('ChoresContent range filter', () => {
  const dayOffset = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() + n)
    const pad = (x: number) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  it('names the picked range in the list heading and marks the picked button', async () => {
    const user = userEvent.setup()
    render(page([chore('c1', 'Feed the cat', dayOffset(0)), chore('c2', 'Water plants', dayOffset(3))]))
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Today', { selector: 'p' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Week' }))
    expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('false')
    const week = screen.getByText('This week', { selector: 'p' }).closest('section') as HTMLElement
    expect(within(week).getByText('Water plants')).toBeTruthy()
    expect(screen.queryByText('Today', { selector: 'p' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('To do', { selector: 'p' })).toBeTruthy()
  })
})
