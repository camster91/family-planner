/**
 * @jest-environment jsdom
 */
// Settings -> Recent changes (#285, PR101 D-4): the household audit history in
// plain words, with loading, empty, error (Try again), offline and "Show
// older changes" paging states, keyboard-reachable 44px controls.
import * as React from 'react'
import '@testing-library/jest-dom'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ActivityClient, { ACTIVITY_PAGE_SIZE, type ActivityEntry } from '../ActivityClient'

type Reply = { status: number; body: unknown }
let calls: string[] = []
let reply: (url: string) => Reply | Promise<Reply>

const now = new Date()
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

function entry(id: string, over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id,
    action: 'feature.turned_on',
    actorKind: 'person',
    actor: { id: 'p1', name: 'Robin' },
    summary: `Turned on Wishlist ${id}`,
    createdAt: now.toISOString(),
    ...over,
  }
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

beforeEach(() => {
  calls = []
  setOnline(true)
  reply = () => ({ status: 200, body: { entries: [], nextCursor: null } })
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const { status, body } = await reply(url)
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  }) as unknown as typeof fetch
})

it('shows a loading state, then the entries grouped by day with who and when', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  reply = async () => {
    await gate
    return {
      status: 200,
      body: {
        entries: [
          entry('a', { summary: 'Turned on Wishlist' }),
          entry('b', {
            action: 'board_settings.changed',
            actorKind: 'device',
            summary: 'Changed the Today board settings: weather',
          }),
          entry('c', { actor: null, summary: 'Paired the tablet “Kitchen”', createdAt: yesterday.toISOString() }),
        ],
        nextCursor: null,
      },
    }
  }
  render(<ActivityClient />)
  expect(screen.getByRole('heading', { level: 1, name: 'Recent changes' })).toBeInTheDocument()
  expect(screen.getByTestId('activity-loading')).toBeInTheDocument()
  await act(async () => release())
  expect(await screen.findByText('Turned on Wishlist')).toBeInTheDocument()
  expect(calls).toEqual([`/api/audit?limit=${ACTIVITY_PAGE_SIZE}`])

  const today = screen.getByRole('region', { name: 'Today' })
  const rows = within(today).getAllByTestId('activity-entry')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toHaveTextContent(/Robin ·/)
  expect(rows[1]).toHaveTextContent('Robin, on the family tablet')
  const older = screen.getByRole('region', { name: 'Yesterday' })
  expect(within(older).getByTestId('activity-entry')).toHaveTextContent('A former member')
  expect(screen.getByText(/everything from the last 12 months/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Show older changes' })).not.toBeInTheDocument()
})

it('says so plainly when there are no changes yet', async () => {
  render(<ActivityClient />)
  expect(await screen.findByTestId('activity-empty')).toHaveTextContent('No changes yet')
})

it('shows an error with Try again, which asks again', async () => {
  const user = userEvent.setup()
  reply = () => ({ status: 500, body: { error: 'nope' } })
  render(<ActivityClient />)
  expect(await screen.findByRole('alert')).toHaveTextContent("Recent changes didn't load")
  reply = () => ({ status: 200, body: { entries: [entry('a')], nextCursor: null } })
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Turned on Wishlist a')).toBeInTheDocument()
  expect(calls).toHaveLength(2)
})

it('sends nothing while offline and loads when the connection returns', async () => {
  setOnline(false)
  render(<ActivityClient />)
  expect(await screen.findByTestId('activity-offline')).toHaveTextContent("You're offline")
  expect(calls).toEqual([])
  setOnline(true)
  await act(async () => {
    window.dispatchEvent(new Event('online'))
  })
  await waitFor(() => expect(screen.getByTestId('activity-empty')).toBeInTheDocument())
  expect(calls).toHaveLength(1)
})

it('pages older changes with the cursor, from the keyboard, without duplicates', async () => {
  const user = userEvent.setup()
  reply = (url) =>
    url.includes('cursor=')
      ? { status: 200, body: { entries: [entry('b'), entry('c')], nextCursor: null } }
      : { status: 200, body: { entries: [entry('a'), entry('b')], nextCursor: 'CUR1' } }
  render(<ActivityClient />)
  const more = await screen.findByRole('button', { name: 'Show older changes' })
  expect(more.className).toContain('min-h-[44px]')
  more.focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByText('Turned on Wishlist c')).toBeInTheDocument()
  expect(calls[1]).toBe(`/api/audit?limit=${ACTIVITY_PAGE_SIZE}&cursor=CUR1`)
  expect(screen.getAllByTestId('activity-entry')).toHaveLength(3)
  expect(screen.queryByRole('button', { name: 'Show older changes' })).not.toBeInTheDocument()
})

