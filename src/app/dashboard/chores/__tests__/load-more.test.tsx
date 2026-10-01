/**
 * @jest-environment jsdom
 */
// Chores page history paging (O-19): older verified chores arrive one page at a
// time through GET /api/chores?status=verified&limit=&cursor=. "Load more" sits
// in the Done section under "All", appends without duplicates, and shows an
// error with a retry when a page fails.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChoresContent from '../ChoresContent'
import { ToastProvider } from '@/components/ui/toast'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))

type Reply = { status: number; body?: unknown } | 'network'
let replies: Reply[] = []
let urls: string[] = []

beforeEach(() => {
  replies = []
  urls = []
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input))
    const next = replies.shift() ?? {
      status: 200,
      body: { chores: [], nextCursor: null },
    }
    if (next === 'network') throw new TypeError('Failed to fetch')
    return {
      ok: next.status < 300,
      status: next.status,
      json: async () => next.body ?? {},
    } as Response
  }) as unknown as typeof fetch
})

afterEach(() => jest.restoreAllMocks())

function verifiedChore(id: string, title: string, day: string) {
  return {
    id,
    family_id: 'fam',
    title,
    points: 5,
    assigned_to: 'kid',
    due_date: `${day}T00:00:00.000Z`,
    status: 'verified' as const,
    frequency: 'once' as const,
    difficulty: 'easy' as const,
    photo_verified: false,
    completed_at: `${day}T10:00:00.000Z`,
    created_at: `${day}T00:00:00.000Z`,
    assignee: { name: 'Casey' },
    creator: { name: 'Pat' },
  }
}

function renderPage(historyCursor: string | null) {
  return render(
    <ToastProvider>
      <ChoresContent
        chores={[verifiedChore('a', 'Old dishes', '2026-01-02')]}
        familyMembers={[{ id: 'kid', name: 'Casey', role: 'child' }]}
        currentUserId="parent"
        userRole="parent"
        historyCursor={historyCursor}
      />
    </ToastProvider>,
  )
}

async function openAllDone(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'All' }))
  await user.click(screen.getByRole('button', { name: /Done/ }))
}

describe('ChoresContent history paging', () => {
  it('loads the next page with the cursor, appends it once, and hides the button on the last page', async () => {
    const user = userEvent.setup()
    replies.push({
      status: 200,
      body: {
        chores: [verifiedChore('a', 'Old dishes', '2026-01-02'), verifiedChore('b', 'Old laundry', '2026-01-03')],
        nextCursor: null,
      },
    })
    renderPage('cur1')
    // Not offered under Today: history is only visible under All.
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    await openAllDone(user)

    const button = screen.getByRole('button', { name: 'Load more' })
    expect(button.className).toEqual(expect.stringContaining('btn-tinted'))
    expect(button.className).toEqual(expect.stringContaining('min-h-[44px]'))
    await user.click(button)

    expect(await screen.findByText('Old laundry')).toBeTruthy()
    expect(screen.getAllByText('Old dishes')).toHaveLength(1)
    const url = new URL(urls[0], 'http://x')
    expect(url.pathname).toBe('/api/chores')
    expect(url.searchParams.get('status')).toBe('verified')
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.get('cursor')).toBe('cur1')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull())
  })

  it('shows an error and retries with the same cursor when a page fails', async () => {
    const user = userEvent.setup()
    replies.push({ status: 500, body: { error: 'Internal server error' } })
    replies.push({
      status: 200,
      body: {
        chores: [verifiedChore('b', 'Old laundry', '2026-01-03')],
        nextCursor: 'cur2',
      },
    })
    renderPage('cur1')
    await openAllDone(user)

    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load more chores.")
    expect(screen.queryByText('Old laundry')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Old laundry')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(urls.map((u) => new URL(u, 'http://x').searchParams.get('cursor'))).toEqual(['cur1', 'cur1'])
    // More pages remain.
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy()
  })

  it('shows no button when everything is loaded', async () => {
    const user = userEvent.setup()
    renderPage(null)
    await openAllDone(user)
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })
})
