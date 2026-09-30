/**
 * @jest-environment jsdom
 */
// Home summary (#268): one sentence for the viewer, and their own chores due
// today ticked in place with an optimistic update, Undo and rollback.
import * as React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomeSummary, { type HomeSummaryProps } from '../HomeSummary'
import { ToastProvider } from '@/components/ui/toast'
import { toDateOnlyLocal } from '@/lib/dates'

const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: jest.fn() }),
}))

const TODAY = toDateOnlyLocal(new Date())
const members = [
  { id: 'p', name: 'Pat Parent' },
  { id: 'c', name: 'Casey Kid' },
  { id: 't', name: 'Taylor Teen' },
]

type Reply = { status: number; body?: unknown } | 'network'
let replies: Record<string, Reply[]> = {}
let calls: { url: string; body: unknown }[] = []

function reply(url: string, ...r: Reply[]) {
  replies[url] = [...(replies[url] ?? []), ...r]
}

beforeEach(() => {
  replies = {}
  calls = []
  mockRefresh.mockClear()
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const next = replies[url]?.shift() ?? { status: 200, body: { success: true } }
    if (next === 'network') throw new TypeError('Failed to fetch')
    return { ok: next.status < 300, status: next.status, json: async () => next.body ?? {} } as Response
  }) as unknown as typeof fetch
})

function renderSummary(props: Partial<HomeSummaryProps> & Pick<HomeSummaryProps, 'viewer'>) {
  return render(
    <ToastProvider>
      <HomeSummary chores={[]} members={members} toCheckCount={0} choresHref={null} {...props} />
    </ToastProvider>
  )
}

const sentence = () => screen.getByTestId('home-summary-sentence').textContent

describe('HomeSummary sentence', () => {
  it('parent: one household sentence, no progress ring, and a way to all chores', () => {
    renderSummary({
      viewer: { id: 'p', role: 'parent' },
      chores: [
        { id: '1', title: 'Feed cat', dueDay: TODAY, status: 'pending', assigneeId: 'c' },
        { id: '2', title: 'Dishes', dueDay: TODAY, status: 'pending', assigneeId: 'c' },
        { id: '3', title: 'Bins', dueDay: TODAY, status: 'pending', assigneeId: 't' },
      ],
      toCheckCount: 2,
      choresHref: '/dashboard/chores',
    })
    expect(sentence()).toBe('3 chores left today · Casey 2, Taylor 1')
    // The parent has none of their own due, so no list and no contradicting empty state.
    expect(screen.queryByTestId('my-chores')).toBeNull()
    expect(screen.queryByText(/All done/)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByRole('link', { name: /2 chores to check/ }).getAttribute('href')).toBe('/dashboard/chores')
    expect(screen.getByRole('link', { name: /All chores/ }).getAttribute('href')).toBe('/dashboard/chores')
  })

  it("member: their own count, or done for today", () => {
    const { unmount } = renderSummary({
      viewer: { id: 'c', role: 'child' },
      chores: [
        { id: '1', title: 'Feed cat', dueDay: TODAY, status: 'pending', assigneeId: 'c' },
        { id: '2', title: 'Dishes', dueDay: TODAY, status: 'in_progress', assigneeId: 'c' },
        { id: '3', title: 'Bins', dueDay: TODAY, status: 'pending', assigneeId: 't' },
      ],
    })
    expect(sentence()).toBe('You have 2 chores left')
    expect(within(screen.getByTestId('my-chores')).getAllByRole('checkbox')).toHaveLength(2)
    // A child cannot open /dashboard/chores, so there is no link to it.
    expect(screen.queryByRole('link')).toBeNull()
    unmount()

    renderSummary({
      viewer: { id: 'c', role: 'child' },
      chores: [{ id: '1', title: 'Feed cat', dueDay: TODAY, status: 'completed', assigneeId: 'c' }],
    })
    expect(sentence()).toBe("You're done for today")
  })
})

