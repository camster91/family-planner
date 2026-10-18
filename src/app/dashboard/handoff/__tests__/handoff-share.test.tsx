/**
 * @jest-environment jsdom
 */
// Share used to make a new token on every tap, which killed the link the sitter
// already had, and copied only after a network wait (iOS Safari refuses that).
// Share now shows the current link with a Copy button that copies inside the
// tap; a new link is made only from an explicit, warned step.
import * as React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'

let mockLocale = 'en'
let mockLocaleRerender: (() => void) | null = null
let mockLocaleRerenders: Array<() => void> = []
const baseCopy = {
  en: {
    'handoff.errorLoad': 'Could not load',
    'handoff.shareWithSitter': 'Share with sitter',
    'handoff.copyLink': 'Copy link',
    'handoff.linkCopied': 'Link copied',
    'handoff.editHandoff': 'Edit handoff',
    'handoff.print': 'Print',
    'handoff.sitterName': 'Sitter name',
    'handoff.sitterPhone': 'Sitter phone',
    'handoff.houseNotes': 'House notes',
    'handoff.deleteHandoff': 'Delete handoff',
    'common.save': 'Save',
    'common.saving': 'Saving…',
  },
  es: {
    'handoff.errorLoad': 'No se pudo cargar',
    'handoff.shareWithSitter': 'Compartir con la niñera',
    'handoff.copyLink': 'Copiar enlace',
    'handoff.linkCopied': 'Enlace copiado',
    'handoff.editHandoff': 'Editar entrega',
    'handoff.print': 'Imprimir',
    'handoff.sitterName': 'Nombre del cuidador',
    'handoff.sitterPhone': 'Teléfono del cuidador',
    'handoff.houseNotes': 'Notas de la casa',
    'handoff.deleteHandoff': 'Eliminar entrega',
    'common.save': 'Guardar',
    'common.saving': 'Guardando…',
  },
} as const

const mockT = (
  key: string,
  params?: Record<string, string | number>,
  scoped?: Record<string, Record<string, string>>,
) => {
  const scopedMessage = scoped?.[mockLocale]?.[key]
  const message = scopedMessage ?? baseCopy[mockLocale as 'en' | 'es'][key as keyof (typeof baseCopy)['en']] ?? key
  return message.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
}
jest.mock('@/i18n', () => ({
  useTranslation: () => {
    const [, setRender] = React.useState(0)
    const rerender = React.useCallback(() => setRender((value) => value + 1), [])
    React.useEffect(() => {
      mockLocaleRerenders.push(rerender)
      mockLocaleRerender = () => mockLocaleRerenders.forEach((refresh) => refresh())
      return () => {
        mockLocaleRerenders = mockLocaleRerenders.filter((refresh) => refresh !== rerender)
        mockLocaleRerender = mockLocaleRerenders.length
          ? () => mockLocaleRerenders.forEach((refresh) => refresh())
          : null
      }
    }, [rerender])
    return {
      locale: mockLocale,
      t: (key: string, params?: Record<string, string | number>, scoped?: Record<string, Record<string, string>>) =>
        mockT(key, params, scoped),
    }
  },
}))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import HandoffPage from '../page'

const FUTURE = '2099-01-01T00:00:00.000Z'
const PAST = '2020-01-01T00:00:00.000Z'

let handoff: Record<string, unknown>
let calls: { url: string; method: string }[]
let role: string
let failNextHandoffLoad: boolean
let malformedNextHandoffLoad: boolean

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

beforeEach(() => {
  calls = []
  role = 'parent'
  failNextHandoffLoad = false
  malformedNextHandoffLoad = false
  mockLocale = 'en'
  mockLocaleRerender = null
  mockLocaleRerenders = []
  handoff = {
    id: 'h1',
    sitter_name: 'Sarah',
    arrival_time: null,
    departure_time: null,
    share_token: 'oldtoken',
    share_expires_at: FUTURE,
  }
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method })
    if (url === '/api/auth/me') return reply({ user: { id: 'p1', role } })
    if (url === '/api/handoff') {
      if (failNextHandoffLoad) {
        failNextHandoffLoad = false
        return reply({ error: 'temporary failure' }, 503)
      }
      if (malformedNextHandoffLoad) {
        malformedNextHandoffLoad = false
        return reply({ handoffs: { id: 'not-a-list' } })
      }
      return reply({ handoffs: [handoff] })
    }
    if (url === '/api/handoff/h1/regenerate-token' && method === 'POST') {
      handoff = { ...handoff, share_token: 'newtoken', share_expires_at: FUTURE }
      return reply({ handoff })
    }
    return reply({})
  }) as unknown as typeof fetch
})

const renderPage = () =>
  render(
    <ToastProvider>
      <HandoffPage />
    </ToastProvider>
  )

const regenerateCalls = () => calls.filter((c) => c.url.endsWith('/regenerate-token'))

