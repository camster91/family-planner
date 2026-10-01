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
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not save those events'))
    expect(screen.getByRole('button', { name: 'Add 3' })).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
