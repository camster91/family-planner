/**
 * @jest-environment jsdom
 */
// Settings → Connected calendars (#264): hidden while the API is off, and the
// basic connect / choose / sync / disconnect flow against a mocked API.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CalendarSyncSection from '../CalendarSyncSection'

type Call = { url: string; method: string; body: unknown }

const MINE = {
  id: 'conn-1',
  provider: 'google',
  provider_label: 'Google Calendar',
  calendar_id: null,
  calendar_name: null,
  push_mode: 'linked',
  status: 'pending',
  last_synced_at: null,
  last_error: null,
  conflicts_count: 0,
  owner: { id: 'u1', name: 'Pat' },
  is_mine: true,
}

function mockApi(listStatus = 200, connections: unknown[] = [MINE]) {
  const calls: Call[] = []
  const json = (status: number, data: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/calendar/connections')
      return listStatus === 200
        ? json(200, {
            providers: [
              { id: 'google', label: 'Google Calendar' },
              { id: 'microsoft', label: 'Outlook / Microsoft 365' },
            ],
            connections,
          })
        : json(listStatus, { error: 'Not found' })
    if (url.endsWith('/calendars'))
      return json(200, { calendars: [{ id: 'primary', name: 'Home', primary: true }] })
    if (method === 'PATCH')
      return json(200, { connection: { ...MINE, calendar_id: 'primary', calendar_name: 'Home' } })
    if (url.endsWith('/sync'))
      return json(200, {
        result: { status: 'ok', pulled: { created: 2, updated: 0, deleted: 0 }, pushed: { created: 0, updated: 1, deleted: 0 } },
        connection: { ...MINE, calendar_id: 'primary', calendar_name: 'Home', status: 'ok', last_synced_at: new Date().toISOString() },
      })
    if (method === 'DELETE') return json(200, { success: true, removed_events: 2 })
    return json(404, {})
  }) as unknown as typeof fetch
  window.confirm = jest.fn(() => true)
  return calls
}

describe('CalendarSyncSection', () => {
  it('renders nothing while calendar sync is not configured (API 404)', async () => {
    const calls = mockApi(404)
    const { container } = render(<CalendarSyncSection />)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(container.innerHTML).toBe('')
  })

  it('offers only providers not yet connected, lets the owner choose a calendar, sync and disconnect', async () => {
    const calls = mockApi()
    render(<CalendarSyncSection />)
    expect(await screen.findByRole('heading', { name: 'Connected calendars' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Connect Google Calendar/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Connect Outlook/ })).toBeTruthy()
    expect(screen.getByText('Choose a calendar to start syncing.')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Choose calendar for Google Calendar' }))
    expect((await screen.findByLabelText<HTMLSelectElement>('Calendar to sync')).value).toBe('primary')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('Synced: 2 changes in, 1 out.')).toBeTruthy())
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ calendar_id: 'primary' })

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect Google Calendar' }))
    await waitFor(() => expect(screen.getByText('Disconnected Google Calendar.')).toBeTruthy())
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/calendar/sync-connections/conn-1')).toBe(true)
  })

  it("another parent's connection shows who connected it and cannot be reconfigured", async () => {
    mockApi(200, [{ ...MINE, calendar_id: 'primary', calendar_name: 'Work', is_mine: false, owner: { id: 'u2', name: 'Sam' } }])
    render(<CalendarSyncSection />)
    expect(await screen.findByText('Connected by Sam')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Change calendar/ })).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sync Google Calendar now' })).toBeTruthy()
  })
})
