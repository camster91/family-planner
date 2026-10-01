/**
 * @jest-environment jsdom
 */
// Deleting an event from its edit page: parent-only (DELETE /api/events
// refuses everyone else), behind a confirm dialog, with the server's error
// shown when the delete fails. Imported (subscribed) events are read-only and
// never offer Delete; the API refuses them with 409.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditEventPage from '../edit/page'

const mockPush = jest.fn()
const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => new URLSearchParams('id=ev-1'),
}))

type Call = { url: string; method: string; body: unknown }

function json(status: number, data: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as unknown as Response
}

function mockFetch({
  role = 'parent',
  source = null as null | { subscription_id: string; name: string; color: null },
  deleteStatus = 200,
  deleteBody = { success: true } as unknown,
} = {}) {
  const calls: Call[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/auth/me') return json(200, { user: { id: 'u1', role } })
    if (url.startsWith('/api/events?id=')) {
      return json(200, {
        event: {
          id: 'ev-1',
          title: 'Soccer practice',
          description: null,
          start_time: '2026-10-06T19:00:00.000Z',
          end_time: '2026-10-06T20:00:00.000Z',
          location: null,
          source,
        },
      })
    }
    if (url === '/api/events' && method === 'DELETE') return json(deleteStatus, deleteBody)
    throw new Error(`unexpected ${method} ${url}`)
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  mockPush.mockClear()
  mockRefresh.mockClear()
})

describe('delete event', () => {
  it('a parent confirms, the event is deleted, and the calendar reloads', async () => {
    const calls = mockFetch()
    const user = userEvent.setup()
    render(<EditEventPage />)
    await user.click(await screen.findByRole('button', { name: 'Delete event' }))

    const dialog = screen.getByRole('dialog', { name: 'Delete this event?' })
    expect(within(dialog).getByText(/Soccer practice/)).toBeTruthy()
    // Nothing is deleted until the person confirms.
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard/calendar'))
    expect(mockRefresh).toHaveBeenCalled()
    const del = calls.filter((c) => c.method === 'DELETE')
    expect(del).toEqual([{ url: '/api/events', method: 'DELETE', body: { eventId: 'ev-1' } }])
  })

  it('Cancel closes the dialog without deleting', async () => {
    const calls = mockFetch()
    const user = userEvent.setup()
    render(<EditEventPage />)
    await user.click(await screen.findByRole('button', { name: 'Delete event' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('shows the error and stays put when the delete fails', async () => {
    mockFetch({ deleteStatus: 403, deleteBody: { error: 'Only parents can perform this action' } })
    const user = userEvent.setup()
    render(<EditEventPage />)
    await user.click(await screen.findByRole('button', { name: 'Delete event' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Only parents can perform this action')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it.each(['teen', 'child'])('a %s is not offered Delete', async (role) => {
    const calls = mockFetch({ role })
    render(<EditEventPage />)
    await screen.findByDisplayValue('Soccer practice')
    await waitFor(() => expect(calls.some((c) => c.url === '/api/auth/me')).toBe(true))
    expect(screen.queryByRole('button', { name: 'Delete event' })).toBeNull()
  })

  it('an imported (read-only) event never offers Delete', async () => {
    mockFetch({ source: { subscription_id: 'sub-1', name: 'School', color: null } })
    render(<EditEventPage />)
    await screen.findByText('From School')
    expect(screen.queryByRole('button', { name: 'Delete event' })).toBeNull()
  })
})