describe('HomeSummary chore tick', () => {
  const feedCat = { id: 'ch1', title: 'Feed cat', dueDay: TODAY, status: 'pending', assigneeId: 'c' }

  it('ticks optimistically, calls the complete API, and Undo reopens it', async () => {
    const user = userEvent.setup()
    let resolveComplete!: () => void
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init!.body)) })
      if (String(input) === '/api/chores/complete') {
        return new Promise((resolve) => {
          resolveComplete = () => resolve({ ok: true, status: 200, json: async () => ({ success: true }) } as Response)
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) } as Response)
    }) as unknown as typeof fetch

    renderSummary({ viewer: { id: 'c', role: 'child' }, chores: [feedCat] })
    const box = screen.getByRole('checkbox', { name: /Feed cat/ })
    await user.click(box)

    // Checked before the server answers.
    expect(box.getAttribute('aria-checked')).toBe('true')
    expect(sentence()).toBe("You're done for today")
    // A child's tick waits for a parent to check it.
    expect(box.textContent).toContain('waiting for a parent to check')
    expect(calls[0]).toEqual({ url: '/api/chores/complete', body: { choreId: 'ch1' } })

    await act(async () => resolveComplete())
    const toast = await screen.findByTestId('undo-toast')
    expect(toast.textContent).toContain('“Feed cat” done')
    expect(toast.textContent).toContain('A parent will check it.')
    expect(mockRefresh).toHaveBeenCalled()

    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.map((c) => c.url)).toContain('/api/chores/uncomplete'))
    expect(calls.find((c) => c.url === '/api/chores/uncomplete')!.body).toEqual({ choreId: 'ch1' })
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Feed cat/ }).getAttribute('aria-checked')).toBe('false'))
    expect(sentence()).toBe('You have 1 chore left')
    expect(screen.queryByTestId('undo-toast')).toBeNull()
  })

  it('rolls back with a clear message when the server refuses', async () => {
    const user = userEvent.setup()
    reply('/api/chores/complete', { status: 403, body: { error: 'Forbidden' } })
    renderSummary({ viewer: { id: 'c', role: 'child' }, chores: [feedCat] })
    await user.click(screen.getByRole('checkbox', { name: /Feed cat/ }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn\'t mark “Feed cat” done')
    expect(alert.textContent).toContain('Forbidden')
    expect(screen.getByRole('checkbox', { name: /Feed cat/ }).getAttribute('aria-checked')).toBe('false')
    expect(sentence()).toBe('You have 1 chore left')
    expect(screen.queryByTestId('undo-toast')).toBeNull()
  })

  it('rolls back when offline', async () => {
    const user = userEvent.setup()
    reply('/api/chores/complete', 'network')
    renderSummary({ viewer: { id: 'c', role: 'child' }, chores: [feedCat] })
    await user.click(screen.getByRole('checkbox', { name: /Feed cat/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Check your connection')
    expect(screen.getByRole('checkbox', { name: /Feed cat/ }).getAttribute('aria-checked')).toBe('false')
  })

  it('keeps the chore done when Undo fails (a parent already checked it)', async () => {
    const user = userEvent.setup()
    reply('/api/chores/uncomplete', {
      status: 409,
      body: { error: 'A parent has already checked this chore, so it stays done.', code: 'CHORE_ALREADY_VERIFIED' },
    })
    renderSummary({ viewer: { id: 'c', role: 'child' }, chores: [feedCat] })
    await user.click(screen.getByRole('checkbox', { name: /Feed cat/ }))
    await user.click(within(await screen.findByTestId('undo-toast')).getByRole('button', { name: 'Undo' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('already checked')
    expect(screen.getByRole('checkbox', { name: /Feed cat/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('unticking a done chore reopens it without a confirm dialog', async () => {
    const user = userEvent.setup()
    window.confirm = jest.fn(() => false)
    renderSummary({
      viewer: { id: 'p', role: 'parent' },
      chores: [{ id: 'mine', title: 'Pay bills', dueDay: TODAY, status: 'completed', assigneeId: 'p' }],
    })
    const box = screen.getByRole('checkbox', { name: /Pay bills/ })
    expect(box.textContent).toContain('Done')
    await user.click(box)
    await waitFor(() => expect(calls.map((c) => c.url)).toEqual(['/api/chores/uncomplete']))
    expect(window.confirm).not.toHaveBeenCalled()
    expect(box.getAttribute('aria-checked')).toBe('false')
  })

  it('shows a chore a parent already checked as done and not toggleable', async () => {
    const user = userEvent.setup()
    renderSummary({
      viewer: { id: 'c', role: 'child' },
      chores: [{ id: 'v', title: 'Tidy room', dueDay: TODAY, status: 'verified', assigneeId: 'c' }],
    })
    const box = screen.getByRole('checkbox', { name: /Tidy room/ })
    expect(box.getAttribute('aria-disabled')).toBe('true')
    expect(box.textContent).toContain('Checked by a parent')
    await user.click(box)
    expect(calls).toHaveLength(0)
  })
})
