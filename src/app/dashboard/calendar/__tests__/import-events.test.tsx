/**
 * @jest-environment jsdom
 */
// Review-first import UI (#270): the calendar button is hidden unless enabled;
// paste → suggestions → edit → add through POST /api/events (low-confidence
// cards start unticked, added cards leave the list so a retry cannot
// duplicate) → "Added N events" with Undo that removes exactly those ids.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportEventsDialog, UNREADABLE_MESSAGE } from '../ImportEventsDialog'
import CalendarPageClient, { ImportUndoToast } from '../CalendarPageClient'

const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh, push: jest.fn() }) }))
jest.mock('@/components/capture/CaptureBox', () => ({ CaptureBox: () => null }))

type Call = { url: string; method: string; body: unknown; isForm: boolean }

const SUGGESTIONS = [
  { title: 'Picture day', start: '2026-10-02', end: null, allDay: true, location: null, notes: null, confidence: 0.9 },
  {
    title: 'Bake sale', start: '2026-10-09T15:30:00-04:00', end: '2026-10-09T17:00:00-04:00', allDay: false,
    location: 'Gym', notes: 'Bring $2', confidence: 0.7,
  },
  { title: 'Maybe a meeting', start: '2026-10-20', end: null, allDay: true, location: null, notes: null, confidence: 0.3 },
]

function mockFetch({
  suggestStatus = 200,
  suggestBody = { suggestions: SUGGESTIONS, unreadable: false, dropped: 0, timeZone: 'America/Toronto' } as unknown,
  failTitles = [] as string[],
  undoStatus = 200,
} = {}) {
  const calls: Call[] = []
  let n = 0
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
    const body = init?.body && !isForm ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body, isForm })
    const json = (status: number, data: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => data }) as unknown as Response
    if (url === '/api/calendar/import-suggestions') return json(suggestStatus, suggestBody)
    if (url === '/api/events' && method === 'POST') {
      const title = (body as { title: string }).title
      if (failTitles.includes(title)) return json(500, { error: 'Internal server error' })
      n += 1
      return json(200, { event: { id: `ev-${n}`, title } })
    }
    if (url === '/api/calendar/import-suggestions/undo') {
      return undoStatus === 200
        ? json(200, { removedCount: (body as { eventIds: string[] }).eventIds.length })
        : json(undoStatus, { error: { code: 'UNDO_WINDOW_EXPIRED', message: 'It is too late to undo this import.' } })
    }
    return json(404, {})
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return calls
}

async function pasteAndFind(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Text of the email or flyer'), 'Picture day next Friday')
  await user.click(screen.getByRole('button', { name: 'Find events' }))
}

beforeEach(() => mockRefresh.mockReset())

describe('calendar page', () => {
  it('hides the import action unless enabled', () => {
    mockFetch()
    const { rerender } = render(<CalendarPageClient events={[]} currentMonth={10} currentYear={2026} />)
    expect(screen.queryByRole('button', { name: 'Import from text or photo' })).toBeNull()
    rerender(<CalendarPageClient events={[]} currentMonth={10} currentYear={2026} importEnabled />)
    expect(screen.getByRole('button', { name: 'Import from text or photo' })).toBeTruthy()
  })

  it('imports, shows "Added N events" and undoes exactly those events', async () => {
    const user = userEvent.setup()
    const calls = mockFetch()
    render(<CalendarPageClient events={[]} currentMonth={10} currentYear={2026} importEnabled />)
    await user.click(screen.getByRole('button', { name: 'Import from text or photo' }))
    await pasteAndFind(user)
    await user.click(await screen.findByTestId('import-add'))
    const toast = await screen.findByTestId('import-toast')
    expect(within(toast).getByText('Added 2 events')).toBeTruthy()
    expect(screen.queryByTestId('import-dialog')).toBeNull()
    expect(mockRefresh).toHaveBeenCalled()

    await user.click(within(toast).getByRole('button', { name: /Undo/ }))
    expect(await within(toast).findByText('Removed 2 events')).toBeTruthy()
    const undo = calls.find((c) => c.url === '/api/calendar/import-suggestions/undo')!
    expect(undo.body).toEqual({ eventIds: ['ev-1', 'ev-2'] })
    expect(within(toast).queryByRole('button', { name: /Undo/ })).toBeNull()
  })
})

