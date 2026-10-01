/**
 * @jest-environment jsdom
 */
// Family chat thread: the 5s poll must not yank a reader scrolling history,
// a failed send says why and keeps the text, and older history can be loaded
// with GET /api/messages?cursor=<oldest created_at>.
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mergeLatest, prependEarlier } from '../thread'

jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import MessagesPage from '../page'

type Msg = { id: string; created_at: string; content: string; sender_id: string; sender: { id: string; name: string } }

function msg(n: number, sender = 'u2'): Msg {
  return {
    id: `m${n}`,
    created_at: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString(),
    content: `Message ${n}`,
    sender_id: sender,
    sender: { id: sender, name: sender === 'u1' ? 'Me' : 'Sam' },
  }
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i))

let latest: Msg[] = []
let older: Msg[] = []
let postReply: () => Promise<Response>
let calls: { url: string; method: string }[] = []
let poll: (() => void) | null = null
const scrollTo = jest.fn()

beforeAll(() => {
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo
})

beforeEach(() => {
  latest = range(1, 3)
  older = []
  calls = []
  poll = null
  scrollTo.mockClear()
  postReply = async () => ({ ok: true, status: 200, json: async () => ({ message: msg(99, 'u1') }) }) as Response
  // Capture the 5s poll so a test can run it on demand.
  // Testing Library's waitFor also uses setInterval; only the 5s poll is held.
  const realSetInterval = window.setInterval.bind(window)
  jest.spyOn(window, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
    if (ms !== 5000) return realSetInterval(fn, ms)
    poll = fn
    return 0 as unknown as ReturnType<typeof setInterval>
  }) as unknown as typeof setInterval)
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method })
    if (method === 'POST') return postReply()
    if (url.startsWith('/api/messages?cursor=')) {
      return { ok: true, status: 200, json: async () => ({ messages: older, members: [], userId: 'u1' }) } as Response
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: latest, members: [{ id: 'u1', name: 'Me' }], userId: 'u1' }),
    } as Response
  }) as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
})

function thread() {
  return screen.getByRole('region', { name: 'Messages thread' })
}

