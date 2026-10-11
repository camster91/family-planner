/**
 * @jest-environment jsdom
 */
// Quick capture tells its host page when something was saved (the calendar
// refreshes), and a photo batch that partly fails keeps the failed events on
// screen with "Added X of Y" instead of dropping them.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CaptureBox } from '../CaptureBox'

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
    if (url === '/api/capture' && method === 'GET') return json(200, { configured: true, allowed: true })
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

  it('keeps failed photo events and says "Added X of Y"', async () => {
    mockFetch((title) => (title === 'Bake sale' ? 500 : 201))
    const onSaved = jest.fn()
    const user = userEvent.setup()
    render(<CaptureBox onSaved={onSaved} />)
    await readPhoto(user)
    await user.click(screen.getByRole('button', { name: 'Add 3' }))

    await screen.findByText('Added 2 of 3 events')
    expect(screen.getByRole('alert').textContent).toMatch(/1 event could not be saved/)
    expect(screen.getByText('Bake sale')).toBeTruthy()
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
      if (url === '/api/capture' && method === 'GET') return json(200, { configured: true, allowed: true })
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

it('retains the original grocery target and key after an uncertain item save', async () => {
  const items: RequestInit[] = []
  let listLookups = 0
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === '/api/capture') return json(200, init?.method === 'POST' ? { draft: { kind: 'listitem', title: 'Milk', confidence: 'high' } } : { configured: true, allowed: true })
    if (String(url) === '/api/lists/default-grocery') {
      listLookups += 1
      return json(200, { list: { id: `grocery-${listLookups}` } })
    }
    if (String(url) === '/api/lists/items/create') {
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
  expect(listLookups).toBe(1)
  expect(items[1].headers).toEqual(items[0].headers)
  expect(items[1].body).toBe(items[0].body)
  expect(JSON.parse(String(items[1].body)).listId).toBe('grocery-1')
})
