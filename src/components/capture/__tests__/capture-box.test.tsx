/**
 * @jest-environment jsdom
 */
// Quick capture tells its host page when something was saved (the calendar
// refreshes), and a photo batch that partly fails keeps the failed events on
// screen with "Added X of Y" instead of dropping them.
import * as React from 'react'
import { webcrypto } from 'node:crypto'
import { TextDecoder, TextEncoder } from 'node:util'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CaptureBox } from '../CaptureBox'
import { I18nProvider } from '@/i18n'
import { CAPTURE_RECOVERY_RETENTION_MS, captureRecoveryStorageKey } from '@/lib/capture-recovery'
import { captureEnglish, captureSpanish } from '@/i18n/capture'

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto })
if (!globalThis.TextEncoder) Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: TextEncoder })
if (!globalThis.TextDecoder) Object.defineProperty(globalThis, 'TextDecoder', { configurable: true, value: TextDecoder })

const PHOTO_EVENTS = [
  { title: 'Picture day', start_time: '2026-10-02T13:00:00.000Z' },
  { title: 'Bake sale', start_time: '2026-10-09T19:30:00.000Z' },
  { title: 'Book fair', start_time: '2026-10-20T13:00:00.000Z' },
]

function json(status: number, data: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as unknown as Response
}

/** `eventStatus(title)` decides each POST /api/events answer. */
function mockFetch(eventStatus: (title: string) => number) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/capture' && method === 'GET') return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    if (url === '/api/capture') {
      const body = JSON.parse(String(init?.body))
      if (body.imageBase64) return json(200, { image: { events: PHOTO_EVENTS, note: null } })
      return json(200, {
        draft: { kind: 'event', title: 'Dentist', start_time: '2026-10-06T19:00:00.000Z', confidence: 'high' },
      })
    }
    if (url === '/api/events' && method === 'POST') {
      const title = JSON.parse(String(init?.body)).title as string
      const status = eventStatus(title)
      return json(status, status < 300 ? { event: { id: title } } : { error: 'nope' })
    }
    if (url === '/api/capture/receipt' && method === 'GET') {
      return json(200, { state: 'committed', current: 'present' })
    }
    throw new Error(`unexpected ${method} ${url}`)
  }) as unknown as typeof fetch
}

// jsdom has no canvas/image decoding: stub the downscale path.
beforeAll(() => {
  class FakeImage {
    width = 100
    height = 100
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0)
    }
  }
  ;(global as unknown as { Image: unknown }).Image = FakeImage
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({ drawImage: jest.fn() })) as never
  HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/jpeg;base64,AAAA')
})

beforeEach(() => {
  window.localStorage.clear()
})

async function readPhoto(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByLabelText('Choose a photo of a flyer or timetable') as HTMLInputElement
  await user.upload(input, new File(['x'], 'flyer.png', { type: 'image/png' }))
  await screen.findByText('Found 3 events')
}