describe('handoff share', () => {
  it('updates a failed-load message when locale changes without refetching', async () => {
    failNextHandoffLoad = true
    renderPage()

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
    expect(calls.filter((call) => call.url === '/api/handoff')).toHaveLength(1)

    mockLocale = 'es'
    act(() => mockLocaleRerender?.())

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No se pudo cargar'))
    expect(calls.filter((call) => call.url === '/api/handoff')).toHaveLength(1)
  })

  it('recovers from an initial load failure with Retry', async () => {
    failNextHandoffLoad = true
    const user = userEvent.setup()
    renderPage()

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
    const retry = screen.getByRole('button', { name: 'routeState.tryAgain' })
    expect(retry.className).toMatch(/min-h-\[44px\]/)

    await user.click(retry)

    expect(await screen.findByText('Sarah')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(calls.filter((call) => call.url === '/api/handoff')).toHaveLength(2)
  })

  it('treats a malformed successful list as recoverable instead of rendering it', async () => {
    malformedNextHandoffLoad = true
    const user = userEvent.setup()
    renderPage()

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
    expect(screen.queryByText('Sarah')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'routeState.tryAgain' }))
    expect(await screen.findByText('Sarah')).toBeTruthy()
    expect(calls.filter((call) => call.url === '/api/handoff')).toHaveLength(2)
  })

  it('shows the existing link without making a new one, and Copy copies it within the tap', async () => {
    const user = userEvent.setup()
    const writeText = jest.spyOn(navigator.clipboard, 'writeText')
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Share with sitter' }))

    const dialog = await screen.findByRole('dialog', { name: 'Share with sitter' })
    const field = within(dialog).getByLabelText('Sitter link') as HTMLInputElement
    expect(field.value).toBe(`${window.location.origin}/handoff/oldtoken`)
    expect(field.readOnly).toBe(true)
    expect(regenerateCalls()).toHaveLength(0)

    const fetchesBefore = calls.length
    await user.click(within(dialog).getByRole('button', { name: /Copy link/ }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/handoff/oldtoken`)
    // No network request sits between the tap and the copy.
    expect(calls.length).toBe(fetchesBefore)
    expect(await screen.findByText('Link copied')).toBeTruthy()

    // Opening Share again still keeps the sitter's link.
    await user.click(within(dialog).getByRole('button', { name: 'Close handoff sharing' }))
    await user.click(screen.getByRole('button', { name: 'Share with sitter' }))
    expect(regenerateCalls()).toHaveLength(0)
  })

  it('makes a new link only after a warned confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Share with sitter' }))
    const dialog = await screen.findByRole('dialog', { name: 'Share with sitter' })

    await user.click(within(dialog).getByRole('button', { name: /Make a new link/ }))
    expect(within(dialog).getByText(/The link you already sent will stop working/)).toBeTruthy()
    expect(regenerateCalls()).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Keep current link' }))
    expect(regenerateCalls()).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: /Make a new link/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Make new link' }))

    await waitFor(() =>
      expect((within(dialog).getByLabelText('Sitter link') as HTMLInputElement).value).toBe(
        `${window.location.origin}/handoff/newtoken`
      )
    )
    expect(regenerateCalls()).toHaveLength(1)
  })

  it('an expired link says so and offers a new one', async () => {
    handoff = { ...handoff, share_expires_at: PAST }
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Share with sitter' }))
    const dialog = await screen.findByRole('dialog', { name: 'Share with sitter' })

    expect(within(dialog).getByText(/This link has expired/)).toBeTruthy()
    expect(within(dialog).queryByLabelText('Sitter link')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: /Make a new link/ }))
    await waitFor(() => expect(within(dialog).getByLabelText('Sitter link')).toBeTruthy())
    expect(regenerateCalls()).toHaveLength(1)
  })

  it('localizes the share controls in Spanish', async () => {
    mockLocale = 'es'
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Compartir con la niñera' }))

    const dialog = await screen.findByRole('dialog', { name: 'Compartir con la niñera' })
    expect(within(dialog).getByLabelText('Enlace para la niñera')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Copiar enlace' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Crear enlace nuevo' })).toBeTruthy()
  })

  it('card actions are 44px and the edit form is a labelled dialog', async () => {
    const user = userEvent.setup()
    handoff = { ...handoff, sitter_phone: '555-0100', house_notes: 'Alarm code' }
    renderPage()
    for (const name of ['Share with sitter', 'Print', 'Edit handoff']) {
      expect((await screen.findByRole('button', { name })).className).toMatch(/h-11 w-11/)
    }
    await user.click(screen.getByRole('button', { name: 'Edit handoff' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit handoff' })
    expect((within(dialog).getByLabelText('Sitter name') as HTMLInputElement).value).toBe('Sarah')
    const optionalDetails = within(dialog).getByTestId('handoff-optional-details') as HTMLDetailsElement
    expect(optionalDetails.open).toBe(false)
    await user.click(within(optionalDetails).getByText('Optional details'))
    expect((within(optionalDetails).getByLabelText('Sitter phone') as HTMLInputElement).value).toBe('555-0100')
    expect((within(optionalDetails).getByLabelText('House notes') as HTMLTextAreaElement).value).toBe('Alarm code')
    expect(within(dialog).getByTestId('handoff-form-footer')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Save' }).getAttribute('form')).toBe('handoff-edit-form')
    await user.click(within(dialog).getByRole('button', { name: 'Close handoff form' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the edit draft and blocks a second save while the request is pending', async () => {
    const user = userEvent.setup()
    let resolveSave!: (response: Response) => void
    const saveResponse = new Promise<Response>((resolve) => {
      resolveSave = resolve
    })
    const originalFetch = global.fetch
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/handoff/h1' && (init?.method ?? 'GET') === 'PATCH') {
        calls.push({ url: String(input), method: 'PATCH' })
        return saveResponse
      }
      return originalFetch(input, init)
    }) as unknown as typeof fetch

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Edit handoff' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit handoff' })
    const sitter = within(dialog).getByLabelText('Sitter name') as HTMLInputElement
    await user.clear(sitter)
    await user.type(sitter, 'Draft sitter')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    const saving = within(dialog).getByRole('button', { name: 'Saving…' }) as HTMLButtonElement
    expect(saving.disabled).toBe(true)
    expect((sitter.closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    expect(sitter.value).toBe('Draft sitter')
    expect(calls.filter((call) => call.url === '/api/handoff/h1' && call.method === 'PATCH')).toHaveLength(1)

    resolveSave(reply({ handoff }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit handoff' })).toBeNull())
  })
})
