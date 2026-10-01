/**
 * @jest-environment jsdom
 */
// Notification switches (#286): load, optimistic change with rollback on a
// failed save, keyboard use, 44px targets, and the offline notice.
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NotificationPreferences from '../NotificationPreferences'

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> }

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
const fail = (status = 500) => ({ ok: false, status, json: async () => ({ error: { code: 'INTERNAL_ERROR' } }) }) as Response

function mockFetch(handler: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    }
    calls.push(call)
    return handler(call)
  }) as unknown as typeof fetch
  return calls
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

const ALL_ON = { chores: true, events: true, messages: true }

describe('NotificationPreferences', () => {
  beforeEach(() => setOnline(true))

  it('loads the three switches in plain words, each a 44px switch', async () => {
    const calls = mockFetch(() => ok({ preferences: { ...ALL_ON, events: false } }))
    render(<NotificationPreferences />)
    const chores = await screen.findByRole('switch', { name: 'Chores and rewards' })
    const events = screen.getByRole('switch', { name: 'Calendar events' })
    const messages = screen.getByRole('switch', { name: 'Family messages' })
    expect(chores.getAttribute('aria-checked')).toBe('true')
    expect(events.getAttribute('aria-checked')).toBe('false')
    expect(messages.getAttribute('aria-checked')).toBe('true')
    for (const s of [chores, events, messages]) {
      expect(s.className).toContain('min-h-[44px]')
      expect(s.className).toContain('min-w-[44px]')
    }
    expect(calls).toEqual([expect.objectContaining({ url: '/api/users/preferences', method: 'GET' })])
    expect(screen.getByText(/password resets, email checks, household invites/)).toBeTruthy()
  })

  it('changes at once (optimistic) and saves only that switch, with an Idempotency-Key', async () => {
    const save = deferred<Response>()
    const calls = mockFetch((c) => (c.method === 'GET' ? ok({ preferences: ALL_ON }) : save.promise))
    render(<NotificationPreferences />)
    const chores = await screen.findByRole('switch', { name: 'Chores and rewards' })

    await userEvent.click(chores)
    // Flipped before the server answers, and locked while saving.
    expect(chores.getAttribute('aria-checked')).toBe('false')
    expect((chores as HTMLButtonElement).disabled).toBe(true)
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.url).toBe('/api/users/preferences')
    expect(patch.body).toEqual({ chores: false })
    expect(patch.headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{16,128}$/)

    await act(async () => save.resolve(ok({ preferences: { ...ALL_ON, chores: false } })))
    expect(chores.getAttribute('aria-checked')).toBe('false')
    expect((chores as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('Chores and rewards: off.')).toBeTruthy()
  })

  it('puts the switch back and says so when the save fails', async () => {
    mockFetch((c) => (c.method === 'GET' ? ok({ preferences: ALL_ON }) : fail(500)))
    render(<NotificationPreferences />)
    const messages = await screen.findByRole('switch', { name: 'Family messages' })
    await userEvent.click(messages)
    await waitFor(() => expect(messages.getAttribute('aria-checked')).toBe('true'))
    expect(screen.getByText(/Couldn't save "Family messages". It is back to on. Try again./)).toBeTruthy()
  })

  it('also rolls back when the network drops mid-save', async () => {
    mockFetch((c) => {
      if (c.method === 'GET') return ok({ preferences: ALL_ON })
      throw new TypeError('Failed to fetch')
    })
    render(<NotificationPreferences />)
    const events = await screen.findByRole('switch', { name: 'Calendar events' })
    await userEvent.click(events)
    await waitFor(() => expect(events.getAttribute('aria-checked')).toBe('true'))
    expect(screen.getByText(/It is back to on/)).toBeTruthy()
  })

  it('works from the keyboard: Tab to a switch, Space or Enter toggles it', async () => {
    const calls = mockFetch((c) =>
      c.method === 'GET' ? ok({ preferences: ALL_ON }) : ok({ preferences: { ...ALL_ON, ...(c.body as object) } })
    )
    render(<NotificationPreferences />)
    await screen.findByRole('switch', { name: 'Chores and rewards' })
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('switch', { name: 'Chores and rewards' }))
    await userEvent.keyboard(' ')
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1))
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('switch', { name: 'Calendar events' }))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2))
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ chores: false }, { events: false }])
  })

  it('offline: shows a notice and does not try to save', async () => {
    const calls = mockFetch(() => ok({ preferences: ALL_ON }))
    render(<NotificationPreferences />)
    const chores = await screen.findByRole('switch', { name: 'Chores and rewards' })
    setOnline(false)
    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText(/You're offline/)).toBeTruthy()
    expect((chores as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(chores)
    expect(chores.getAttribute('aria-checked')).toBe('true')
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)

    setOnline(true)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByText(/You're offline/)).toBeNull()
    expect((chores as HTMLButtonElement).disabled).toBe(false)
  })

  it('a failed load offers Try again', async () => {
    let first = true
    mockFetch(() => {
      if (first) {
        first = false
        return fail(500)
      }
      return ok({ preferences: ALL_ON })
    })
    render(<NotificationPreferences />)
    expect(await screen.findByText("Couldn't load your notification settings.")).toBeTruthy()
    const retry = screen.getByRole('button', { name: 'Try again' })
    expect(retry.className).toContain('min-h-[44px]')
    await userEvent.click(retry)
    expect(await screen.findByRole('switch', { name: 'Family messages' })).toBeTruthy()
  })

  describe('quiet hours (#141, O-32)', () => {
    const QUIET_OFF = { enabled: false, start: '22:00', end: '07:00', timeZone: null }
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

    it('shows an Off switch and labelled From/Until times (old servers without quietHours read as off)', async () => {
      mockFetch(() => ok({ preferences: ALL_ON }))
      render(<NotificationPreferences />)
      const sw = await screen.findByRole('switch', { name: 'Quiet hours' })
      expect(sw.getAttribute('aria-checked')).toBe('false')
      expect(sw.className).toContain('min-h-[44px]')
      const from = screen.getByLabelText('Quiet from') as HTMLInputElement
      const until = screen.getByLabelText('Quiet until') as HTMLInputElement
      expect(from.type).toBe('time')
      expect(from.value).toBe('22:00')
      expect(until.value).toBe('07:00')
      expect(from.className).toContain('min-h-[44px]')
    })

    it("turning it on saves the whole setting with this browser's time zone", async () => {
      const calls = mockFetch((c) =>
        c.method === 'GET'
          ? ok({ preferences: ALL_ON, quietHours: QUIET_OFF })
          : ok({ preferences: ALL_ON, quietHours: (c.body as { quietHours: unknown }).quietHours })
      )
      render(<NotificationPreferences />)
      const sw = await screen.findByRole('switch', { name: 'Quiet hours' })
      await userEvent.click(sw)
      await waitFor(() => expect(screen.getByText('Quiet hours: on, 22:00 to 07:00.')).toBeTruthy())
      expect(sw.getAttribute('aria-checked')).toBe('true')
      const patch = calls.find((c) => c.method === 'PATCH')!
      expect(patch.body).toEqual({ quietHours: { enabled: true, start: '22:00', end: '07:00', timeZone: zone } })
      expect(patch.headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    })

    it('Save times saves new times; equal times are refused with an alert and nothing is sent', async () => {
      const calls = mockFetch((c) =>
        c.method === 'GET'
          ? ok({ preferences: ALL_ON, quietHours: { ...QUIET_OFF, enabled: true } })
          : ok({ preferences: ALL_ON, quietHours: (c.body as { quietHours: unknown }).quietHours })
      )
      render(<NotificationPreferences />)
      const from = (await screen.findByLabelText('Quiet from')) as HTMLInputElement
      const until = screen.getByLabelText('Quiet until') as HTMLInputElement
      const save = screen.getByRole('button', { name: 'Save times' }) as HTMLButtonElement
      expect(save.disabled).toBe(true)

      await userEvent.clear(until)
      await userEvent.type(until, '22:00')
      expect(save.disabled).toBe(false)
      await userEvent.click(save)
      expect(screen.getByRole('alert').textContent).toMatch(/must be different/)
      expect(until.getAttribute('aria-invalid')).toBe('true')
      expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)

      await userEvent.clear(from)
      await userEvent.type(from, '21:30')
      await userEvent.click(save)
      await waitFor(() => expect(screen.getByText('Quiet hours: on, 21:30 to 22:00.')).toBeTruthy())
      expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
        { quietHours: { enabled: true, start: '21:30', end: '22:00', timeZone: zone } },
      ])
    })

    it('puts the switch back and says so when the save fails', async () => {
      mockFetch((c) => (c.method === 'GET' ? ok({ preferences: ALL_ON, quietHours: QUIET_OFF }) : fail(500)))
      render(<NotificationPreferences />)
      const sw = await screen.findByRole('switch', { name: 'Quiet hours' })
      await userEvent.click(sw)
      await waitFor(() => expect(screen.getByText(/Couldn't save quiet hours. They are back to off./)).toBeTruthy())
      expect(sw.getAttribute('aria-checked')).toBe('false')
    })
  })
})