describe('CaptureBox', () => {
  it('shows nothing when no AI key is set up, instead of a dead-end message', async () => {
    global.fetch = jest.fn(async () => json(200, { configured: false, allowed: true })) as unknown as typeof fetch
    const { container } = render(<CaptureBox />)
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('calls onSaved after a typed event is added', async () => {
    mockFetch(() => 201)
    const onSaved = jest.fn()
    const user = userEvent.setup()
    render(<CaptureBox onSaved={onSaved} />)
    await user.type(screen.getByLabelText('What would you like to add?'), 'dentist Tuesday 3pm')
    await user.click(screen.getByRole('button', { name: 'Read it' }))
    await user.click(await screen.findByRole('button', { name: 'Add it' }))
    await screen.findByText('Added “Dentist”')
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403])('purges recovery on an empty text-preview refusal (%i)', async (status) => {
    const storageKey = captureRecoveryStorageKey('user-a', 'family-a')
    window.localStorage.setItem(storageKey, JSON.stringify([{
      version: 1,
      key: 'capture-preview-auth-12345678',
      action: 'event.create',
      requestHash: 'a'.repeat(64),
      body: JSON.stringify({ title: 'Dentist' }),
      title: 'Dentist',
      kind: 'event',
      createdAt: Date.now(),
      photo: false,
    }]))
    let previewPosts = 0
    global.fetch = jest.fn(async (url, init) => {
      if (String(url) === '/api/capture' && (init?.method ?? 'GET') === 'GET') {
        return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
      }
      if (String(url) === '/api/capture') {
        previewPosts += 1
        return { ok: false, status, json: async () => { throw new Error('empty refusal body') } } as unknown as Response
      }
      throw new Error('unexpected ' + String(url))
    }) as unknown as typeof fetch

    const user = userEvent.setup()
    render(<CaptureBox />)
    await user.type(await screen.findByRole('textbox'), 'dentist Tuesday')
    await user.click(screen.getByRole('button', { name: 'Read it' }))
    await screen.findByText(captureEnglish.recoveryAccessUnavailable)
    await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBeNull())
    expect(previewPosts).toBe(1)
    expect(screen.queryByRole('button', { name: /Retry Dentist/ })).toBeNull()
  })

  it.each([401, 403])('purges recovery on a malformed photo-preview refusal (%i)', async (status) => {
    const storageKey = captureRecoveryStorageKey('user-a', 'family-a')
    window.localStorage.setItem(storageKey, JSON.stringify([{
      version: 1,
      key: 'capture-photo-auth-12345678',
      action: 'event.create',
      requestHash: 'a'.repeat(64),
      body: JSON.stringify({ title: 'Dentist' }),
      title: 'Dentist',
      kind: 'event',
      createdAt: Date.now(),
      photo: false,
    }]))
    global.fetch = jest.fn(async (url, init) => {
      if (String(url) === '/api/capture' && (init?.method ?? 'GET') === 'GET') {
        return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
      }
      if (String(url) === '/api/capture') {
        return { ok: false, status, json: async () => { throw new Error('malformed refusal body') } } as unknown as Response
      }
      throw new Error('unexpected ' + String(url))
    }) as unknown as typeof fetch

    const user = userEvent.setup()
    render(<CaptureBox />)
    await user.upload(screen.getByLabelText('Choose a photo of a flyer or timetable'), new File(['x'], 'flyer.png', { type: 'image/png' }))
    await screen.findByText(captureEnglish.recoveryAccessUnavailable)
    await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBeNull())
    expect(screen.queryByRole('button', { name: /Retry Dentist/ })).toBeNull()
  })

  it('adds every photo event and calls onSaved', async () => {
    mockFetch(() => 201)
    const onSaved = jest.fn()
    const user = userEvent.setup()
    render(<CaptureBox onSaved={onSaved} />)
    await readPhoto(user)
    await user.click(screen.getByRole('button', { name: 'Add 3' }))
    await screen.findByText('Added 3 events')
    expect(screen.queryByText('Picture day')).toBeNull()
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403])('keeps a truthful partial photo status when a later event is refused (%i)', async (status) => {
    let eventPosts = 0
    global.fetch = jest.fn(async (url, init) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      if (String(url) === '/api/capture' && method === 'GET') {
        return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
      }
      if (String(url) === '/api/capture' && method === 'POST') {
        return json(200, { image: { events: PHOTO_EVENTS, note: null } })
      }
      if (String(url) === '/api/events' && method === 'POST') {
        eventPosts += 1
        if (eventPosts === 1) return json(201, { event: { id: 'picture-day' } })
        return { ok: false, status, json: async () => { throw new Error('empty refusal body') } } as unknown as Response
      }
      throw new Error('unexpected ' + method + ' ' + String(url))
    }) as unknown as typeof fetch

    const user = userEvent.setup()
    render(<CaptureBox />)
    await readPhoto(user)
    await user.click(screen.getByRole('button', { name: 'Add 3' }))
    await screen.findByText('Added 1 of 3 events')
    expect(screen.getByTestId('capture-access-boundary')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Added 1 of 3 events')
    expect(screen.getByRole('alert').textContent).toContain(captureEnglish.recoveryPartialFailure)
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull()
    expect(eventPosts).toBe(2)
  })

  it('keeps failed photo events and says "Added X of Y"', async () => {
    mockFetch((title) => (title === 'Bake sale' ? 500 : 201))
    const onSaved = jest.fn()
    const user = userEvent.setup()
    render(<CaptureBox onSaved={onSaved} />)
    await readPhoto(user)
    await user.click(screen.getByRole('button', { name: 'Add 3' }))

    await screen.findByText('Added 2 of 3 events')
    expect(screen.getByRole('alert').textContent).toMatch(/1 event could not be saved/)
    expect(screen.getAllByText('Bake sale').length).toBeGreaterThan(0)
    expect(screen.queryByText('Picture day')).toBeNull()
    expect(screen.queryByText('Book fair')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add 1' })).toBeTruthy()
    expect(onSaved).toHaveBeenCalledTimes(1)

    // Retrying sends only the failed event.
    mockFetch(() => 201)
    await user.click(screen.getByRole('button', { name: 'Add 1' }))
    await screen.findByText('Added 1 event')
    expect(screen.queryByText('Bake sale')).toBeNull()
  })

  it('reports confirmed photo successes when recovery storage fails for remaining rows', async () => {
    let eventPosts = 0
    const originalSetItem = Storage.prototype.setItem
    mockFetch((title) => {
      eventPosts += 1
      if (eventPosts === 1) {
        Storage.prototype.setItem = function (key: string, value: string) {
          if (key.startsWith('family-planner:capture-recovery:v1:') && value !== '[]') {
            throw new Error('quota')
          }
          return originalSetItem.call(this, key, value)
        }
      }
      return 201
    })
    const onSaved = jest.fn()
    const user = userEvent.setup()
    try {
      render(<CaptureBox onSaved={onSaved} />)
      await readPhoto(user)
      await user.click(screen.getByRole('button', { name: 'Add 3' }))
      await screen.findByText('Added 1 of 3 events')
      expect(screen.getByText(captureEnglish.recoveryPartialFailure)).toBeTruthy()
      expect(screen.getAllByText('Bake sale').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Book fair').length).toBeGreaterThan(0)
      expect(eventPosts).toBe(1)
      expect(onSaved).toHaveBeenCalledTimes(1)
    } finally {
      Storage.prototype.setItem = originalSetItem
    }
  })

  it('keeps every photo event and does not call onSaved when all fail', async () => {
    mockFetch(() => 500)
    const onSaved = jest.fn()
    const user = userEvent.setup()
    render(<CaptureBox onSaved={onSaved} />)
    await readPhoto(user)
    await user.click(screen.getByRole('button', { name: 'Add 3' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not save those events. Try again to check the same requests'))
    expect(screen.getByRole('button', { name: 'Add 3' })).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('sends a local wall-clock time from capture as the matching instant', async () => {
    let posted: { start_time?: string } = {}
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/capture' && method === 'GET') return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
      if (url === '/api/capture') {
        return json(200, { draft: { kind: 'event', title: 'Soccer', start_time: '2026-10-06T15:00', confidence: 'high' } })
      }
      if (url === '/api/events' && method === 'POST') {
        posted = JSON.parse(String(init?.body))
        return json(201, { event: { id: 'e1' } })
      }
      throw new Error(`unexpected ${method} ${url}`)
    }) as unknown as typeof fetch
    const user = userEvent.setup()
    render(<CaptureBox onSaved={jest.fn()} />)
    await user.type(screen.getByRole('textbox'), 'Soccer Tuesday 3pm{Enter}')
    await user.click(await screen.findByRole('button', { name: /add/i }))
    await waitFor(() => expect(posted.start_time).toBeDefined())
    // 15:00 in the browser's zone, as an instant (never stored as 15:00 UTC unless the browser is on UTC).
    expect(posted.start_time).toBe(new Date('2026-10-06T15:00').toISOString())
  })
})

it('retries a lost event response with the original operation key and payload', async () => {
  mockFetch(() => 200)
  const original = global.fetch
  const calls: RequestInit[] = []
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === '/api/events' && init?.method === 'POST') {
      calls.push(init)
      if (calls.length === 1) throw new Error('response lost after commit')
    }
    return original(url, init)
  }) as typeof fetch
  const user = userEvent.setup()
  render(<CaptureBox />)
  await user.type(screen.getByLabelText('What would you like to add?'), 'dentist Tuesday')
  await user.click(screen.getByRole('button', { name: 'Read it' }))
  await user.click(await screen.findByRole('button', { name: 'Add it' }))
  await screen.findByText(/Could not confirm whether this was saved/)
  await user.click(screen.getByRole('button', { name: 'Add it' }))
  await screen.findByText('Added “Dentist”')
  expect(calls).toHaveLength(2)
  expect(new Headers(calls[0].headers).get('Idempotency-Key')).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
  expect(calls[1].headers).toEqual(calls[0].headers)
  expect(calls[1].body).toBe(calls[0].body)
})

it('keeps each photo row key after partial success and an uncertain response', async () => {
  mockFetch(() => 200)
  const original = global.fetch
  const attempts = new Map<string, RequestInit[]>()
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === '/api/events' && init?.method === 'POST') {
      const title = JSON.parse(String(init.body)).title
      const calls = attempts.get(title) || []
      calls.push(init); attempts.set(title, calls)
      if (title === 'Bake sale' && calls.length === 1) throw new Error('lost response')
    }
    return original(url, init)
  }) as typeof fetch
  const user = userEvent.setup()
  render(<CaptureBox />)
  await readPhoto(user)
  await user.click(screen.getByRole('button', { name: 'Add 3' }))
  await screen.findByText('Added 1 of 3 events')
  await user.click(screen.getByRole('button', { name: 'Add 2' }))
  await screen.findByText('Added 2 events')
  expect(attempts.get('Picture day')).toHaveLength(1)
  const retry = attempts.get('Bake sale')!
  expect(retry).toHaveLength(2)
  expect(retry[1].headers).toEqual(retry[0].headers)
  expect(retry[1].body).toBe(retry[0].body)
  expect(attempts.get('Book fair')).toHaveLength(1)
})

