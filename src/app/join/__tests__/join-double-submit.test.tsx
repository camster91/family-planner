/**
 * @jest-environment jsdom
 */
// After a successful join the page waits before redirecting. The Join button
// used to come back during that pause, so a second tap sent a second join.
import * as React from 'react'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = jest.fn()
const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))

import JoinFamilyPage from '../page'

let joinCalls: number

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

beforeEach(() => {
  joinCalls = 0
  push.mockClear()
  window.history.replaceState(null, '', '/join')
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/me') return reply({ user: { id: 'k1' } })
    if (url.startsWith('/api/family/lookup')) return reply({ family: { name: 'The Smiths' } })
    if (url.startsWith('/api/family/invites/preview'))
      return reply({ familyName: 'The Smiths', role: 'teen', email: 'kid@example.com' })
    if (url === '/api/family/join' && init?.method === 'POST') {
      joinCalls += 1
      return reply({ familyName: 'The Smiths' })
    }
    return reply({})
  }) as unknown as typeof fetch
})

afterEach(() => {
  jest.useRealTimers()
})

it('keeps Join Family disabled after a successful join until the redirect', async () => {
  jest.useFakeTimers()
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
  render(<JoinFamilyPage />)

  await user.type(screen.getByLabelText('Family Code'), 'ABC123')
  await user.click(screen.getByRole('button', { name: 'Check Code' }))
  await screen.findByText('Ready to join as a child or teen.')

  const join = screen.getByRole('button', { name: /Join Family/ })
  await user.click(join)
  await screen.findByText('Successfully joined The Smiths!')

  const button = screen.getByRole('button', { name: /Joining/ }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  await user.click(button)
  expect(joinCalls).toBe(1)

  await act(async () => {
    jest.advanceTimersByTime(2500)
  })
  expect(push).toHaveBeenCalledWith('/dashboard')
  expect(joinCalls).toBe(1)
})

it('a double tap on an email invite sends one join', async () => {
  window.history.replaceState(null, '', '/join?token=tok123')
  const user = userEvent.setup()
  render(<JoinFamilyPage />)

  const join = await screen.findByRole('button', { name: /Join family/ })
  await user.dblClick(join)
  await screen.findByText(/Joined The Smiths/)
  expect(joinCalls).toBe(1)
})
