/**
 * @jest-environment jsdom
 */
// Review-first import UI (#270): the calendar button is hidden unless enabled;
// paste → suggestions → edit → one commit request with an Idempotency-Key per
// batch (low-confidence cards start unticked; a retry after a lost response
// reuses the key so the server replays instead of adding twice) → "Added N
// events" with Undo that sends the signed undo token. The dialog traps focus,
// moves it in on open and returns it to the opener on close.
jest.mock('../CalendarPlanner',()=>({CalendarPlanner:()=>null}))
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportEventsDialog, UNREADABLE_MESSAGE } from '../ImportEventsDialog'
import CalendarPageClient, { ImportUndoToast } from '../CalendarPageClient'

const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh, push: jest.fn() }) }))
jest.mock('@/components/capture/CaptureBox', () => ({ CaptureBox: () => null }))

type Call = { url: string; method: string; body: unknown; isForm: boolean; headers: Record<string, string> }

const SUGGESTIONS = [
  { title: 'Picture day', start: '2026-10-02', end: null, allDay: true, location: null, notes: null, confidence: 0.9 },
  {
    title: 'Bake sale', start: '2026-10-09T15:30:00-04:00', end: '2026-10-09T17:00:00-04:00', allDay: false,
    location: 'Gym', notes: 'Bring $2', confidence: 0.7,
  },
  { title: 'Maybe a meeting', start: '2026-10-20', end: null, allDay: true, location: null, notes: null, confidence: 0.3 },
]

function commitResult(count: number) {
  return {
    eventIds: Array.from({ length: count }, (_, i) => `ev-${i + 1}`),
    count,
    undoToken: 'v1.signed.token',
    undoExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  }
}