describe('ImportEventsDialog', () => {
  it('sends pasted text with today and zone, and shows editable cards with low confidence unticked', async () => {
    const user = userEvent.setup()
    const calls = mockFetch()
    render(<ImportEventsDialog onClose={jest.fn()} onDone={jest.fn()} />)
    expect(screen.getByTestId('import-privacy-note').textContent).toContain('Anthropic')
    await pasteAndFind(user)
    const cards = await screen.findAllByTestId('import-suggestion')
    expect(cards).toHaveLength(3)
    const req = calls.find((c) => c.url === '/api/calendar/import-suggestions')!
    expect(req.body).toEqual({
      text: 'Picture day next Friday',
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      timeZone: expect.any(String),
    })
    const boxes = cards.map((c) => within(c).getByRole('checkbox', { name: /^Add / }) as HTMLInputElement)
    expect(boxes.map((b) => b.checked)).toEqual([true, true, false])
    expect(cards.map((c) => within(c).getByTestId('import-confidence').textContent)).toEqual(['Likely', 'Check this', 'Unsure'])
    expect((within(cards[1]).getByLabelText('Starts') as HTMLInputElement).value).toBe('15:30')
    expect((within(cards[1]).getByLabelText('Location') as HTMLInputElement).value).toBe('Gym')
    expect(screen.getByTestId('import-add').textContent).toBe('Add 2 events')
  })

  it('adds the edited, ticked events through POST /api/events and reports the created ids', async () => {
    const user = userEvent.setup()
    const calls = mockFetch()
    const onDone = jest.fn()
    render(<ImportEventsDialog onClose={jest.fn()} onDone={onDone} />)
    await pasteAndFind(user)
    const cards = await screen.findAllByTestId('import-suggestion')
    const title = within(cards[1]).getByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'School bake sale')
    await user.click(screen.getByTestId('import-add'))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(['ev-1', 'ev-2']))
    const posts = calls.filter((c) => c.url === '/api/events')
    expect(posts.map((p) => p.body)).toEqual([
      { title: 'Picture day', description: null, start_time: '2026-10-02T04:00:00.000Z', end_time: '2026-10-03T03:59:00.000Z', location: null },
      {
        title: 'School bake sale', description: 'Bring $2', start_time: '2026-10-09T19:30:00.000Z',
        end_time: '2026-10-09T21:00:00.000Z', location: 'Gym',
      },
    ])
  })

  it('keeps a failed card, removes added ones, and a retry sends only what is left', async () => {
    const user = userEvent.setup()
    const calls = mockFetch({ failTitles: ['Bake sale'] })
    const onDone = jest.fn()
    render(<ImportEventsDialog onClose={jest.fn()} onDone={onDone} />)
    await pasteAndFind(user)
    await user.click(await screen.findByTestId('import-add'))
    expect(await screen.findByText(/Added 1 event\. 1 couldn't be added/)).toBeTruthy()
    const left = screen.getAllByTestId('import-suggestion')
    expect(left).toHaveLength(2)
    expect(within(left[0]).getByTestId('import-card-error').textContent).toBe('Internal server error')
    expect(onDone).not.toHaveBeenCalled()

    // Retry: the picture day is not sent again.
    mockFetchKeepCalls(calls)
    await user.click(screen.getByTestId('import-add'))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(['ev-1', 'ev-1b']))
    const titles = calls.filter((c) => c.url === '/api/events').map((c) => (c.body as { title: string }).title)
    expect(titles).toEqual(['Picture day', 'Bake sale', 'Bake sale'])
  })

  it('validates edits before sending anything', async () => {
    const user = userEvent.setup()
    const calls = mockFetch()
    render(<ImportEventsDialog onClose={jest.fn()} onDone={jest.fn()} />)
    await pasteAndFind(user)
    const cards = await screen.findAllByTestId('import-suggestion')
    await user.clear(within(cards[1]).getByLabelText('Starts'))
    await user.click(screen.getByTestId('import-add'))
    expect(await screen.findByText('Fix the highlighted events, then add again.')).toBeTruthy()
    expect(within(cards[1]).getByTestId('import-card-error').textContent).toBe('Enter a start time, or tick All day.')
    expect(calls.filter((c) => c.url === '/api/events')).toHaveLength(0)
  })

  it('shows a clear message when nothing readable was found', async () => {
    const user = userEvent.setup()
    mockFetch({ suggestBody: { suggestions: [], unreadable: true, dropped: 0, timeZone: 'America/Toronto' } })
    render(<ImportEventsDialog onClose={jest.fn()} onDone={jest.fn()} />)
    await pasteAndFind(user)
    expect((await screen.findByTestId('import-empty')).textContent).toBe(UNREADABLE_MESSAGE)
    expect(UNREADABLE_MESSAGE).toBe("We couldn't find any dates in this. Try a clearer photo or paste the text.")
  })

  it('shows the server message for limits and a friendly one when the feature is off', async () => {
    const user = userEvent.setup()
    mockFetch({ suggestStatus: 429, suggestBody: { error: { code: 'RATE_LIMITED', message: 'Too many imports this hour. Try again later.' } } })
    const { unmount } = render(<ImportEventsDialog onClose={jest.fn()} onDone={jest.fn()} />)
    await pasteAndFind(user)
    expect((await screen.findByTestId('import-error')).textContent).toBe('Too many imports this hour. Try again later.')
    unmount()
    mockFetch({ suggestStatus: 404, suggestBody: { error: { code: 'EVENT_IMPORT_DISABLED', message: 'x' } } })
    render(<ImportEventsDialog onClose={jest.fn()} onDone={jest.fn()} />)
    await pasteAndFind(user)
    expect((await screen.findByTestId('import-error')).textContent).toContain("isn't available right now")
  })

  it('uploads a PDF as multipart with the file field', async () => {
    const user = userEvent.setup()
    const calls = mockFetch()
    render(<ImportEventsDialog onClose={jest.fn()} onDone={jest.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Photo or PDF' }))
    const input = screen.getByTestId('import-file-input') as HTMLInputElement
    expect(input.accept).toBe('image/*,application/pdf')
    await user.upload(input, new File(['%PDF-1.7'], 'newsletter.pdf', { type: 'application/pdf' }))
    await screen.findAllByTestId('import-suggestion')
    const req = calls.find((c) => c.url === '/api/calendar/import-suggestions')!
    expect(req.isForm).toBe(true)
  })
})

describe('ImportUndoToast', () => {
  it('stops offering Undo when the server says it is too late', async () => {
    const user = userEvent.setup()
    mockFetch({ undoStatus: 409 })
    render(<ImportUndoToast ids={['ev-1']} addedAt={Date.now()} onDismiss={jest.fn()} onUndone={jest.fn()} />)
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    expect(await screen.findByText('It is too late to undo this import.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
  })

  it('does not offer Undo after the 10-minute window', () => {
    mockFetch()
    render(<ImportUndoToast ids={['ev-1']} addedAt={Date.now() - 11 * 60_000} onDismiss={jest.fn()} onUndone={jest.fn()} />)
    expect(screen.getByText('Added 1 event')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
  })
})

/** Second round of the retry test: every create succeeds, with distinct ids. */
function mockFetchKeepCalls(calls: Call[]) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), body, isForm: false })
    return { ok: true, status: 200, json: async () => ({ event: { id: 'ev-1b', title: body?.title } }) } as unknown as Response
  }) as unknown as typeof fetch
}