it('retains the grocery operation key and body after an uncertain combined save', async () => {
  const items: RequestInit[] = []
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === '/api/capture') return json(200, init?.method === 'POST' ? { draft: { kind: 'listitem', title: 'Milk', confidence: 'high' } } : { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    if (String(url) === '/api/capture/grocery') {
      items.push(init!)
      if (items.length === 1) throw new Error('lost response')
      return json(200, { success: true, item: { id: 'item-1' } })
    }
    throw new Error('unexpected endpoint')
  }) as typeof fetch
  const user = userEvent.setup()
  render(<CaptureBox />)
  await user.type(screen.getByLabelText('What would you like to add?'), 'add milk')
  await user.click(screen.getByRole('button', { name: 'Read it' }))
  await user.click(await screen.findByRole('button', { name: 'Add it' }))
  await screen.findByText(/Could not confirm whether this was saved/)
  await user.click(screen.getByRole('button', { name: 'Add it' }))
  await screen.findByText('Added “Milk”')
  expect(items[1].headers).toEqual(items[0].headers)
  expect(items[1].body).toBe(items[0].body)
  expect(JSON.parse(String(items[1].body))).toEqual({ content: 'Milk', quantity: 1 })
})

it('restores a confirmed operation after reload without submitting until Retry', async () => {
  window.localStorage.clear()
  const calls: RequestInit[] = []
  const sequence: string[] = []
  let eventAttempts = 0
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === '/api/capture' && (init?.method ?? 'GET') === 'GET') {
      return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    }
    if (String(url) === '/api/capture') {
      return json(200, { draft: { kind: 'event', title: 'Dentist', start_time: '2026-10-06T19:00:00.000Z', confidence: 'high' } })
    }
    if (String(url) === '/api/events') {
      sequence.push('post')
      calls.push(init!)
      const envelope = JSON.parse(window.localStorage.getItem('family-planner:capture-recovery:v1:user-a:family-a') || '[]')[0]
      expect(envelope.requestHash).toMatch(/^[a-f0-9]{64}$/)
      eventAttempts += 1
      if (eventAttempts === 1) throw new Error('response lost after commit')
      return json(201, { event: { id: 'event-a' } })
    }
    if (String(url) === '/api/capture/receipt' && (init?.method ?? 'GET') === 'GET') {
      sequence.push('status')
      return json(200, { state: 'committed', current: 'present' })
    }
    throw new Error(`unexpected ${String(url)}`)
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  const first = render(<CaptureBox />)
  await user.type(screen.getByLabelText('What would you like to add?'), 'dentist Tuesday')
  await user.click(screen.getByRole('button', { name: 'Read it' }))
  await user.click(await screen.findByRole('button', { name: 'Add it' }))
  await screen.findByText(/Could not confirm whether this was saved/)
  first.unmount()

  render(<CaptureBox />)
  const recovery = await screen.findByTestId('capture-recovery')
  expect(recovery.textContent).toContain('Dentist')
  expect(calls).toHaveLength(1)
  const retry = await screen.findByRole('button', { name: 'Retry Dentist' })
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false))
  await user.click(retry)
  await screen.findByText('Already added “Dentist”')
  expect(sequence).toEqual(['post', 'post', 'status'])
  expect(calls).toHaveLength(2)
  expect(calls[1].body).toBe(calls[0].body)
  expect(calls[1].headers).toEqual(calls[0].headers)
})

