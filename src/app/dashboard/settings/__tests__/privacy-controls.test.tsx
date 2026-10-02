/**
 * @jest-environment jsdom
 */
// Settings → Privacy & data (F-3, D-3): every control does something.
// No Two-Factor Authentication entry (the app has no 2FA); Data Export
// downloads GET /api/users/export; Delete Account opens the in-page dialog.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsClient from '../SettingsClient'

// SettingsClient refreshes the server layout after a profile save.
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  ),
}))

function mockApi() {
  const urls: string[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    const body =
      url === '/api/users/deletion'
        ? {
            role: 'parent',
            household: { id: 'f', name: 'Home', memberCount: 2, parentCount: 2 },
            isOnlyParent: false,
            canDeleteAccount: true,
            canDeleteHousehold: false,
          }
        : url === '/api/users'
          ? { user: { name: 'Pat', email: 'pat@example.test', role: 'parent', age: null } }
          : {}
    const status = url === '/api/users/deletion' || url === '/api/users' || url === '/api/users/export' ? 200 : 404
    return { ok: status === 200, status, json: async () => body, blob: async () => new Blob(['{}']) } as Response
  }) as unknown as typeof fetch
  return urls
}

beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia)
})

describe('Settings privacy controls', () => {
  it('has no Two-Factor Authentication control', async () => {
    mockApi()
    render(<SettingsClient viewerRole="parent" sharedDevice={null} />)
    expect(await screen.findByRole('heading', { name: 'Privacy & data' })).toBeTruthy()
    expect(screen.queryByText(/Two-Factor/i)).toBeNull()
  })

  it('Data Export downloads the export', async () => {
    const urls = mockApi()
    Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:x'), revokeObjectURL: jest.fn() })
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<SettingsClient viewerRole="parent" sharedDevice={null} />)
    await userEvent.click(await screen.findByRole('button', { name: /Data Export/ }))
    await waitFor(() => expect(urls).toContain('/api/users/export'))
    await waitFor(() => expect(click).toHaveBeenCalled())
    click.mockRestore()
  })

  it('Delete Account opens the confirmation dialog in the page', async () => {
    mockApi()
    window.confirm = jest.fn(() => true)
    render(<SettingsClient viewerRole="parent" sharedDevice={null} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Account' }))
    expect(await screen.findByRole('dialog', { name: 'Delete account' })).toBeTruthy()
    expect(await screen.findByLabelText('Your password')).toBeTruthy()
    expect(window.confirm).not.toHaveBeenCalled()
  })
})