it('keeps what it has when older changes fail to load, and can retry', async () => {
  const user = userEvent.setup()
  let fail = true
  reply = (url) => {
    if (!url.includes('cursor=')) return { status: 200, body: { entries: [entry('a')], nextCursor: 'CUR1' } }
    return fail ? { status: 500, body: {} } : { status: 200, body: { entries: [entry('z')], nextCursor: null } }
  }
  render(<ActivityClient />)
  await user.click(await screen.findByRole('button', { name: 'Show older changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Older changes didn't load")
  expect(screen.getByText('Turned on Wishlist a')).toBeInTheDocument()
  fail = false
  await user.click(screen.getByRole('button', { name: 'Show older changes' }))
  expect(await screen.findByText('Turned on Wishlist z')).toBeInTheDocument()
})

it('links back to Settings with a 44px target', async () => {
  render(<ActivityClient />)
  const back = screen.getByRole('link', { name: 'Settings' })
  expect(back).toHaveAttribute('href', '/dashboard/settings')
  expect(back.className).toContain('min-h-[44px]')
  await screen.findByTestId('activity-empty')
})

// Authored/unrun follow-through: malformed/late pages must not imply an empty
// or refreshed household history. No database/provider activity in these cases.
it.each([
  { entries: 'not-an-array', nextCursor: null },
  { entries: [entry('bad', { actor: { id: 'p1', name: {} } as any })], nextCursor: null },
  { entries: [entry('duplicate'), entry('duplicate')], nextCursor: null },
  { entries: [] },
  { entries: [], nextCursor: 'CUR1' },
])('shows a recoverable error for a malformed activity page', async (body) => {
  reply = () => ({ status: 200, body })
  render(<ActivityClient />)
  expect(await screen.findByTestId('activity-error')).toBeInTheDocument()
  expect(screen.queryByTestId('activity-empty')).not.toBeInTheDocument()
})

it('retains the loaded page and retries the same cursor when the server repeats it', async () => {
  const user = userEvent.setup()
  let repeated = true
  reply = (url) => !url.includes('cursor=')
    ? { status: 200, body: { entries: [entry('a')], nextCursor: 'CUR1' } }
    : { status: 200, body: { entries: [entry('b')], nextCursor: repeated ? 'CUR1' : null } }
  render(<ActivityClient />)
  await user.click(await screen.findByRole('button', { name: 'Show older changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Older changes didn't load")
  expect(screen.getByText('Turned on Wishlist a')).toBeInTheDocument()
  expect(screen.queryByText('Turned on Wishlist b')).not.toBeInTheDocument()
  repeated = false
  await user.click(screen.getByRole('button', { name: 'Show older changes' }))
  expect(await screen.findByText('Turned on Wishlist b')).toBeInTheDocument()
  expect(calls.slice(1)).toEqual([
    `/api/audit?limit=${ACTIVITY_PAGE_SIZE}&cursor=CUR1`,
    `/api/audit?limit=${ACTIVITY_PAGE_SIZE}&cursor=CUR1`,
  ])
})

it('ignores an old older-page response after reconnection refreshed the history', async () => {
  const user = userEvent.setup()
  let initialReads = 0
  let release!: (response: Reply) => void
  reply = (url) => url.includes('cursor=')
    ? new Promise<Reply>((resolve) => { release = resolve })
    : { status: 200, body: { entries: [entry(++initialReads === 1 ? 'old' : 'fresh')], nextCursor: initialReads === 1 ? 'CUR1' : null } }
  render(<ActivityClient />)
  await user.click(await screen.findByRole('button', { name: 'Show older changes' }))
  setOnline(false)
  await act(async () => { window.dispatchEvent(new Event('offline')) })
  setOnline(true)
  await act(async () => { window.dispatchEvent(new Event('online')) })
  await screen.findByText('Turned on Wishlist fresh')
  await act(async () => {
    release({ status: 200, body: { entries: [entry('stale-older')], nextCursor: null } })
  })
  expect(screen.getByText('Turned on Wishlist fresh')).toBeInTheDocument()
  expect(screen.queryByText('Turned on Wishlist stale-older')).not.toBeInTheDocument()
  expect(screen.queryByText('Turned on Wishlist old')).not.toBeInTheDocument()
})

it('bounds a stalled response body and exposes retry instead of loading forever', async () => {
  jest.useFakeTimers()
  try {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, json: () => new Promise(() => {}),
    } as unknown as Response))
    render(<ActivityClient />)
    await act(async () => { jest.advanceTimersByTime(15000) })
    expect(screen.getByTestId('activity-error')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  } finally {
    jest.useRealTimers()
  }
})