it.each([401, 403])('clears recovery when receipt status returns an auth refusal (%i)', async (status) => {
  const storageKey = captureRecoveryStorageKey('user-a', 'family-a')
  window.localStorage.setItem(storageKey, JSON.stringify([{
    version: 1,
    key: 'capture-receipt-auth-12345678',
    action: 'event.create',
    requestHash: 'a'.repeat(64),
    body: JSON.stringify({ title: 'Dentist', event_type: 'other' }),
    title: 'Dentist',
    kind: 'event',
    createdAt: Date.now(),
    photo: false,
  }]))
  let receiptCalls = 0
  let eventPosts = 0
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === '/api/capture' && (init?.method ?? 'GET') === 'GET') {
      return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    }
    if (String(url) === '/api/capture/receipt') {
      receiptCalls += 1
      return json(status, { error: 'unauthorized' })
    }
    if (String(url) === '/api/events') {
      eventPosts += 1
      return json(201, { event: { id: 'must-not-write' } })
    }
    throw new Error(`unexpected ${String(url)}`)
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(<CaptureBox />)
  await user.click(await screen.findByRole('button', { name: 'Check status for Dentist' }))
  await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBeNull())
  expect(receiptCalls).toBe(1)
  expect(eventPosts).toBe(0)
  expect(screen.queryByRole('button', { name: 'Retry Dentist' })).toBeNull()
})

