/**
 * @jest-environment jsdom
 */
// The family code field is set up for typing a code read aloud on a phone:
// capitals keyboard, no autocomplete or spellcheck, room for old 24/25-char
// codes with separators. What the person typed is sent as is; the server
// normalizes it (src/lib/family-code.ts).
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'

const push = jest.fn()
const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))

import JoinFamilyPage from '../page'

const renderJoin = () => render(<I18nProvider locale="en"><JoinFamilyPage /></I18nProvider>)

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response
let calls: Array<{ url: string; body?: string }>

beforeEach(() => {
  calls = []
  push.mockClear()
  refresh.mockClear()
  window.history.replaceState(null, '', '/join')
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: init?.body as string | undefined })
    if (url === '/api/auth/me') return reply({ user: { id: 'k1' } })
    if (url.startsWith('/api/family/lookup')) return reply({ family: { name: 'The Smiths' } })
    if (url === '/api/family/join') return reply({ familyName: 'The Smiths' })
    return reply({})
  }) as unknown as typeof fetch
})

it('sets the field up for typing a code on a phone', () => {
  renderJoin()
  const input = screen.getByLabelText('Family Code') as HTMLInputElement
  expect(input.getAttribute('autocapitalize')).toBe('characters')
  expect(input.getAttribute('autocomplete')).toBe('off')
  expect(input.getAttribute('spellcheck')).toBe('false')
  expect(input.getAttribute('inputmode')).toBe('text')
  // An old 25-char cuid grouped in 4s with separators still fits.
  expect(input.maxLength).toBeGreaterThanOrEqual(32)
  const hint = document.getElementById(input.getAttribute('aria-describedby')!)
  expect(hint?.textContent).toBe('Capitals, spaces and dashes don’t matter.')
})

it('looks up and joins with the code as typed (XXXX-XXXX-XXXX)', async () => {
  const user = userEvent.setup()
  renderJoin()
  await user.type(screen.getByLabelText('Family Code'), 'K7QM-4XPD-2HNA')
  await user.click(screen.getByRole('button', { name: 'Check Code' }))
  await screen.findByText('Ready to join as a child or teen.')
  expect(calls.some((c) => c.url === '/api/family/lookup?code=K7QM-4XPD-2HNA')).toBe(true)

  await user.click(screen.getByRole('button', { name: /Join Family/ }))
  await screen.findByText('Successfully joined The Smiths!')
  const joinCall = calls.find((c) => c.url === '/api/family/join')
  expect(JSON.parse(joinCall!.body!)).toEqual({ inviteCode: 'K7QM-4XPD-2HNA' })
})

it('says nothing scary when a signed-out person opens a code link', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push({ url })
    if (url.startsWith('/api/family/lookup')) return reply({ error: 'Unauthorized' }, 401)
    if (url === '/api/auth/me') return reply({ error: 'Unauthorized' }, 401)
    return reply({})
  }) as unknown as typeof fetch
  window.history.replaceState(null, '', '/join?code=K7QM-4XPD-2HNA')
  renderJoin()
  await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/family/lookup'))).toBe(true))
  expect(screen.queryByText('Unauthorized')).toBeNull()
  expect((screen.getByLabelText('Family Code') as HTMLInputElement).value).toBe('K7QM-4XPD-2HNA')
  expect(screen.getByRole('status').textContent).toContain('Sign in to continue joining this family.')
  expect(screen.getByRole('link', { name: 'Sign in to join' }).getAttribute('href')).toBe(
    '/login?redirect=%2Fjoin%3Fcode%3DK7QM-4XPD-2HNA',
  )
  expect(screen.queryByRole('button', { name: 'Sign in to join' })).toBeNull()
})
