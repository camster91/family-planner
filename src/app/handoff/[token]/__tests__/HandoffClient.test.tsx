/**
 * @jest-environment jsdom
 */
// The public sitter page's print stylesheet shows only `.print-card`; the
// handoff content must carry that class or the printout is blank.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let mockLocale = 'en'
const mockT = (
  key: string,
  params?: Record<string, string | number>,
  scoped?: Record<string, Record<string, string>>,
) => {
  const base: Record<string, string> = {
    'routeState.tryAgain': mockLocale === 'es' ? 'Intentar de nuevo' : 'Try again',
  }
  const message = scoped?.[mockLocale]?.[key] ?? base[key] ?? key
  return message.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
}
jest.mock('@/i18n', () => ({
  useTranslation: () => ({
    locale: mockLocale,
    t: (key: string, params?: Record<string, string | number>, scoped?: Record<string, Record<string, string>>) =>
      mockT(key, params, scoped),
  }),
}))

import { HandoffClient } from '../HandoffClient'

beforeEach(() => {
  mockLocale = 'en'
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      handoff: {
        id: 'h1',
        sitter_name: 'Sarah',
        sitter_phone: null,
        arrival_time: null,
        departure_time: null,
        kids_bedtimes: '8pm',
        where_snacks: null,
        pickup_authorized: null,
        code_words: null,
        pet_care: null,
        emergency_notes: null,
        house_notes: null,
        general_notes: null,
        family: { name: 'Smith' },
      },
    }),
  })) as unknown as typeof fetch
})

it('wraps the handoff content in the print card', async () => {
  render(<HandoffClient token="tok" />)
  const sitter = await screen.findByText('Sarah')
  const card = screen.getByTestId('handoff-print-card')
  expect(card.classList.contains('print-card')).toBe(true)
  expect(card.contains(sitter)).toBe(true)
  expect(card.textContent).toContain('8pm')
  const print = screen.getByRole('button', { name: /handoff.print/ })
  expect(print.className).toMatch(/min-h-\[44px\]/)
})

it('separates a transient share failure from an invalid link and retries it', async () => {
  const user = userEvent.setup()
  let attempts = 0
  const successfulBody = {
    handoff: {
      id: 'h1',
      sitter_name: 'Sarah',
      sitter_phone: null,
      arrival_time: null,
      departure_time: null,
      kids_bedtimes: '8pm',
      where_snacks: null,
      pickup_authorized: null,
      code_words: null,
      pet_care: null,
      emergency_notes: null,
      house_notes: null,
      general_notes: null,
      family: { name: 'Smith' },
    },
  }
  global.fetch = jest.fn(async () => {
    attempts += 1
    if (attempts === 1) return { ok: false, status: 503, json: async () => ({ error: 'temporary' }) } as Response
    return { ok: true, status: 200, json: async () => successfulBody } as Response
  }) as unknown as typeof fetch

  render(<HandoffClient token="tok" />)
  expect(await screen.findByRole('heading', { name: 'This handoff could not be loaded' })).toBeTruthy()
  expect(screen.queryByText('handoff.linkInvalid')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Sarah')).toBeTruthy()
  expect(attempts).toBe(2)
})

it('localizes transient share recovery in Spanish', async () => {
  mockLocale = 'es'
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: 'temporary' }),
  })) as unknown as typeof fetch

  render(<HandoffClient token="tok" />)
  expect(await screen.findByRole('heading', { name: 'No se pudo cargar esta entrega' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeTruthy()
  expect(screen.queryByText('handoff.linkInvalid')).toBeNull()
})

it.each([null, false])('treats a successful %p body as recoverable malformed data', async (body) => {
  const user = userEvent.setup()
  let attempts = 0
  const successfulBody = {
    handoff: {
      id: 'h1',
      sitter_name: 'Sarah',
      sitter_phone: null,
      arrival_time: null,
      departure_time: null,
      kids_bedtimes: '8pm',
      where_snacks: null,
      pickup_authorized: null,
      code_words: null,
      pet_care: null,
      emergency_notes: null,
      house_notes: null,
      general_notes: null,
      family: { name: 'Smith' },
    },
  }
  global.fetch = jest.fn(async () => {
    attempts += 1
    return attempts === 1
      ? ({ ok: true, status: 200, json: async () => body } as Response)
      : ({ ok: true, status: 200, json: async () => successfulBody } as Response)
  }) as unknown as typeof fetch

  render(<HandoffClient token="tok" />)
  expect(await screen.findByRole('heading', { name: 'This handoff could not be loaded' })).toBeTruthy()
  expect(screen.queryByText('handoff.linkInvalid')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Sarah')).toBeTruthy()
  expect(attempts).toBe(2)
})

it('does not let a stale token response replace the current handoff', async () => {
  const oldBody = {
    handoff: {
      id: 'old',
      sitter_name: 'Old sitter',
      sitter_phone: null,
      arrival_time: null,
      departure_time: null,
      kids_bedtimes: null,
      where_snacks: null,
      pickup_authorized: null,
      code_words: null,
      pet_care: null,
      emergency_notes: null,
      house_notes: null,
      general_notes: null,
      family: { name: 'Old family' },
    },
  }
  const newBody = {
    handoff: {
      ...oldBody.handoff,
      id: 'new',
      sitter_name: 'New sitter',
      family: { name: 'New family' },
    },
  }
  const pending = new Map<string, (response: Response) => void>()
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const promise = new Promise<Response>((resolve) => pending.set(String(input), resolve))
    return promise
  }) as unknown as typeof fetch

  const { rerender } = render(<HandoffClient token="old" />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
  rerender(<HandoffClient token="new" />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))

  pending.get('/api/handoff/share/old')?.({ ok: true, status: 200, json: async () => oldBody } as Response)
  pending.get('/api/handoff/share/new')?.({ ok: true, status: 200, json: async () => newBody } as Response)

  expect(await screen.findByText('New sitter')).toBeTruthy()
  expect(screen.queryByText('Old sitter')).toBeNull()
})