it.each([401, 403])('clears recovery when the confirmed event POST returns an auth refusal (%i)', async (status) => {
  const storageKey = captureRecoveryStorageKey('user-a', 'family-a')
  let eventPosts = 0
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === '/api/capture' && (init?.method ?? 'GET') === 'GET') {
      return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    }
    if (String(url) === '/api/capture') {
      return json(200, { draft: { kind: 'event', title: 'Dentist', confidence: 'high' } })
    }
    if (String(url) === '/api/events') {
      eventPosts += 1
      return json(status, { error: 'unauthorized' })
    }
    throw new Error(`unexpected ${String(url)}`)
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(<CaptureBox />)
  await user.type(await screen.findByRole('textbox'), 'dentist Tuesday')
  await user.click(screen.getByRole('button', { name: 'Read it' }))
  await user.click(await screen.findByRole('button', { name: 'Add it' }))
  await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBeNull())
  expect(eventPosts).toBe(1)
  expect(screen.queryByRole('button', { name: 'Retry Dentist' })).toBeNull()
})

it('keeps unverified purge guidance visible and rechecks access before recovery controls return', async () => {
  const storageKey = captureRecoveryStorageKey('user-a', 'family-a')
  let purgeBlocked = true
  let availabilityGets = 0
  let eventPosts = 0
  let receiptCalls = 0
  const originalRemoveItem = Storage.prototype.removeItem
  Storage.prototype.removeItem = function (key: string) {
    if (purgeBlocked && key.startsWith('family-planner:capture-recovery:v1:')) throw new Error('private mode')
    return originalRemoveItem.call(this, key)
  }
  global.fetch = jest.fn(async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (String(url) === '/api/capture' && method === 'GET') {
      availabilityGets += 1
      return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    }
    if (String(url) === '/api/capture' && method === 'POST') {
      return json(200, { draft: { kind: 'event', title: 'Dentist', confidence: 'high' } })
    }
    if (String(url) === '/api/events' && method === 'POST') {
      eventPosts += 1
      return json(401, { error: 'unauthorized' })
    }
    if (String(url) === '/api/capture/receipt') {
      receiptCalls += 1
      return json(200, { state: 'committed', current: 'present' })
    }
    throw new Error('unexpected ' + method + ' ' + String(url))
  }) as unknown as typeof fetch

  try {
    const user = userEvent.setup()
    render(<CaptureBox />)
    await user.type(await screen.findByRole('textbox'), 'dentist Tuesday')
    await user.click(screen.getByRole('button', { name: 'Read it' }))
    await user.click(await screen.findByRole('button', { name: 'Add it' }))
    await screen.findByTestId('capture-access-boundary')
    expect(screen.getByText(captureEnglish.recoveryAccessUnavailable, { exact: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: captureEnglish.retryStorage })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Retry Dentist/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Check status for Dentist/ })).toBeNull()
    expect(eventPosts).toBe(1)
    expect(receiptCalls).toBe(0)

    purgeBlocked = false
    await user.click(screen.getByRole('button', { name: captureEnglish.retryStorage }))
    await waitFor(() => expect(availabilityGets).toBe(2))
    expect(screen.queryByRole('button', { name: captureEnglish.retryStorage })).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry Dentist' })).toBeTruthy()
    expect(screen.queryByText(captureEnglish.recoveryAccessUnavailable, { exact: true })).toBeNull()
    expect(receiptCalls).toBe(0)
    expect(eventPosts).toBe(1)
    expect(window.localStorage.getItem(storageKey)).not.toBeNull()
  } finally {
    Storage.prototype.removeItem = originalRemoveItem
  }
})

it.each([401, 403])('clears recovery when a Retry POST returns an auth refusal (%i)', async (status) => {
  const storageKey = captureRecoveryStorageKey('user-a', 'family-a')
  window.localStorage.setItem(storageKey, JSON.stringify([{
    version: 1,
    key: 'capture-retry-auth-12345678',
    action: 'event.create',
    requestHash: 'a'.repeat(64),
    body: JSON.stringify({ title: 'Dentist', event_type: 'other' }),
    title: 'Dentist',
    kind: 'event',
    createdAt: Date.now(),
    photo: false,
  }]))
  let eventPosts = 0
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === '/api/capture' && (init?.method ?? 'GET') === 'GET') {
      return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    }
    if (String(url) === '/api/events') {
      eventPosts += 1
      return json(status, { error: 'unauthorized' })
    }
    throw new Error(`unexpected ${String(url)}`)
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(<CaptureBox />)
  await user.click(await screen.findByRole('button', { name: 'Retry Dentist' }))
  await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBeNull())
  expect(eventPosts).toBe(1)
  expect(screen.queryByRole('button', { name: 'Retry Dentist' })).toBeNull()
})

