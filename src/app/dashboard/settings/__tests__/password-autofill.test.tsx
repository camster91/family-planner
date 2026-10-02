/** @jest-environment jsdom */
import * as React from 'react'
import { randomBytes } from 'crypto'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import SettingsClient from '../SettingsClient'
import { I18nProvider } from '@/i18n'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))

beforeAll(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
})

test('Settings accepts autofilled passwords without change events, including retry after rejection', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = url === '/api/users' ? { user: { name: 'QA Parent', email: 'qa@example.test', role: 'parent', age: null } } : { error: 'Synthetic rejection' }
    return { ok: url === '/api/users', status: url === '/api/users' ? 200 : 400, json: async () => body }
  }) as unknown as typeof fetch
  render(<I18nProvider locale="en"><SettingsClient viewerRole="parent" sharedDevice={null} /></I18nProvider>)
  await waitFor(() => expect((screen.getByLabelText('Full Name') as HTMLInputElement).value).toBe('QA Parent'))
  fireEvent.click(screen.getByRole('button', { name: /Change Password/ }))
  const dialog = screen.getByRole('dialog', { name: 'Change Password' })
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  const current = randomBytes(20).toString('base64url')
  const generated = randomBytes(20).toString('base64url')
  setter.call(within(dialog).getByLabelText('Current Password'), current)
  setter.call(within(dialog).getByLabelText('New Password', { exact: true }), generated)
  setter.call(within(dialog).getByLabelText('Confirm New Password'), generated)
  expect((within(dialog).getByRole('button', { name: 'Change Password' }) as HTMLButtonElement).disabled).toBe(false)
  expect(dialog.querySelector<HTMLFormElement>('form')!.checkValidity()).toBe(true)
  fireEvent.submit(dialog.querySelector('form')!)
  await within(dialog).findByText('Synthetic rejection')
  expect((within(dialog).getByLabelText('New Password', { exact: true }) as HTMLInputElement).value).toBe(generated)
  fireEvent.submit(dialog.querySelector('form')!)
  await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/auth/change-password')).toHaveLength(2))
  const calls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/auth/change-password')
  expect(JSON.parse(calls[1][1].body)).toEqual({ currentPassword: current, newPassword: generated })
})
