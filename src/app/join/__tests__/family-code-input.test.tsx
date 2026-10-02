/**
 * @jest-environment jsdom
 */
// The family code field is set up for typing a code read aloud on a phone:
// capitals keyboard, no autocomplete or spellcheck, room for old 24/25-char
// codes with separators. What the person typed is sent as is; the server
// normalizes it (src/lib/family-code.ts).
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

import JoinFamilyPage from '../page'

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response
let calls: Array<{ url: string; body?: string }>

beforeEach(() => {
  calls = []
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
  render(<JoinFamilyPage />)
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
  render(<JoinFamilyPage />)
  await user.type(screen.getByLabelText('Family Code'), 'K7QM-4XPD-2HNA')
  await user.click(screen.getByRole('button', { name: 'Check Code' }))
  await screen.findByText('Ready to join as a child or teen.')
  expect(calls.some((c) => c.url === '/api/family/lookup?code=K7QM-4XPD-2HNA')).toBe(true)

  await user.click(screen.getByRole('button', { name: /Join Family/ }))
  await screen.findByText('Successfully joined The Smiths!')
  const joinCall = calls.find((c) => c.url === '/api/family/join')
  expect(JSON.parse(joinCall!.body!)).toEqual({ inviteCode: 'K7QM-4XPD-2HNA' })
})