it('does not POST a retry when storage becomes unavailable after hydration', async () => {
  const storageKey = captureRecoveryStorageKey('user-a', 'family-a')
  window.localStorage.setItem(storageKey, JSON.stringify([{
    version: 1,
    key: 'capture-retry-storage-12345678',
    action: 'event.create',
    requestHash: 'a'.repeat(64),
    body: JSON.stringify({ title: 'Dentist', event_type: 'other' }),
    title: 'Dentist',
    kind: 'event',
    createdAt: Date.now(),
    photo: false,
  }]))
  let eventPosts = 0
  global.fetch = jest.fn(async (url) => {
    if (String(url) === '/api/capture') {
      return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    }
    if (String(url) === '/api/events') {
      eventPosts += 1
      return json(201, { event: { id: 'must-not-write' } })
    }
    throw new Error(`unexpected ${String(url)}`)
  }) as unknown as typeof fetch
  let originalSetItem: typeof Storage.prototype.setItem | null = null
  try {
    const user = userEvent.setup()
    render(<CaptureBox />)
    const retry = await screen.findByRole('button', { name: 'Retry Dentist' })
    originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === storageKey && value !== '[]') throw new Error('quota')
      return originalSetItem!.call(this, key, value)
    }
    await user.click(retry)
    expect((await screen.findAllByText(captureEnglish.recoveryStorageUnavailable)).length).toBeGreaterThan(0)
    expect(eventPosts).toBe(0)
  } finally {
    if (originalSetItem) Storage.prototype.setItem = originalSetItem
  }
})

it('checks a receipt at the six-day boundary before declaring the retry too old', async () => {
  window.localStorage.clear()
  const createdAt = Date.now() - CAPTURE_RECOVERY_RETENTION_MS + 1_000
  const key = 'capture-boundary-12345678'
  window.localStorage.setItem(
    'family-planner:capture-recovery:v1:user-a:family-a',
    JSON.stringify([
      {
        version: 1,
        key,
        action: 'event.create',
        requestHash: 'a'.repeat(64),
        body: JSON.stringify({ title: 'Dentist', event_type: 'other' }),
        title: 'Dentist',
        kind: 'event',
        createdAt,
        photo: false,
      },
    ]),
  )
  let postCount = 0
  let statusCount = 0
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === '/api/capture' && (init?.method ?? 'GET') === 'GET') {
      return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    }
    if (String(url) === '/api/events' && init?.method === 'POST') {
      postCount += 1
      return json(201, { event: { id: 'event-a' } })
    }
    if (String(url) === '/api/capture/receipt') {
      statusCount += 1
      return json(200, { state: 'committed', current: 'present' })
    }
    throw new Error(`unexpected ${String(url)}`)
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(<CaptureBox />)
  const retry = await screen.findByRole('button', { name: 'Retry Dentist' })
  const now = jest.spyOn(Date, 'now').mockReturnValue(createdAt + CAPTURE_RECOVERY_RETENTION_MS + 1)
  try {
    await user.click(retry)
    await screen.findByText('Already added “Dentist”')
    expect(statusCount).toBe(1)
    expect(postCount).toBe(0)
  } finally {
    now.mockRestore()
  }
})

it('discards an absent receipt as terminal without replaying the local request', async () => {
  window.localStorage.clear()
  const key = 'capture-absent-12345678'
  window.localStorage.setItem(
    'family-planner:capture-recovery:v1:user-a:family-a',
    JSON.stringify([
      {
        version: 1,
        key,
        action: 'event.create',
        requestHash: 'a'.repeat(64),
        body: JSON.stringify({ title: 'Dentist', event_type: 'other' }),
        title: 'Dentist',
        kind: 'event',
        createdAt: Date.now(),
        photo: false,
      },
    ]),
  )
  let postCount = 0
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === '/api/capture' && (init?.method ?? 'GET') === 'GET') {
      return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    }
    if (String(url) === '/api/events' && init?.method === 'POST') {
      postCount += 1
      return json(201, { event: { id: 'event-a' } })
    }
    if (String(url) === '/api/capture/receipt') return json(200, { state: 'absent' })
    throw new Error(`unexpected ${String(url)}`)
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(<CaptureBox />)
  await user.click(await screen.findByRole('button', { name: 'Check status for Dentist' }))
  await screen.findByText('No saved result was found. Start a new preview.')
  expect(screen.queryByRole('button', { name: 'Retry Dentist' })).toBeNull()
  expect(postCount).toBe(0)
  expect(window.localStorage.getItem('family-planner:capture-recovery:v1:user-a:family-a')).toBe('[]')
})

