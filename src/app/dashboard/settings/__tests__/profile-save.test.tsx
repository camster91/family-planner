/**
 * @jest-environment jsdom
 */
// Saving the profile refreshes the server-rendered layout, so the nav's name
// and initials show the new name without a reload. A failed save does not.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsClient from '../SettingsClient'
import { I18nProvider } from '@/i18n'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: jest.fn() }) }))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}))

function mockApi(patch: { status: number; body: unknown }) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as Response
    if (url === '/api/users' && method === 'PATCH') return reply(patch.status, patch.body)
    if (url === '/api/users') {
      return reply(200, { user: { name: 'Pat', email: 'pat@example.test', role: 'parent', age: null } })
    }
    return reply(404, {})
  }) as unknown as typeof fetch
}

function renderSettings() {
  return render(
    <I18nProvider locale="en">
      <SettingsClient sharedDevice={null} />
    </I18nProvider>
  )
}

beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia)
})

beforeEach(() => refresh.mockReset())

describe('Settings profile save', () => {
  it('refreshes the layout after a successful save', async () => {
    const user = userEvent.setup()
    mockApi({ status: 200, body: { user: { name: 'Pat Rivera' } } })
    renderSettings()
    const name = await screen.findByLabelText('Full Name')
    await waitFor(() => expect((name as HTMLInputElement).value).toBe('Pat'))
    await user.clear(name)
    await user.type(name, 'Pat Rivera')
    await user.click(screen.getByRole('button', { name: 'Save Profile' }))
    expect(await screen.findByText('Profile updated successfully!')).toBeTruthy()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh when the save is refused', async () => {
    const user = userEvent.setup()
    mockApi({ status: 400, body: { error: 'Name is required' } })
    renderSettings()
    await screen.findByLabelText('Full Name')
    await user.click(screen.getByRole('button', { name: 'Save Profile' }))
    expect(await screen.findByText('Name is required')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })
})
