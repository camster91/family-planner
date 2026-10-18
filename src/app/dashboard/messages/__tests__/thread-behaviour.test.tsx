/**
 * @jest-environment jsdom
 */
// Family chat thread: the 5s poll must not yank a reader scrolling history,
// a failed send says why and keeps the text, and older history can be loaded
// with GET /api/messages?cursor=<oldest created_at>.
import * as React from 'react'
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'
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
let calls: { url: string; method: string; headers: Headers; body?: string }[] = []
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
    calls.push({ url, method, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : undefined })
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

describe('initial loading recovery', () => {
  it('shows localized retry instead of a false empty state, then recovers', async () => {
    const user = userEvent.setup()
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ messages: latest, members: [{ id: 'u1', name: 'Me' }], userId: 'u1' }),
      }) as unknown as typeof fetch

    render(
      <I18nProvider locale="es">
        <MessagesPage />
      </I18nProvider>
    )

    const recovery = await screen.findByTestId('messages-load-error')
    expect(recovery).toHaveTextContent('No se pudieron cargar los mensajes')
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Intentar de nuevo' })
    expect(retry.className).toContain('min-h-[44px]')

    await user.click(retry)
    expect(await screen.findByText('Message 3')).toBeInTheDocument()
    expect(screen.queryByTestId('messages-load-error')).not.toBeInTheDocument()
  })

  it('keeps the thread and typed draft when a later poll fails', async () => {
    const user = userEvent.setup()
    render(<MessagesPage />)
    await screen.findByText('Message 3')
    const input = screen.getByRole('textbox', { name: 'Message text' }) as HTMLInputElement
    await user.type(input, 'Draft stays here')

    ;(global.fetch as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('offline')
    })
    await act(async () => {
      poll?.()
    })

    expect(await screen.findByTestId('messages-load-error')).toBeInTheDocument()
    expect(screen.getByText('Message 3')).toBeInTheDocument()
    expect(input).toHaveValue('Draft stays here')
  })

  it.each(['failure', 'success'] as const)('ignores an older poll %s after a manual retry succeeds', async outcome => {
    const user = userEvent.setup()
    let finishPoll!: (response: Response) => void
    const pendingPoll = new Promise<Response>(resolve => { finishPoll = resolve })
    const fresh = { messages: [msg(20)], members: [{ id: 'u1', name: 'Me' }], userId: 'u1' }
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(pendingPoll)
      .mockResolvedValueOnce({ ok: true, json: async () => fresh }) as unknown as typeof fetch
    render(<MessagesPage />)
    await screen.findByTestId('messages-load-error')
    await act(async () => { poll?.() })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Message 20')).toBeInTheDocument()
    expect(screen.queryByTestId('messages-load-error')).not.toBeInTheDocument()
    await act(async () => {
      finishPoll({ ok: outcome === 'success', json: async () => ({ messages: [msg(3)], members: [], userId: 'stale-user' }) } as Response)
      await pendingPoll
    })
    expect(screen.getByText('Message 20')).toBeInTheDocument()
    expect(screen.queryByText('Message 3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('messages-load-error')).not.toBeInTheDocument()
  })

  it('does not supersede a slow initial load with automatic polls', async () => {
    let finishLoad!: (response: Response) => void
    const pendingLoad = new Promise<Response>(resolve => { finishLoad = resolve })
    global.fetch = jest.fn().mockReturnValue(pendingLoad) as unknown as typeof fetch
    render(<MessagesPage />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    await act(async () => { poll?.(); poll?.() })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    await act(async () => {
      finishLoad({ ok: true, json: async () => ({ messages: latest, members: [], userId: 'u1' }) } as Response)
      await pendingLoad
    })
    expect(await screen.findByText('Message 3')).toBeInTheDocument()
  })

  it('does not refetch when only the presentation locale changes', async () => {
    const view = render(
      <I18nProvider locale="en">
        <MessagesPage />
      </I18nProvider>
    )
    await screen.findByText('Message 3')
    const callsAfterLoad = (global.fetch as jest.Mock).mock.calls.length

    view.rerender(
      <I18nProvider locale="es">
        <MessagesPage />
      </I18nProvider>
    )
    await waitFor(() => expect(screen.getByText('Message 3')).toBeInTheDocument())
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(callsAfterLoad)
  })

  it('rejects a malformed successful response without showing a false empty state', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [], members: [], userId: 42 }),
    })) as unknown as typeof fetch
    render(<MessagesPage />)

    expect(await screen.findByTestId('messages-load-error')).toHaveTextContent("Couldn't load messages")
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument()
  })
})