it('localizes the saved-recovery controls without translating the saved title', async () => {
  window.localStorage.clear()
  const storageKey = captureRecoveryStorageKey('user-a', 'family-a')
  window.localStorage.setItem(
    storageKey,
    JSON.stringify([
      {
        version: 1,
        key: 'capture-spanish-12345678',
        action: 'event.create',
        requestHash: 'a'.repeat(64),
        body: JSON.stringify({ title: 'Dentist', event_type: 'other' }),
        title: 'Dentist',
        kind: 'event',
        createdAt: Date.now(),
        photo: false,
      },
    ]),
  )
  global.fetch = jest.fn(async (url) => {
    if (String(url) === '/api/capture') {
      return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    }
    throw new Error(`unexpected ${String(url)}`)
  }) as unknown as typeof fetch

  render(
    <I18nProvider locale="es">
      <CaptureBox />
    </I18nProvider>,
  )

  const recovery = await screen.findByTestId('capture-recovery')
  expect(recovery.textContent).toContain(captureSpanish.needsAttention)
  expect(recovery.textContent).toContain(captureSpanish.previousAddHint)
  expect(recovery.textContent).toContain('Dentist')
  expect(within(recovery).getByRole('button', { name: 'Consultar estado de Dentist' })).toBeTruthy()
  expect(within(recovery).getByRole('button', { name: 'Reintentar Dentist' })).toBeTruthy()
  expect(Object.keys(captureSpanish).sort()).toEqual(Object.keys(captureEnglish).sort())
})

it('localizes capture body copy while preserving dynamic titles and raw API errors', async () => {
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === '/api/capture' && (init?.method ?? 'GET') === 'GET') {
      return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    }
    if (String(url) === '/api/capture') {
      return json(200, {
        draft: { kind: 'event', title: 'Dentist', start_time: undefined, confidence: 'high' },
      })
    }
    if (String(url) === '/api/events') return json(400, { error: 'Provider refusal: keep this detail' })
    throw new Error(`unexpected ${String(url)}`)
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(
    <I18nProvider locale="es">
      <CaptureBox />
    </I18nProvider>,
  )

  expect(screen.getByPlaceholderText(captureSpanish.quickAddPlaceholder)).toBeTruthy()
  const input = screen.getByRole('textbox', { name: captureSpanish.captureInputLabel })
  await user.type(input, 'dentista mañana')
  await user.click(screen.getByRole('button', { name: captureSpanish.readIt }))
  await screen.findByText(captureSpanish.event)
  expect(screen.getByText('Dentist')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: captureSpanish.addIt }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toContain('Provider refusal: keep this detail')
})

it('blocks a confirmed write when recovery storage cannot be persisted', async () => {
  window.localStorage.clear()
  const originalSetItem = Storage.prototype.setItem
  const activeKey = 'family-planner:capture-recovery:v1:active'
  let eventPosts = 0
  Storage.prototype.setItem = function (key: string, value: string) {
    if (key.startsWith('family-planner:capture-recovery:v1:') && key !== activeKey && value !== '[]') {
      throw new Error('quota')
    }
    return originalSetItem.call(this, key, value)
  }
  global.fetch = jest.fn(async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (String(url) === '/api/capture' && method === 'GET') {
      return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    }
    if (String(url) === '/api/capture') {
      return json(200, { draft: { kind: 'event', title: 'Dentist', start_time: '2026-10-06T19:00:00.000Z', confidence: 'high' } })
    }
    if (String(url) === '/api/events' && method === 'POST') {
      eventPosts += 1
      return json(201, { event: { id: 'event-a' } })
    }
    throw new Error(`unexpected ${method} ${String(url)}`)
  }) as unknown as typeof fetch

  try {
    const user = userEvent.setup()
    render(<CaptureBox />)
    await user.type(await screen.findByRole('textbox'), 'dentist Tuesday')
    await user.click(screen.getByRole('button', { name: 'Read it' }))
    await user.click(await screen.findByRole('button', { name: 'Add it' }))
    expect((await screen.findAllByText(captureEnglish.recoveryStorageUnavailable)).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Dentist').length).toBeGreaterThan(0)
    expect(eventPosts).toBe(0)
    expect(screen.getByRole('button', { name: captureEnglish.retryStorage })).toBeTruthy()
  } finally {
    Storage.prototype.setItem = originalSetItem
  }
})

