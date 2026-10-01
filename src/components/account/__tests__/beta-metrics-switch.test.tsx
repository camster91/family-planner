/**
 * @jest-environment jsdom
 */
// Beta usage counts switch (#287): label and description, 44px switch,
// optimistic change with rollback on a failed save, keyboard use, the
// offline notice, and that Settings shows it only when the page passes it
// (parents).
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BetaMetricsSwitch from '../BetaMetricsSwitch'
import SettingsClient from '@/app/dashboard/settings/SettingsClient'

// SettingsClient refreshes the server layout after a profile save.
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  ),
}))

type Call = { url: string; method: string; body: unknown }

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
const fail = (status = 500) => ({ ok: false, status, json: async () => ({ error: 'x' }) }) as Response

function mockFetch(handler: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    return handler(call)
  }) as unknown as typeof fetch
  return calls
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

const NAME = 'Share beta usage counts'

describe('BetaMetricsSwitch', () => {
  beforeEach(() => setOnline(true))

  it('shows the stored state as a labelled, described 44px switch, and links to the privacy page', () => {
    mockFetch(() => ok({}))
    render(<BetaMetricsSwitch initialEnabled={false} />)
    const sw = screen.getByRole('switch', { name: NAME })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.className).toContain('min-h-[44px]')
    expect(sw.className).toContain('min-w-[44px]')
    const desc = document.getElementById(sw.getAttribute('aria-describedby')!)!
    expect(desc.textContent).toMatch(/Only numbers: no names, messages or other content/)
    expect(desc.textContent).toMatch(/turning it off deletes the counts/)
    expect(screen.getByRole('link', { name: 'What is counted' }).getAttribute('href')).toBe('/privacy#beta-usage-counts')
    // The state is in words too, not colour only.
    expect(sw.textContent).toContain('Off')
  })

  it('changes at once (optimistic) and saves { enabled }', async () => {
    const save = deferred<Response>()
    const calls = mockFetch(() => save.promise)
    render(<BetaMetricsSwitch initialEnabled={false} />)
    const sw = screen.getByRole('switch', { name: NAME })
    await userEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect((sw as HTMLButtonElement).disabled).toBe(true)
    expect(calls).toEqual([{ url: '/api/family/beta-metrics', method: 'PATCH', body: { enabled: true } }])
    await act(async () => save.resolve(ok({ betaMetrics: { enabled: true } })))
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect((sw as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('Beta usage counts: on.')).toBeTruthy()
  })

  it('turning it off says the counts were deleted', async () => {
    mockFetch(() => ok({ betaMetrics: { enabled: false } }))
    render(<BetaMetricsSwitch initialEnabled />)
    await userEvent.click(screen.getByRole('switch', { name: NAME }))
    expect(await screen.findByText('Beta usage counts: off. The stored counts were deleted.')).toBeTruthy()
  })

  it('puts the switch back and says so when the save fails', async () => {
    mockFetch(() => fail(500))
    render(<BetaMetricsSwitch initialEnabled />)
    const sw = screen.getByRole('switch', { name: NAME })
    await userEvent.click(sw)
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'))
    expect(screen.getByText("Couldn't save. It is back to on. Try again.")).toBeTruthy()
  })

  it('also rolls back when the network drops mid-save', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    render(<BetaMetricsSwitch initialEnabled={false} />)
    const sw = screen.getByRole('switch', { name: NAME })
    await userEvent.click(sw)
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'))
    expect(screen.getByText(/It is back to off/)).toBeTruthy()
  })

  it('works from the keyboard', async () => {
    const calls = mockFetch((c) => ok({ betaMetrics: c.body }))
    render(<BetaMetricsSwitch initialEnabled={false} />)
    await userEvent.tab()
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('switch', { name: NAME }))
    await userEvent.keyboard(' ')
    await waitFor(() => expect(calls).toHaveLength(1))
    await waitFor(() => expect((document.activeElement as HTMLButtonElement).disabled).toBe(false))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls.map((c) => c.body)).toEqual([{ enabled: true }, { enabled: false }])
  })

  it('offline: shows a notice and does not try to save', async () => {
    const calls = mockFetch(() => ok({ betaMetrics: { enabled: true } }))
    render(<BetaMetricsSwitch initialEnabled={false} />)
    const sw = screen.getByRole('switch', { name: NAME })
    setOnline(false)
    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText(/You're offline/)).toBeTruthy()
    expect((sw as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(calls).toHaveLength(0)
    setOnline(true)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect((sw as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('Settings -> Privacy & Security', () => {
  beforeAll(() => {
    window.matchMedia =
      window.matchMedia ||
      ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia)
  })

  function api() {
    mockFetch((c) =>
      c.url === '/api/users'
        ? ok({ user: { name: 'Pat', email: 'pat@example.test', role: 'parent', age: null } })
        : ({ ok: false, status: 404, json: async () => ({}) } as Response)
    )
  }

  it('shows the switch when the page passes the household value (a parent)', async () => {
    api()
    render(<SettingsClient sharedDevice={null} betaMetrics={{ enabled: true }} />)
    expect(await screen.findByRole('heading', { name: 'Privacy & Security' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: NAME }).getAttribute('aria-checked')).toBe('true')
  })

  it('has no switch without it (not a parent)', async () => {
    api()
    render(<SettingsClient sharedDevice={null} />)
    expect(await screen.findByRole('heading', { name: 'Privacy & Security' })).toBeTruthy()
    expect(screen.queryByRole('switch', { name: NAME })).toBeNull()
  })
})
