/** @jest-environment jsdom */
// A family code survives sign-up (owner-approved review item B6): a
// signed-out person who enters a code on /join and creates an account is
// brought back to /join?code=... after verify email and their first sign-in,
// so they join that family instead of starting a second household. The code
// only ever travels as a same-origin path (and this browser's own storage).
// Also: "Have a family code? Join your family" on landing, sign-in, sign-up (B5).
import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'
import {
  clearPendingJoin,
  joinReturnPath,
  pendingJoinPath,
  readPendingJoin,
  rememberPendingJoin,
  withJoinRedirect,
} from '@/lib/pending-join'
import { replaceWithFreshDocument } from '@/lib/auth-navigation'

const routerReplace = jest.fn()
let search = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => search,
}))
jest.mock('@/lib/auth-navigation', () => ({ replaceWithFreshDocument: jest.fn() }))
jest.mock('@/lib/offline-queue-browser', () => ({ clearAllPersonQueues: jest.fn() }))
jest.mock('@/lib/capture-recovery-storage', () => ({ clearCaptureRecoveryStorage: jest.fn() }))
jest.mock('@/components/ui/brand-illustration', () => ({
  BrandMark: () => <span aria-hidden="true" />,
  BrandIllustration: () => <div />,
}))

import Home from '../page'
import LoginPage from '../(auth)/login/page'
import RegisterPage from '../(auth)/register/page'
import VerifyEmailPage from '../(auth)/verify-email/page'

const CODE = 'K7QM-4XPD-2HNA'
const JOIN = `/join?code=${CODE}`
const ENCODED_JOIN = encodeURIComponent(JOIN)
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response
const mount = (node: React.ReactNode) => render(<I18nProvider locale="en">{node}</I18nProvider>)

beforeEach(() => {
  window.localStorage.clear()
  routerReplace.mockReset()
  ;(replaceWithFreshDocument as jest.Mock).mockReset()
  window.history.replaceState(null, '', '/')
  global.fetch = jest.fn(async () => reply({})) as unknown as typeof fetch
})

describe('pending join path', () => {
  it('accepts only an in-app /join?code=... path', () => {
    expect(joinReturnPath(` ${CODE} `)).toBe(JOIN)
    expect(pendingJoinPath(JOIN)).toBe(JOIN)
    for (const bad of [
      '//evil.example/join?code=X',
      '/\\evil.example/join?code=X',
      'https://evil.example/join?code=X',
      '/dashboard',
      '/join',
      '/join?token=abc',
      '/join/other?code=X',
      `/join?code=${'x'.repeat(65)}`,
      null,
      '',
    ]) {
      expect(pendingJoinPath(bad)).toBeNull()
    }
  })

  it('adds the redirect to a sign-in link, and nothing without one', () => {
    expect(withJoinRedirect('/login', JOIN)).toBe(`/login?redirect=${ENCODED_JOIN}`)
    expect(withJoinRedirect('/login?verified=1', JOIN)).toBe(`/login?verified=1&redirect=${ENCODED_JOIN}`)
    expect(withJoinRedirect('/login', null)).toBe('/login')
  })

  it('is kept in this browser for a short time only, and never anything but a join path', () => {
    const now = Date.parse('2026-11-19T12:00:00Z')
    rememberPendingJoin('/dashboard/settings', now)
    expect(readPendingJoin(now)).toBeNull()
    rememberPendingJoin(JOIN, now)
    expect(readPendingJoin(now + 60 * 60 * 1000)).toBe(JOIN)
    // Older than two days: forgotten and removed.
    expect(readPendingJoin(now + 49 * 60 * 60 * 1000)).toBeNull()
    expect(window.localStorage.getItem('fp:pending-join')).toBeNull()
    rememberPendingJoin(JOIN, now)
    clearPendingJoin()
    expect(readPendingJoin(now)).toBeNull()
  })
})

describe('"Have a family code?" entry', () => {
  it('is on the landing page, sign-in and sign-up, linking to /join', () => {
    const landing = mount(<Home />)
    expect(screen.getByTestId('family-code-entry')).toHaveTextContent('Have a family code?')
    expect(screen.getByRole('link', { name: 'Join your family' })).toHaveAttribute('href', '/join')
    landing.unmount()

    window.history.replaceState(null, '', '/login')
    const login = mount(<LoginPage />)
    expect(screen.getByRole('link', { name: 'Join your family' })).toHaveAttribute('href', '/join')
    login.unmount()

    window.history.replaceState(null, '', '/register')
    mount(<RegisterPage />)
    expect(screen.getByRole('link', { name: 'Join your family' })).toHaveAttribute('href', '/join')
  })
})