describe('localized presentation', () => {
  it('localizes message chrome and accessible dates while preserving household content', async () => {
    render(
      <I18nProvider locale="es">
        <MessagesPage />
      </I18nProvider>
    )
    await screen.findByText('Message 3')
    expect(screen.getByRole('heading', { name: 'Mensajes familiares' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Conversación familiar' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Texto del mensaje' })).toHaveAttribute('placeholder', 'Escribe a tu familia')
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument()
    expect(screen.getAllByLabelText(/Enviado/)).toHaveLength(3)
    expect(screen.getAllByText('Sam')).toHaveLength(3)
  })
})

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
    expect(alert.textContent).toBe("Couldn't send your message. Try again.")
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

  it('reuses one valid idempotency key after an ambiguous network failure', async () => {
    let attempt = 0
    postReply = async () => {
      attempt += 1
      if (attempt === 1) throw new TypeError('Failed to fetch')
      return { ok: true, status: 200, json: async () => ({ message: msg(99, 'u1') }) } as Response
    }
    const user = userEvent.setup()
    render(<MessagesPage />)
    await screen.findByText('Message 3')
    const input = screen.getByRole('textbox', { name: 'Message text' }) as HTMLInputElement
    await user.type(input, 'Dinner at 6')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText("Couldn't send your message. Check your connection and try again.")
    const first = calls.find(call => call.method === 'POST')!
    expect(first.headers.get('Idempotency-Key')).toMatch(/^[A-Za-z0-9_-]{16,128}$/)

    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Message 99')
    const posts = calls.filter(call => call.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(posts[1].headers.get('Idempotency-Key')).toBe(first.headers.get('Idempotency-Key'))
  })

  it('keeps separate ambiguous keys when a draft changes and returns', async () => {
    let attempt = 0
    postReply = async () => {
      attempt += 1
      if (attempt < 3) throw new TypeError('Failed to fetch')
      return { ok: true, status: 200, json: async () => ({ message: msg(101, 'u1') }) } as Response
    }
    const user = userEvent.setup()
    render(<MessagesPage />)
    await screen.findByText('Message 3')
    const input = screen.getByRole('textbox', { name: 'Message text' }) as HTMLInputElement

    await user.type(input, 'First draft')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText("Couldn't send your message. Check your connection and try again.")
    const firstKey = calls.find(call => call.method === 'POST')!.headers.get('Idempotency-Key')

    await user.clear(input)
    await user.type(input, 'Second draft')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(calls.filter(call => call.method === 'POST')).toHaveLength(2))
    const secondKey = calls.filter(call => call.method === 'POST')[1].headers.get('Idempotency-Key')
    expect(secondKey).not.toBe(firstKey)

    await user.clear(input)
    await user.type(input, 'First draft')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Message 101')
    expect(calls.filter(call => call.method === 'POST')[2].headers.get('Idempotency-Key')).toBe(firstKey)
  })

  it('keeps the draft and key when a successful response is malformed', async () => {
    let attempt = 0
    postReply = async () => {
      attempt += 1
      if (attempt === 1) return { ok: true, status: 200, json: async () => ({ message: { id: 'missing-fields' } }) } as Response
      return { ok: true, status: 200, json: async () => ({ message: msg(99, 'u1') }) } as Response
    }
    const user = userEvent.setup()
    render(<MessagesPage />)
    await screen.findByText('Message 3')
    const input = screen.getByRole('textbox', { name: 'Message text' }) as HTMLInputElement
    await user.type(input, 'Dinner at 6')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Your message was not confirmed. Try again.')).toBeInTheDocument()
    expect(input).toHaveValue('Dinner at 6')
    const first = calls.find(call => call.method === 'POST')!
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Message 99')
    const posts = calls.filter(call => call.method === 'POST')
    expect(posts[1].headers.get('Idempotency-Key')).toBe(first.headers.get('Idempotency-Key'))
  })
})

describe('read recovery', () => {
  it('offers a retry when marking the loaded thread as read fails', async () => {
    let readAttempts = 0
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      calls.push({ url, method, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : undefined })
      if (method === 'PATCH') {
        readAttempts += 1
        return (readAttempts === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 }) as Response
      }
      return { ok: true, status: 200, json: async () => ({ messages: latest, members: [{ id: 'u1', name: 'Me' }], userId: 'u1' }) } as Response
    }) as unknown as typeof fetch
    const user = userEvent.setup()
    render(<MessagesPage />)
    await screen.findByText('Message 3')
    expect(await screen.findByTestId('messages-read-recovery')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark as read' }))
    await waitFor(() => expect(readAttempts).toBe(2))
    expect(screen.queryByTestId('messages-read-recovery')).not.toBeInTheDocument()
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
      "Couldn't load earlier messages. Try again."
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
