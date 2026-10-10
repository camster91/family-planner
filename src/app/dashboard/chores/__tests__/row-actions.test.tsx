/**
 * @jest-environment jsdom
 */
// An open chore's actions (Edit, Reassign, Snooze, Mark complete, Delete) are
// behind a visible "⋯" button, not only press and hold, and only the round
// check completes the chore: a tap on the name used to tick it off when a
// parent meant to edit it.
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChoresContent from '../ChoresContent'
import { ToastProvider } from '@/components/ui/toast'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: mockPush }),
}))

function today() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const chore = {
  id: 'c1',
  family_id: 'fam',
  title: 'Feed the cat',
  points: 10,
  assigned_to: 'kid',
  due_date: `${today()}T00:00:00.000Z`,
  status: 'pending' as const,
  frequency: 'once' as const,
  difficulty: 'easy' as const,
  photo_verified: false,
  created_at: '2026-09-01T00:00:00.000Z',
  assignee: { name: 'Casey' },
  creator: { name: 'Pat' },
}
const recurringChore = {
  ...chore,
  id: 'weekly-c1',
  title: 'Take out trash',
  recurrence_id: 'weekly-template',
}

const completeCalls = () =>
  (global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/chores/complete')

beforeEach(() => {
  mockPush.mockClear()
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  })) as unknown as typeof fetch
  render(
    <ToastProvider>
      <ChoresContent
        chores={[chore]}
        familyMembers={[{ id: 'kid', name: 'Casey', role: 'child' }]}
        currentUserId="parent"
        userRole="parent"
      />
    </ToastProvider>
  )
})

const menuButton = () => screen.getByRole('button', { name: 'More actions for “Feed the cat”' })

describe('chore row actions', () => {
  it('shows a named "More actions" button that opens the action sheet', async () => {
    const user = userEvent.setup()
    expect(menuButton().getAttribute('aria-haspopup')).toBe('dialog')
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
    await user.click(menuButton())
    const sheet = screen.getByRole('dialog', { name: 'More actions for “Feed the cat”' })
    for (const label of ['Snooze a day', 'Edit', 'Reassign', 'Mark complete', 'Delete']) {
      expect(within(sheet).getByRole('button', { name: label })).toBeTruthy()
    }
    expect(completeCalls()).toHaveLength(0)
  })

  it('Edit goes to the edit page without completing the chore', async () => {
    const user = userEvent.setup()
    await user.click(menuButton())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(mockPush).toHaveBeenCalledWith('/dashboard/chores/edit?id=c1')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(completeCalls()).toHaveLength(0)
  })

  it('a tap on the title does not complete the chore', async () => {
    const user = userEvent.setup()
    await user.click(screen.getByText('Feed the cat'))
    await user.click(screen.getByText(/^Casey · /))
    expect(completeCalls()).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the check, named by the title, completes the chore', async () => {
    const user = userEvent.setup()
    const box = screen.getByRole('checkbox', { name: 'Feed the cat' })
    expect(box.getAttribute('aria-checked')).toBe('false')
    await user.click(box)
    expect(completeCalls()).toHaveLength(1)
    expect(JSON.parse(completeCalls()[0][1].body)).toEqual({ choreId: 'c1' })
  })

  it('explains that snooze is unavailable for recurring occurrences', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <ChoresContent
          chores={[recurringChore]}
          familyMembers={[{ id: 'kid', name: 'Casey', role: 'child' }]}
          currentUserId="parent"
          userRole="parent"
        />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: 'More actions for “Take out trash”' }))
    const sheet = screen.getByRole('dialog', { name: 'More actions for “Take out trash”' })
    expect(
      (within(sheet).getByRole('button', { name: 'Snooze unavailable for repeating chores' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(global.fetch).not.toHaveBeenCalledWith('/api/chores', expect.anything())
  })
})


it('the Routines view uses canonical completion and shows its updated status', async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Routines' }))
  await userEvent.click(screen.getByRole('button', { name: 'Complete Feed the cat' }))
  expect(completeCalls()).toHaveLength(1)
  expect(JSON.parse(completeCalls()[0][1].body)).toEqual({ choreId: 'c1' })
  expect(await screen.findByText('Done · awaiting check')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Chore list' }))
  expect(screen.getByText('All clear!')).toBeTruthy()
})
