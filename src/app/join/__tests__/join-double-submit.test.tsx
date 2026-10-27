/**
 * @jest-environment jsdom
 */
// After a successful join the page waits before redirecting. The Join button
// used to come back during that pause, so a second tap sent a second join.
import * as React from 'react'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'

const push = jest.fn()
const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))
const releaseBeforeNavigation = jest.fn(async () => true)
jest.mock('@/components/layout/pending-form-navigation', () => ({
  usePendingFormNavigationController: () => ({ releaseBeforeNavigation }),
}))

import JoinFamilyPage from '../page'

const renderJoin = () => render(<I18nProvider locale="en"><JoinFamilyPage /></I18nProvider>)

let joinCalls: number

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

beforeEach(() => {
  joinCalls = 0
  push.mockClear()
  releaseBeforeNavigation.mockClear()
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
  renderJoin()

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
    await Promise.resolve()
  })
  expect(releaseBeforeNavigation).toHaveBeenCalledTimes(1)
  expect(releaseBeforeNavigation.mock.invocationCallOrder[0]).toBeLessThan(
    push.mock.invocationCallOrder[0],
  )
  expect(push).toHaveBeenCalledWith('/dashboard')
  expect(joinCalls).toBe(1)
})

it('a double tap on an email invite sends one join', async () => {
  window.history.replaceState(null, '', '/join?token=tok123')
  const user = userEvent.setup()
  renderJoin()

  const join = await screen.findByRole('button', { name: /Join family/ })
  await user.dblClick(join)
  await screen.findByText(/Joined The Smiths/)
  expect(joinCalls).toBe(1)
})

it('releases the pending guard before a signed-out email redirect', async () => {
  window.history.replaceState(null, '', '/join?token=tok123')
  const user = userEvent.setup()
  let authReads = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/me') {
      authReads += 1
      return reply(authReads === 1 ? { user: { id: 'k1' } } : {})
    }
    if (url.startsWith('/api/family/invites/preview'))
      return reply({ familyName: 'The Smiths', role: 'teen', email: 'kid@example.com' })
    if (url === '/api/family/join' && init?.method === 'POST') return reply({ familyName: 'The Smiths' })
    return reply({})
  }) as unknown as typeof fetch

  renderJoin()
  const join = await screen.findByRole('button', { name: /Join family/ })
  await user.click(join)

  expect(releaseBeforeNavigation).toHaveBeenCalledTimes(1)
  expect(releaseBeforeNavigation.mock.invocationCallOrder[0]).toBeLessThan(
    push.mock.invocationCallOrder[0],
  )
  expect(push).toHaveBeenCalledWith('/register?token=tok123')
  expect((screen.getByRole('button', { name: /Joining/ }) as HTMLButtonElement).disabled).toBe(true)
})

// Recovery source cases; consolidated QA remains deferred.
it('retries paused dashboard navigation without joining the household a second time', async () => {
  jest.useFakeTimers()
  releaseBeforeNavigation.mockResolvedValueOnce(false)
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
  renderJoin()
  await user.type(screen.getByLabelText('Family Code'), 'ABC123')
  await user.click(screen.getByRole('button', { name: 'Check Code' }))
  await screen.findByText('Ready to join as a child or teen.')
  await user.click(screen.getByRole('button', { name: 'Join Family' }))
  await screen.findByText('Successfully joined The Smiths!')
  await act(async () => { jest.advanceTimersByTime(2500); await Promise.resolve() })
  expect(push).not.toHaveBeenCalled()
  expect(joinCalls).toBe(1)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(push).toHaveBeenCalledWith('/dashboard')
  expect(releaseBeforeNavigation).toHaveBeenCalledTimes(2)
  expect(joinCalls).toBe(1)
})
it('retries only registration navigation when the email-invite session has expired', async () => {
  window.history.replaceState(null, '', '/join?token=fixture-token')
  let authReads = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/auth/me') {
      authReads++
      return authReads === 1 ? reply({ user: { id: 'fixture-user' } }) : reply({ error: 'Unauthorized' }, 401)
    }
    if (url.startsWith('/api/family/invites/preview')) return reply({ familyName: 'Fixture family', role: 'teen', email: 'fixture@example.test' })
    if (url === '/api/family/join') { joinCalls++; return reply({ familyName: 'Fixture family' }) }
    throw new Error('Unexpected fixture request')
  }) as unknown as typeof fetch
  releaseBeforeNavigation.mockResolvedValueOnce(false)
  const user = userEvent.setup()
  renderJoin()
  await user.click(await screen.findByRole('button', { name: 'Join family' }))
  await screen.findByRole('button', { name: 'Continue' })
  expect(joinCalls).toBe(0)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(push).toHaveBeenCalledWith('/register?token=fixture-token')
  expect(authReads).toBe(2)
  expect(joinCalls).toBe(0)
})