describe('sitter page layout', () => {
  const fullHandoff = (overrides: Record<string, unknown> = {}) => ({
    handoff: {
      id: 'h1',
      sitter_name: 'Sarah',
      sitter_phone: '(555) 010-2000',
      arrival_time: '2027-01-08T18:00:00.000Z',
      departure_time: null,
      kids_bedtimes: '8pm',
      where_snacks: null,
      pickup_authorized: 'Grandma Jane 555-0101',
      code_words: '',
      pet_care: null,
      emergency_notes: 'Peanut allergy. EpiPen in the hall drawer. Dr. Lee 555-0199.',
      house_notes: null,
      general_notes: '   ',
      link_expires_at: '2027-01-09T05:00:00.000Z',
      family: { name: 'Smith' },
      ...overrides,
    },
  })

  const serve = (body: unknown) => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch
  }

  it('puts the emergency block first, inside a main landmark', async () => {
    serve(fullHandoff())
    render(<HandoffClient token="tok" />)
    await screen.findByText('Sarah')
    const main = screen.getByRole('main')
    const emergency = screen.getByTestId('handoff-emergency')
    expect(main.contains(emergency)).toBe(true)
    expect(screen.getByRole('heading', { name: 'In an emergency' })).toBeTruthy()
    expect(emergency.textContent).toContain('Peanut allergy')
    expect(emergency.textContent).toContain('Grandma Jane')
    // The emergency block comes before the sitter card and the other details.
    const sitter = screen.getByRole('heading', { name: 'Sarah' })
    expect(emergency.compareDocumentPosition(sitter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      emergency.compareDocumentPosition(screen.getByTestId('handoff-details')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('makes phone numbers tap-to-call and still shows them as text', async () => {
    serve(fullHandoff())
    render(<HandoffClient token="tok" />)
    await screen.findByText('Sarah')
    const sitterCall = screen.getByRole('link', { name: 'Call (555) 010-2000' })
    expect(sitterCall.getAttribute('href')).toBe('tel:5550102000')
    expect(sitterCall.textContent).toBe('(555) 010-2000')
    expect(sitterCall.className).toMatch(/min-h-\[44px\]/)
    expect(screen.getByRole('link', { name: 'Call 555-0199' }).getAttribute('href')).toBe('tel:5550199')
    expect(screen.getByRole('link', { name: 'Call 555-0101' }).getAttribute('href')).toBe('tel:5550101')
  })

  it('hides empty sections and prints each label once', async () => {
    serve(fullHandoff())
    render(<HandoffClient token="tok" />)
    await screen.findByText('Sarah')
    for (const empty of [
      'handoff.whereSnacks',
      'handoff.codeWords',
      'handoff.petCare',
      'handoff.houseNotes',
      'handoff.generalNotes',
    ]) {
      expect(screen.queryByText(empty)).toBeNull()
    }
    expect(screen.getAllByText('handoff.kidsBedtimes')).toHaveLength(1)
    expect(screen.getAllByText('handoff.emergencyNotes')).toHaveLength(1)
    expect(document.body.textContent).not.toMatch(/handoff\.kidsBedtimes:/)
  })

  it('leaves out the emergency and details blocks when the parent wrote none', async () => {
    serve(
      fullHandoff({
        emergency_notes: null,
        pickup_authorized: '',
        kids_bedtimes: null,
        general_notes: null,
      }),
    )
    render(<HandoffClient token="tok" />)
    await screen.findByText('Sarah')
    expect(screen.queryByTestId('handoff-emergency')).toBeNull()
    expect(screen.queryByTestId('handoff-details')).toBeNull()
  })

  it('shows friendly times without seconds and when the link stops working', async () => {
    serve(fullHandoff())
    render(<HandoffClient token="tok" />)
    await screen.findByText('Sarah')
    const card = screen.getByTestId('handoff-print-card')
    expect(card.textContent).not.toMatch(/\d{1,2}:\d{2}:\d{2}/)
    expect(card.textContent).toMatch(/(Fri|Sat)/)
    expect(screen.getByTestId('handoff-link-expiry').textContent).toMatch(/^This link works until .*\d{1,2}:\d{2}/)
  })

  it('still loads a response without a link expiry', async () => {
    const body = fullHandoff()
    delete (body.handoff as Record<string, unknown>).link_expires_at
    serve(body)
    render(<HandoffClient token="tok" />)
    expect(await screen.findByText('Sarah')).toBeTruthy()
    expect(screen.queryByTestId('handoff-link-expiry')).toBeNull()
  })
})