function mockFetch({
  suggestStatus = 200,
  suggestBody = { suggestions: SUGGESTIONS, unreadable: false, dropped: 0, timeZone: 'America/Toronto' } as unknown,
  /** Commit outcomes in order: a status, or 'network' for a lost response. Then 201. */
  commitOutcomes = [] as Array<number | 'network'>,
  undoStatus = 200,
} = {}) {
  const calls: Call[] = []
  const outcomes = [...commitOutcomes]
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
    const body = init?.body && !isForm ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body, isForm, headers: (init?.headers ?? {}) as Record<string, string> })
    const json = (status: number, data: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => data }) as unknown as Response
    if (url === '/api/calendar/import-suggestions') return json(suggestStatus, suggestBody)
    if (url === '/api/calendar/import-suggestions/commit') {
      const next = outcomes.shift()
      if (next === 'network') throw new TypeError('Failed to fetch')
      if (typeof next === 'number') return json(next, { error: { code: 'X', message: `Server said ${next}` } })
      return json(201, commitResult((body as { events: unknown[] }).events.length))
    }
    if (url === '/api/calendar/import-suggestions/undo') {
      return undoStatus === 200
        ? json(200, { removedCount: 2 })
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

const commits = (calls: Call[]) => calls.filter((c) => c.url === '/api/calendar/import-suggestions/commit')

beforeEach(() => mockRefresh.mockReset())

describe('calendar page', () => {
  it('hides the import action unless enabled', () => {
    mockFetch()
    const { rerender } = render(<CalendarPageClient events={[]} currentMonth={10} currentYear={2026} />)
    expect(screen.queryByRole('button', { name: 'Import from text or photo' })).toBeNull()
    rerender(<CalendarPageClient events={[]} currentMonth={10} currentYear={2026} importEnabled />)
    expect(screen.getByRole('button', { name: 'Import from text or photo' })).toBeTruthy()
  })

  it('imports, shows "Added N events" and undoes with the signed token', async () => {
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
    expect(undo.body).toEqual({ token: 'v1.signed.token' })
    expect(within(toast).queryByRole('button', { name: /Undo/ })).toBeNull()
  })

  it('moves focus into the dialog, keeps Tab inside and returns focus to the opener on close', async () => {
    const user = userEvent.setup()
    mockFetch()
    render(<CalendarPageClient events={[]} currentMonth={10} currentYear={2026} importEnabled />)
    const opener = screen.getByRole('button', { name: 'Import from text or photo' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Import events' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText('Text of the email or flyer'))
    // Tab from the last control wraps to the first, never leaving the dialog.
    for (let i = 0; i < 8; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
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
    // Focus followed the step change to the results.
    expect(document.activeElement?.textContent).toMatch(/^Found 3 events/)
  })

  it('commits the edited, ticked events in one request with an Idempotency-Key', async () => {
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
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ eventIds: ['ev-1', 'ev-2'], count: 2, undoToken: 'v1.signed.token' }))
    )
    const [commit] = commits(calls)
    expect(commit.headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(commit.body).toEqual({
      events: [
        { title: 'Picture day', description: null, start_time: '2026-10-02T04:00:00.000Z', end_time: '2026-10-03T03:59:00.000Z', location: null },
        {
          title: 'School bake sale', description: 'Bring $2', start_time: '2026-10-09T19:30:00.000Z',
          end_time: '2026-10-09T21:00:00.000Z', location: 'Gym',
        },
      ],
    })
    expect(calls.some((c) => c.url === '/api/events')).toBe(false)
  })

  it('retries a lost or failed commit with the same key, and a changed batch with a new one', async () => {
    const user = userEvent.setup()
    const calls = mockFetch({ commitOutcomes: ['network', 503, 400] })
    const onDone = jest.fn()
    render(<ImportEventsDialog onClose={jest.fn()} onDone={onDone} />)
    await pasteAndFind(user)
    await user.click(await screen.findByTestId('import-add'))
    expect(await screen.findByText(/nothing will be added twice/)).toBeTruthy()
    await user.click(screen.getByTestId('import-add'))
    await waitFor(() => expect(commits(calls)).toHaveLength(2))
    // A 400 is definite: its message shows and the key is dropped.
    await user.click(screen.getByTestId('import-add'))
    expect(await screen.findByText('Server said 400')).toBeTruthy()
    const cards = screen.getAllByTestId('import-suggestion')
    await user.type(within(cards[0]).getByLabelText('Title'), '!')
    await user.click(screen.getByTestId('import-add'))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    const keys = commits(calls).map((c) => c.headers['Idempotency-Key'])
    expect(keys).toHaveLength(4)
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).toBe(keys[0])
    expect(keys[3]).not.toBe(keys[0])
  })

  it('keeps a timed multi-day end date editable and sends it', async () => {
    const user = userEvent.setup()
    const calls = mockFetch({
      suggestBody: {
        suggestions: [
          {
            title: 'Camp', start: '2026-10-09T09:00:00-04:00', end: '2026-10-11T17:00:00-04:00', allDay: false,
            location: null, notes: null, confidence: 0.9,
          },
        ],
        unreadable: false, dropped: 0, timeZone: 'America/Toronto',
      },
    })
    render(<ImportEventsDialog onClose={jest.fn()} onDone={jest.fn()} />)
    await pasteAndFind(user)
    const [card] = await screen.findAllByTestId('import-suggestion')
    const last = within(card).getByLabelText('Last day (optional)') as HTMLInputElement
    expect(last.value).toBe('2026-10-11')
    await user.clear(last)
    await user.type(last, '2026-10-10')
    await user.click(screen.getByTestId('import-add'))
    await waitFor(() => expect(commits(calls)).toHaveLength(1))
    expect((commits(calls)[0].body as { events: Array<{ end_time: string }> }).events[0].end_time).toBe('2026-10-10T21:00:00.000Z')
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
    expect(commits(calls)).toHaveLength(0)
  })

  it('shows a clear message when nothing readable was found', async () => {
    const user = userEvent.setup()
    mockFetch({ suggestBody: { suggestions: [], unreadable: true, dropped: 0, timeZone: 'America/Toronto' } })
    render(<ImportEventsDialog onClose={jest.fn()} onDone={jest.fn()} />)
    await pasteAndFind(user)
    expect((await screen.findByTestId('import-empty')).textContent).toBe(UNREADABLE_MESSAGE)
    expect(UNREADABLE_MESSAGE).toBe("We couldn't find any dates in this. Try a clearer photo or paste the text.")
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }))
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
    render(<ImportUndoToast result={commitResult(1)} addedAt={Date.now()} onDismiss={jest.fn()} onUndone={jest.fn()} />)
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    expect(await screen.findByText('It is too late to undo this import.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
  })

  it('does not offer Undo after the window', () => {
    mockFetch()
    render(
      <ImportUndoToast
        result={{ ...commitResult(1), undoExpiresAt: new Date(Date.now() - 1000).toISOString() }}
        addedAt={Date.now() - 11 * 60_000}
        onDismiss={jest.fn()}
        onUndone={jest.fn()}
      />
    )
    expect(screen.getByText('Added 1 event')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
  })
})