/** Give the thread a size and scroll position (jsdom does no layout). */
function setScroll(el: HTMLElement, { scrollTop, scrollHeight = 2000, clientHeight = 500 }: { scrollTop: number; scrollHeight?: number; clientHeight?: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
  el.scrollTop = scrollTop
  fireEvent.scroll(el)
}

async function runPoll() {
  await act(async () => {
    poll?.()
  })
  await waitFor(() => expect(calls.filter((c) => c.url === '/api/messages').length).toBeGreaterThan(1))
}

describe('polling', () => {
  it('scrolls to the newest message once on load, and a quiet poll does not scroll again', async () => {
    render(<MessagesPage />)
    await screen.findByText('Message 3')
    expect(scrollTo).toHaveBeenCalledTimes(1)

    await runPoll()
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('does not yank a reader who scrolled up, but follows new messages at the bottom', async () => {
    render(<MessagesPage />)
    await screen.findByText('Message 3')
    scrollTo.mockClear()

    setScroll(thread(), { scrollTop: 100 })
    latest = range(1, 4)
    await runPoll()
    await screen.findByText('Message 4')
    expect(scrollTo).not.toHaveBeenCalled()

    setScroll(thread(), { scrollTop: 1500 })
    latest = range(1, 5)
    const before = calls.length
    await act(async () => {
      poll?.()
    })
    await waitFor(() => expect(calls.length).toBeGreaterThan(before))
    await screen.findByText('Message 5')
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('scrolls to a message the reader just sent even when scrolled up', async () => {
    const user = userEvent.setup()
    render(<MessagesPage />)
    await screen.findByText('Message 3')
    scrollTo.mockClear()
    setScroll(thread(), { scrollTop: 0 })

    await user.type(screen.getByRole('textbox', { name: 'Message text' }), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Message 99')
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })
})

describe('sending', () => {
  it("shows the server's error and keeps the typed text", async () => {
    postReply = async () => ({ ok: false, status: 400, json: async () => ({ error: 'Message is too long' }) }) as Response
    const user = userEvent.setup()
    render(<MessagesPage />)
    await screen.findByText('Message 3')

    const input = screen.getByRole('textbox', { name: 'Message text' }) as HTMLInputElement
    await user.type(input, 'Dinner at 6')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe("Couldn't send your message. Message is too long")
    expect(input.value).toBe('Dinner at 6')
    expect(input.getAttribute('aria-describedby')).toBe(alert.id)
  })

  it('says to check the connection when the network fails, and keeps the text', async () => {
    postReply = async () => {
      throw new TypeError('Failed to fetch')
    }
    const user = userEvent.setup()
    render(<MessagesPage />)
    await screen.findByText('Message 3')

    const input = screen.getByRole('textbox', { name: 'Message text' }) as HTMLInputElement
    await user.type(input, 'Dinner at 6')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Check your connection')
    expect(input.value).toBe('Dinner at 6')
    expect(input.disabled).toBe(false)
  })
})

describe('Load earlier messages', () => {
  it('is hidden when the first page is not full', async () => {
    render(<MessagesPage />)
    await screen.findByText('Message 3')
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull()
  })

  it('loads the page before the oldest message and puts it in front without scrolling to the bottom', async () => {
    latest = range(100, 149) // a full page of 50
    older = range(60, 99).map((m) => ({ ...m })) // 40 left: the last page
    const user = userEvent.setup()
    render(<MessagesPage />)
    await screen.findByText('Message 149')
    scrollTo.mockClear()

    const button = screen.getByRole('button', { name: 'Load earlier messages' })
    expect(button.className).toContain('min-h-[44px]')
    await user.click(button)

    await screen.findByText('Message 60')
    const cursorCall = calls.find((c) => c.url.startsWith('/api/messages?cursor='))!
    expect(cursorCall.url).toBe(`/api/messages?cursor=${encodeURIComponent(latest[0].created_at)}&limit=50`)
    const texts = screen.getAllByText(/^Message \d+$/).map((el) => el.textContent)
    expect(texts[0]).toBe('Message 60')
    expect(texts[texts.length - 1]).toBe('Message 149')
    expect(scrollTo).not.toHaveBeenCalled()
    // Fewer than a page came back: nothing earlier is left.
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull()

    // The next poll keeps the earlier history on screen.
    await runPoll()
    expect(screen.getByText('Message 60')).toBeTruthy()
  })

  it('shows an error when loading earlier messages fails', async () => {
    latest = range(100, 149)
    const user = userEvent.setup()
    render(<MessagesPage />)
    await screen.findByText('Message 149')
    ;(global.fetch as jest.Mock).mockImplementationOnce(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'cursor must be a valid date-time' }),
    }))
    await user.click(screen.getByRole('button', { name: 'Load earlier messages' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Couldn't load earlier messages. cursor must be a valid date-time"
    )
    expect(screen.getByRole('button', { name: 'Load earlier messages' })).toBeTruthy()
  })
})

describe('mergeLatest', () => {
  it('returns the same array when the newest id and count are unchanged', () => {
    const prev = range(1, 3)
    expect(mergeLatest(prev, range(1, 3))).toBe(prev)
  })

  it('appends new messages and keeps earlier loaded history', () => {
    const prev = range(1, 5) // 1-2 loaded earlier, 3-5 from the poll window
    const next = mergeLatest(prev, range(3, 6))
    expect(next.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6'])
  })

  it('keeps a just-sent message that an in-flight poll did not include', () => {
    const prev = [...range(1, 3), msg(9)]
    expect(mergeLatest(prev, range(1, 3))).toBe(prev)
  })

  it('prependEarlier skips messages already shown', () => {
    const prev = range(3, 4)
    expect(prependEarlier(prev, range(1, 3)).map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(prependEarlier(prev, range(3, 4))).toBe(prev)
  })
})
