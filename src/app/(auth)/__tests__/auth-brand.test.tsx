/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import LoginPage from '../login/page'
import RegisterPage from '../register/page'
import ForgotPasswordPage from '../forgot-password/page'
import { I18nProvider } from '@/i18n'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('@/lib/offline-queue-browser', () => ({ clearAllPersonQueues: jest.fn() }))

it('announces recovery errors and keeps the sign-in escape available', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Please try again later.' }) })
  const { container } = render(<I18nProvider><ForgotPasswordPage /></I18nProvider>)
  fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'synthetic@example.test' } })
  fireEvent.submit(container.querySelector('form')!)
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again later.')
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
})

it('names the Herewoven account while retaining sign-in and recovery controls', () => {
  render(<I18nProvider><LoginPage /></I18nProvider>)
  expect(screen.getByText('Sign in to your Herewoven account')).toBeInTheDocument()
  expect(screen.getByLabelText('Email Address')).toHaveAttribute('autocomplete', 'username')
  expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
  expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/forgot-password')
  expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms')
  expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
  // Reads as a sentence: "...our Terms of Service and Privacy Policy".
  expect(screen.getByRole('link', { name: 'Terms of Service' }).parentElement).toHaveTextContent(
    'By signing in, you agree to our Terms of Service and Privacy Policy'
  )
})

it('announces a registration mismatch without losing entered values or promising pricing', () => {
  const { container } = render(<I18nProvider><RegisterPage /></I18nProvider>)
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-long-password' } })
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'different-synthetic-password' } })
  fireEvent.submit(container.querySelector('form')!)
  expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match')
  expect(screen.getByLabelText('Password')).toHaveValue('synthetic-long-password')
  expect(document.body).not.toHaveTextContent(/Free during the beta|Never ask for payment details/i)
})
