/** @jest-environment jsdom */
import * as React from 'react'
import { randomBytes } from 'crypto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import RegisterPage from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const response = (body: unknown, ok = true) => ({ ok, json: async () => body })

// Use the native setter without input/change events, as an autofill provider can.
function autofill(container: HTMLElement, values: Record<string, string>) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  for (const [name, value] of Object.entries(values)) {
    setter.call(container.querySelector(`#${name}`), value)
  }
}

beforeEach(() => {
  window.history.replaceState({}, '', '/register')
  global.fetch = jest.fn().mockResolvedValue(response({}))
})

test('submits generated passwords and autofilled identity without typing events', async () => {
  const { container } = render(<RegisterPage />)
  const secret = randomBytes(20).toString('base64url')
  autofill(container, { name: 'Autofill Parent', email: 'autofill@example.test', password: secret, confirmPassword: secret })
  fireEvent.click(container.querySelector('#terms')!)
  expect(container.querySelector<HTMLFormElement>('form')!.checkValidity()).toBe(true)
  fireEvent.submit(container.querySelector('form')!)
  await screen.findByText('Check Your Email')
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
    name: 'Autofill Parent', email: 'autofill@example.test', password: secret,
  })
})

test('preserves autofilled passwords across a validation error and allows correction', async () => {
  const { container } = render(<RegisterPage />)
  const secret = randomBytes(20).toString('base64url')
  autofill(container, { name: 'Autofill Parent', email: 'autofill@example.test', password: secret, confirmPassword: secret + 'x' })
  fireEvent.submit(container.querySelector('form')!)
  await screen.findByText('auth.passwordMismatch')
  expect(global.fetch).not.toHaveBeenCalled()
  expect(container.querySelector<HTMLInputElement>('[name="password"]')!.value).toBe(secret)
  autofill(container, { confirmPassword: secret })
  fireEvent.submit(container.querySelector('form')!)
  await screen.findByText('Check Your Email')
  expect(global.fetch).toHaveBeenCalledTimes(1)
})

test('keeps the invite email authoritative when submitting autofilled values', async () => {
  window.history.replaceState({}, '', '/register?token=fixture-invite')
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response({ email: 'invited@example.test', familyName: 'Fixture home', role: 'parent' }))
    .mockResolvedValueOnce(response({}))
  const { container } = render(<RegisterPage />)
  await waitFor(() => expect(container.querySelector<HTMLInputElement>('#email')!.readOnly).toBe(true))
  const secret = randomBytes(20).toString('base64url')
  autofill(container, { name: 'Invited Parent', email: 'different@example.test', password: secret, confirmPassword: secret })
  fireEvent.submit(container.querySelector('form')!)
  await screen.findByText('Check Your Email')
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)).toMatchObject({
    email: 'invited@example.test', inviteToken: 'fixture-invite', password: secret,
  })
})
