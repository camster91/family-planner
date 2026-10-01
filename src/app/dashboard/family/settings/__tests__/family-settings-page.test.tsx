/**
 * @jest-environment jsdom
 */
// Family settings showed Timezone and Currency selects that were never saved,
// then said "Family settings updated successfully!". They are gone (per-household
// time zone is deferred, decision O-31; there is no currency field), and the
// message now says only what was saved: the family name.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FamilySettingsPage from '../page'

jest.mock('@/components/fridge/BoardSettings', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/account/DeleteAccountDialog', () => ({ __esModule: true, default: () => null }))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}))

type Call = { url: string; method: string; body: any }

function mockFetch(patch: { status: number; body: unknown }) {
  const calls: Call[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as Response
    if (url === '/api/auth/me') {
      return reply(200, { user: { role: 'parent', family_id: 'fam_1', family: { name: 'Rivera' } } })
    }
    if (url === '/api/family' && method === 'PATCH') return reply(patch.status, patch.body)
    return reply(404, {})
  }) as unknown as typeof fetch
  return calls
}

describe('/dashboard/family/settings', () => {
  it('has no unsaved Timezone or Currency controls', async () => {
    mockFetch({ status: 200, body: {} })
    render(<FamilySettingsPage />)
    expect(await screen.findByLabelText('Family Name')).toBeTruthy()
    expect(screen.queryByLabelText(/time ?zone/i)).toBeNull()
    expect(screen.queryByLabelText(/currency/i)).toBeNull()
  })

  it('saves the family name and says only that', async () => {
    const user = userEvent.setup()
    const calls = mockFetch({ status: 200, body: { family: {} } })
    render(<FamilySettingsPage />)
    const input = await screen.findByLabelText('Family Name')
    await user.clear(input)
    await user.type(input, 'Rivera-Lee')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect((await screen.findByRole('status')).textContent).toBe('Family name saved.')
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ familyId: 'fam_1', name: 'Rivera-Lee' })
  })

  it("shows the server's reason in an alert when the save fails", async () => {
    const user = userEvent.setup()
    mockFetch({ status: 403, body: { error: 'Only parents can update family settings' } })
    render(<FamilySettingsPage />)
    await screen.findByLabelText('Family Name')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Only parents can update family settings')
    )
    expect(screen.queryByRole('status')).toBeNull()
  })
})
