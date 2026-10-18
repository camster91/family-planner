/**
 * @jest-environment jsdom
 */
// An open chore's actions (Edit, Reassign, Snooze, Mark complete, Delete) are
// behind a visible "⋯" button, not only press and hold, and only the round
// check completes the chore: a tap on the name used to tick it off when a
// parent meant to edit it.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChoresContent from '../ChoresContent'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n'

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
  recurrence_frequency: 'weekly' as const,
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
    for (const label of ['Snooze a day', 'Edit', 'Reassign', 'Mark complete', 'Delete this occurrence']) {
      expect(within(sheet).getByRole('button', { name: label })).toBeTruthy()
    }
    expect(completeCalls()).toHaveLength(0)
  })

  it('keeps occurrence deletion pending and offers an explicit retry after refusal', async () => {
    const user = userEvent.setup()
    let deleteCalls = 0
    let resolveDelete: ((value: unknown) => void) | undefined
    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      if (url === '/api/chores' && init?.method === 'DELETE') {
        deleteCalls += 1
        if (deleteCalls === 1) {
          return new Promise((resolve) => {
            resolveDelete = resolve
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    }) as unknown as typeof fetch

    await user.click(menuButton())
    await user.click(screen.getByRole('button', { name: 'Delete this occurrence' }))
    expect(screen.getByRole('alertdialog', { name: 'Delete this occurrence?' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Delete occurrence' }))
    const deleting = screen.getByRole('button', { name: 'Deleting…' })
    expect((deleting as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'Delete this occurrence?' })).toBeTruthy()
    await user.click(deleting)
    expect(deleteCalls).toBe(1)

    resolveDelete?.({
      ok: false,
      status: 503,
      json: async () => ({}),
    })
    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByRole('alert').textContent).toContain('The server refused this deletion')
    expect(screen.getByText('Feed the cat')).toBeTruthy()
    expect(document.activeElement).toBe(retry)
    await user.click(retry)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(deleteCalls).toBe(2)
  })

  it('does not claim a 404 deletion and requires an explicit authorized readback', async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string; method?: string }> = []
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method })
      if (init?.method === 'DELETE') {
        return { ok: false, status: 404, json: async () => ({ error: 'Chore not found' }) }
      }
      return { ok: false, status: 404, json: async () => ({ error: 'Chore not found' }) }
    }) as unknown as typeof fetch

    await user.click(menuButton())
    await user.click(screen.getByRole('button', { name: 'Delete this occurrence' }))
    await user.click(screen.getByRole('button', { name: 'Delete occurrence' }))
    expect(await screen.findByRole('button', { name: 'Refresh chores' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('This occurrence is no longer available')
    expect(screen.getByText('Feed the cat')).toBeTruthy()
    expect(screen.getByRole('alertdialog')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Refresh chores' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.map((call) => call.method ?? 'GET')).toEqual(['DELETE', 'GET'])
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

  it('lets a parent open the existing edit form with a Once stop draft', async () => {
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
    await user.click(within(sheet).getByRole('button', { name: 'Stop repeating' }))
    expect(mockPush).toHaveBeenCalledWith('/dashboard/chores/edit?id=weekly-c1&stop=1')
    expect(global.fetch).not.toHaveBeenCalledWith('/api/chores', expect.objectContaining({ method: 'PATCH' }))
  })

  it('does not expose Stop repeating to a child or teen', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <ChoresContent
          chores={[recurringChore]}
          familyMembers={[{ id: 'kid', name: 'Casey', role: 'child' }]}
          currentUserId="kid"
          userRole="child"
        />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: 'More actions for “Take out trash”' }))
    const sheet = screen.getByRole('dialog', { name: 'More actions for “Take out trash”' })
    expect(within(sheet).queryByRole('button', { name: 'Stop repeating' })).toBeNull()
  })

  it('uses the typed Spanish occurrence and stop labels', async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider locale="es">
        <ToastProvider>
          <ChoresContent
            chores={[recurringChore]}
            familyMembers={[{ id: 'kid', name: 'Casey', role: 'child' }]}
            currentUserId="parent"
            userRole="parent"
          />
        </ToastProvider>
      </I18nProvider>
    )

    await user.click(screen.getByRole('button', { name: 'More actions for “Take out trash”' }))
    const sheet = screen.getAllByRole('dialog', { name: 'More actions for “Take out trash”' }).at(-1)
    expect(sheet).toBeTruthy()
    expect(within(sheet!).getByRole('button', { name: 'Eliminar esta ocurrencia' })).toBeTruthy()
    expect(within(sheet!).getByRole('button', { name: 'Dejar de repetir' })).toBeTruthy()
  })
})


it('the Routines view uses canonical completion and shows its updated status', async () => {
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'More chore views' }), 'routines')
  await userEvent.click(screen.getByRole('button', { name: 'Complete Feed the cat' }))
  expect(completeCalls()).toHaveLength(1)
  expect(JSON.parse(completeCalls()[0][1].body)).toEqual({ choreId: 'c1' })
  expect(await screen.findByText('Done · awaiting check')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Today' }))
  expect(screen.queryByRole('checkbox', { name: 'Feed the cat' })).toBeNull()
  expect(screen.getByText('All clear!')).toBeTruthy()
})