it('blocks confirmation when recovery storage activation cannot be persisted', async () => {
  const activeKey = 'family-planner:capture-recovery:v1:active'
  const originalSetItem = Storage.prototype.setItem
  let eventPosts = 0
  Storage.prototype.setItem = function (key: string, value: string) {
    if (key === activeKey) throw new Error('private mode')
    return originalSetItem.call(this, key, value)
  }
  global.fetch = jest.fn(async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (String(url) === '/api/capture' && method === 'GET') {
      return json(200, { configured: true, allowed: true, userId: 'user-a', familyId: 'family-a' })
    }
    if (String(url) === '/api/capture' && method === 'POST') {
      return json(200, { draft: { kind: 'event', title: 'Dentist', confidence: 'high' } })
    }
    if (String(url) === '/api/events' && method === 'POST') {
      eventPosts += 1
      return json(201, { event: { id: 'must-not-write' } })
    }
    throw new Error('unexpected ' + method + ' ' + String(url))
  }) as unknown as typeof fetch

  try {
    const user = userEvent.setup()
    render(<CaptureBox />)
    await expect(screen.findByRole('button', { name: captureEnglish.retryStorage })).resolves.toBeTruthy()
    await user.type(await screen.findByRole('textbox'), 'dentist Tuesday')
    await user.click(screen.getByRole('button', { name: captureEnglish.readIt }))
    const add = await screen.findByRole('button', { name: captureEnglish.addIt })
    expect(add.hasAttribute('disabled')).toBe(true)
    expect(eventPosts).toBe(0)
  } finally {
    Storage.prototype.setItem = originalSetItem
  }
})

it('clears recovery and exposes no retry when capture is forbidden', async () => {
  window.localStorage.clear()
  const storageKey = captureRecoveryStorageKey('user-a', 'family-a')
  window.localStorage.setItem(storageKey, JSON.stringify([{
    version: 1,
    key: 'capture-forbidden-12345678',
    action: 'event.create',
    requestHash: 'a'.repeat(64),
    body: JSON.stringify({ title: 'Dentist', event_type: 'other' }),
    title: 'Dentist',
    kind: 'event',
    createdAt: Date.now(),
    photo: false,
  }]))
  let posts = 0
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === '/api/capture' && (init?.method ?? 'GET') === 'GET') {
      return json(200, { configured: true, allowed: false, userId: 'user-a', familyId: 'family-a' })
    }
    posts += 1
    return json(201, { event: { id: 'must-not-write' } })
  }) as unknown as typeof fetch

  render(<CaptureBox />)
  await screen.findByTestId('capture-child-blocked')
  expect(screen.getByTestId('capture-child-blocked').textContent).toContain('Ask a parent to add this.')
  expect(window.localStorage.getItem(storageKey)).toBeNull()
  expect(screen.queryByRole('button', { name: /Retry Dentist/ })).toBeNull()
  expect(posts).toBe(0)
})

it.each([401, 403])('clears recovery on an authenticated refusal (%i)', async (status) => {
  const storageKey = captureRecoveryStorageKey('user-a', 'family-a')
  window.localStorage.setItem(storageKey, JSON.stringify([]))
  window.localStorage.setItem('family-planner:capture-recovery:v1:active', storageKey)
  global.fetch = jest.fn(async () => json(status, { error: 'unauthorized' })) as unknown as typeof fetch

  render(<CaptureBox />)
  await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBeNull())
  expect(window.localStorage.getItem('family-planner:capture-recovery:v1:active')).toBeNull()
})

it('keeps a logical refusal when forbidden-role recovery purge cannot be confirmed', async () => {
  window.localStorage.clear()
  const storageKey = captureRecoveryStorageKey('user-a', 'family-a')
  window.localStorage.setItem(storageKey, JSON.stringify([]))
  const originalRemoveItem = Storage.prototype.removeItem
  Storage.prototype.removeItem = function (key: string) {
    if (key.startsWith('family-planner:capture-recovery:v1:')) throw new Error('private mode')
    return originalRemoveItem.call(this, key)
  }
  global.fetch = jest.fn(async (url) => {
    if (String(url) === '/api/capture') {
      return json(200, { configured: true, allowed: false, userId: 'user-a', familyId: 'family-a' })
    }
    return json(201, { event: { id: 'must-not-write' } })
  }) as unknown as typeof fetch

  try {
    render(<CaptureBox />)
    await screen.findByTestId('capture-child-blocked')
    expect((await screen.findAllByText(captureEnglish.recoveryStorageUnavailable)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: captureEnglish.retryStorage })).toBeTruthy()
    expect(window.localStorage.getItem(storageKey)).toBe('[]')
  } finally {
    Storage.prototype.removeItem = originalRemoveItem
  }
})
