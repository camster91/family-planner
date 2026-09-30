/**
 * @jest-environment jsdom
 */
// Email confirm page (O-24): opening the page must not call the verify API
// (a mail scanner only opens links); only "Confirm my email" POSTs the token.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { confirmEmailToken, verifyOutcomeFor, VERIFY_MESSAGES } from '@/lib/verify-email'

const replace = jest.fn()
let search = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => search,
}))

import VerifyEmailPage from '../page'

type Reply = { status: number; body: unknown } | 'network-error'
let reply: Reply
let calls: { url: string; method: string; body: unknown }[] = []

beforeEach(() => {
  replace.mockReset()
  calls = []
  search = new URLSearchParams('token=abc123')
  reply = { status: 200, body: { status: 'verified' } }
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    if (reply === 'network-error') throw new TypeError('Failed to fetch')
    const { status, body } = reply
    return { ok: status < 400, status, json: async () => body } as Response
  }) as unknown as typeof fetch
})

describe('/verify-email page', () => {
  it('opening the page calls nothing', async () => {
    render(<VerifyEmailPage />)
    expect(await screen.findByRole('button', { name: 'Confirm my email' })).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('the button POSTs the token and goes to sign-in on success', async () => {
    const user = userEvent.setup()
    render(<VerifyEmailPage />)
    await user.click(await screen.findByRole('button', { name: 'Confirm my email' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?verified=1'))
    expect(calls).toEqual([{ url: '/api/auth/verify-email', method: 'POST', body: { token: 'abc123' } }])
  })

  it('an already-used link says the email is already verified', async () => {
    reply = { status: 200, body: { status: 'already_verified' } }
    const user = userEvent.setup()
    render(<VerifyEmailPage />)
    await user.click(await screen.findByRole('button', { name: 'Confirm my email' }))
    expect((await screen.findByRole('status')).textContent).toBe(VERIFY_MESSAGES.already_verified)
    expect(screen.queryByRole('button', { name: 'Confirm my email' })).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it('an expired link explains how to get a new one', async () => {
    reply = { status: 400, body: { status: 'invalid', error: 'Invalid or expired verification link' } }
    const user = userEvent.setup()
    render(<VerifyEmailPage />)
    await user.click(await screen.findByRole('button', { name: 'Confirm my email' }))
    expect((await screen.findByRole('alert')).textContent).toBe(VERIFY_MESSAGES.invalid)
    expect(screen.queryByRole('button', { name: 'Confirm my email' })).toBeNull()
  })

  it('a network failure shows an error and keeps the button to retry', async () => {
    reply = 'network-error'
    const user = userEvent.setup()
    render(<VerifyEmailPage />)
    await user.click(await screen.findByRole('button', { name: 'Confirm my email' }))
    expect((await screen.findByRole('alert')).textContent).toBe(VERIFY_MESSAGES.error)
    expect(screen.getByRole('button', { name: 'Confirm my email' })).toBeTruthy()
  })

  it('a link without a token shows no button and calls nothing', async () => {
    search = new URLSearchParams()
    render(<VerifyEmailPage />)
    expect(await screen.findByText(/verification link is incomplete/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirm my email' })).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('verifyOutcomeFor', () => {
  it.each([
    [200, { status: 'verified' }, 'verified'],
    [200, { status: 'already_verified' }, 'already_verified'],
    [200, {}, 'error'],
    [400, { status: 'invalid' }, 'invalid'],
    [429, { error: 'Too many' }, 'rate_limited'],
    [500, { error: 'x' }, 'error'],
    [502, null, 'error'],
  ])('%i %p is %s', (status, body, expected) => {
    expect(verifyOutcomeFor(status, body)).toBe(expected)
  })

  it('confirmEmailToken never throws on a body that is not JSON', async () => {
    const fetchImpl = jest.fn(async () => ({
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    })) as unknown as typeof fetch
    await expect(confirmEmailToken('t', fetchImpl)).resolves.toBe('error')
  })
})