describe('a family code carried through sign-up', () => {
  it('sign-in to join offers sign-up that keeps the code', async () => {
    window.history.replaceState(null, '', `/login?redirect=${ENCODED_JOIN}`)
    mount(<LoginPage />)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', `/register?redirect=${ENCODED_JOIN}`),
    )
    // Already on the way to join: no second "join your family" offer.
    expect(screen.queryByTestId('family-code-entry')).toBeNull()
  })

  it('register keeps the code out of the request, and every sign-in link returns to /join?code=...', async () => {
    window.history.replaceState(null, '', `/register?redirect=${ENCODED_JOIN}`)
    global.fetch = jest.fn(async () => reply({ requiresVerification: true })) as unknown as typeof fetch
    const { container } = mount(<RegisterPage />)
    expect(await screen.findByTestId('register-join-note')).toHaveTextContent('come back here to join with this code')
    expect(screen.queryByTestId('family-code-entry')).toBeNull()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', `/login?redirect=${ENCODED_JOIN}`)
    // Kept in this browser for the emailed link, which may open in a new tab.
    expect(readPendingJoin()).toBe(JOIN)

    fireEvent.change(container.querySelector('#name')!, { target: { value: 'New Kid' } })
    fireEvent.change(container.querySelector('#email')!, { target: { value: 'kid@example.test' } })
    fireEvent.change(container.querySelector('#password')!, { target: { value: 'long-enough-1' } })
    fireEvent.change(container.querySelector('#confirmPassword')!, { target: { value: 'long-enough-1' } })
    fireEvent.click(container.querySelector('#terms')!)
    fireEvent.submit(container.querySelector('form')!)

    expect(await screen.findByText('Check Your Email')).toBeInTheDocument()
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toEqual({ email: 'kid@example.test', password: 'long-enough-1', name: 'New Kid' })
    expect(JSON.stringify(body)).not.toContain(CODE)
    expect(screen.getByRole('link', { name: 'Go to Sign In' })).toHaveAttribute('href', `/login?redirect=${ENCODED_JOIN}`)
  })

  it('ignores a redirect that is not a same-origin join path', async () => {
    window.history.replaceState(null, '', `/register?redirect=${encodeURIComponent('https://evil.example/join?code=X')}`)
    mount(<RegisterPage />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login'))
    expect(screen.queryByTestId('register-join-note')).toBeNull()
    expect(readPendingJoin()).toBeNull()
  })

  it('verify email sends the new account to sign in, then back to the code', async () => {
    rememberPendingJoin(JOIN)
    search = new URLSearchParams('token=abc123')
    global.fetch = jest.fn(async () => reply({ status: 'verified' })) as unknown as typeof fetch
    const user = userEvent.setup()
    mount(<VerifyEmailPage />)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', `/login?redirect=${ENCODED_JOIN}`),
    )
    await user.click(screen.getByRole('button', { name: 'Confirm my email' }))
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith(`/login?verified=1&redirect=${ENCODED_JOIN}`))
  })

  it('verify email without a kept code goes to plain sign in, as before', async () => {
    search = new URLSearchParams('token=abc123')
    global.fetch = jest.fn(async () => reply({ status: 'verified' })) as unknown as typeof fetch
    const user = userEvent.setup()
    mount(<VerifyEmailPage />)
    await user.click(await screen.findByRole('button', { name: 'Confirm my email' }))
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/login?verified=1'))
  })

  it('the first sign-in lands on /join?code=... and forgets the kept code', async () => {
    rememberPendingJoin(JOIN)
    window.history.replaceState(null, '', `/login?verified=1&redirect=${ENCODED_JOIN}`)
    global.fetch = jest.fn(async () => reply({ user: { id: 'k1' } })) as unknown as typeof fetch
    const { container } = mount(<LoginPage />)
    fireEvent.change(container.querySelector('#email')!, { target: { value: 'kid@example.test' } })
    fireEvent.change(container.querySelector('#password')!, { target: { value: 'long-enough-1' } })
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(replaceWithFreshDocument).toHaveBeenCalledWith(JOIN))
    expect(readPendingJoin()).toBeNull()
  })
})
