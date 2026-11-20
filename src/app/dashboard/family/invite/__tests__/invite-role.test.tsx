/** @jest-environment jsdom */
// The inviter must choose the role (Parent, Teen or Child) explicitly; an
// email invite never goes out as Child by default (owner-approved review B8).
import '@testing-library/jest-dom'
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('@/components/layout/pending-form-navigation', () => ({
  usePendingFormNavigationController: () => ({ releaseBeforeNavigation: async () => true }),
}))
jest.mock('@/components/family/ProfileSetupPanel', () => ({ ProfileSetupPanel: () => null }))

import InvitePage from '../page'

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response
let sent: Array<{ email: string; role: string }>

beforeEach(() => {
  sent = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/me') return reply({ user: { id: 'p', role: 'parent' } })
    if (url === '/api/family') return reply({ family: { invite_code: 'K7QM4XPD2HNA' } })
    if (url === '/api/family/invites' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      sent.push(body)
      return reply({ success: true, invite: { ...body, expires_at: '2030-01-01T00:00:00.000Z' } })
    }
    if (url === '/api/family/invites') return reply({ invites: [] })
    return reply({})
  }) as unknown as typeof fetch
})

it('keeps Send off until a role is picked, offers Parent, Teen and Child in that order, and sends the chosen one', async () => {
  const user = userEvent.setup()
  render(<I18nProvider locale="en"><InvitePage /></I18nProvider>)
  await user.click(await screen.findByRole('button', { name: 'Invite by email' }))
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Email'), 'teen@example.test')

  const group = within(dialog).getByRole('group', { name: 'Role' })
  const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
  expect(radios.map((radio) => radio.value)).toEqual(['parent', 'teen', 'child'])
  expect(radios.some((radio) => radio.checked)).toBe(false)
  expect(within(dialog).getByRole('button', { name: 'Send invite' })).toBeDisabled()

  await user.click(within(group).getByRole('radio', { name: 'Teen' }))
  expect(within(dialog).getByRole('button', { name: 'Send invite' })).toBeEnabled()
  await user.click(within(dialog).getByRole('button', { name: 'Send invite' }))

  expect(await screen.findByText('Invite sent to teen@example.test')).toBeInTheDocument()
  expect(sent).toEqual([{ email: 'teen@example.test', role: 'teen' }])

  // The next invite is for someone else: the role is not carried over either.
  await user.click(screen.getByRole('button', { name: 'Invite by email' }))
  const next = within(screen.getByRole('dialog')).getAllByRole('radio') as HTMLInputElement[]
  expect(next.some((radio) => radio.checked)).toBe(false)
})
