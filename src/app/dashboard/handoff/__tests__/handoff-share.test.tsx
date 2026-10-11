/**
 * @jest-environment jsdom
 */
// Share used to make a new token on every tap, which killed the link the sitter
// already had, and copied only after a network wait (iOS Safari refuses that).
// Share now shows the current link with a Copy button that copies inside the
// tap; a new link is made only from an explicit, warned step.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'

const mockT = (key: string) => key
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT }) }))
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

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

beforeEach(() => {
  calls = []
  role = 'parent'
  failNextHandoffLoad = false
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
  it('recovers from an initial load failure with Retry', async () => {
    failNextHandoffLoad = true
    const user = userEvent.setup()
    renderPage()

    expect((await screen.findByRole('alert')).textContent).toContain('handoff.errorLoad')
    const retry = screen.getByRole('button', { name: 'routeState.tryAgain' })
    expect(retry.className).toMatch(/min-h-\[44px\]/)

    await user.click(retry)

    expect(await screen.findByText('Sarah')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(calls.filter((call) => call.url === '/api/handoff')).toHaveLength(2)
  })

  it('shows the existing link without making a new one, and Copy copies it within the tap', async () => {
    const user = userEvent.setup()
    const writeText = jest.spyOn(navigator.clipboard, 'writeText')
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'handoff.shareWithSitter' }))

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
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'handoff.shareWithSitter' }))
    expect(regenerateCalls()).toHaveLength(0)
  })

  it('makes a new link only after a warned confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'handoff.shareWithSitter' }))
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
    await user.click(await screen.findByRole('button', { name: 'handoff.shareWithSitter' }))
    const dialog = await screen.findByRole('dialog', { name: 'Share with sitter' })

    expect(within(dialog).getByText(/This link has expired/)).toBeTruthy()
    expect(within(dialog).queryByLabelText('Sitter link')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: /Make a new link/ }))
    await waitFor(() => expect(within(dialog).getByLabelText('Sitter link')).toBeTruthy())
    expect(regenerateCalls()).toHaveLength(1)
  })

  it('card actions are 44px and the edit form is a labelled dialog', async () => {
    const user = userEvent.setup()
    renderPage()
    for (const name of ['handoff.shareWithSitter', 'handoff.print', 'handoff.editHandoff']) {
      expect((await screen.findByRole('button', { name })).className).toMatch(/h-11 w-11/)
    }
    await user.click(screen.getByRole('button', { name: 'handoff.editHandoff' }))
    const dialog = screen.getByRole('dialog', { name: 'handoff.editHandoff' })
    expect((within(dialog).getByLabelText('handoff.sitterName') as HTMLInputElement).value).toBe('Sarah')
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
