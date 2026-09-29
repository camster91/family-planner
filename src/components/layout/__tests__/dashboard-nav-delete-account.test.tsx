/**
 * @jest-environment jsdom
 */
// Account deletion for teens and children (D-3, ACCOUNT_DELETION.md): they
// cannot open Settings (src/lib/kid-access.ts), so the user menu, which is on
// every page they can reach, offers "Delete my account". Own account only:
// the dialog never offers household deletion here. Parents use Settings.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DashboardNav from '../DashboardNav'
import type { NavUser } from '@/types'
import type { DeletionOptions } from '@/lib/account-deletion-shared'

jest.mock('@/components/providers/features-provider', () => {
  const { defaultFeatures } = jest.requireActual('@/lib/features')
  return { useFeatures: () => ({ features: defaultFeatures() }) }
})
jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/offline-queue-browser', () => ({ clearAllPersonQueues: async () => undefined }))

const user = (role: NavUser['role']): NavUser => ({ id: 'u1', name: 'Sam Example', role, avatar_url: null }) as NavUser

function mockOptions(options: DeletionOptions) {
  const calls: Array<{ url: string; method: string }> = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase() })
    return { ok: true, status: 200, json: async () => options } as Response
  }) as unknown as typeof fetch
  return calls
}

const KID_OPTIONS: DeletionOptions = {
  role: 'teen',
  household: { id: 'f', name: 'The Rivers', memberCount: 3, parentCount: 1 },
  isOnlyParent: false,
  canDeleteAccount: true,
  canDeleteHousehold: false,
}

async function openMenu(role: NavUser['role']) {
  render(<DashboardNav user={user(role)} />)
  await userEvent.click(screen.getByRole('button', { name: 'User menu' }))
}

describe('DashboardNav user menu: delete my account', () => {
  it.each(['teen', 'child'] as const)('a %s opens the account-only delete dialog from the menu', async (role) => {
    const calls = mockOptions({ ...KID_OPTIONS, role })
    await openMenu(role)
    const item = screen.getByRole('button', { name: 'Delete my account' })
    expect(item.className).toContain('min-h-[44px]')
    await userEvent.click(item)
    expect(await screen.findByRole('dialog', { name: 'Delete account' })).toBeTruthy()
    expect(await screen.findByLabelText('Your password')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeTruthy()
    expect(calls.map((c) => c.url)).toContain('/api/users/deletion')
  })

  it('never offers household deletion from the menu, even if the server would allow it', async () => {
    mockOptions({ ...KID_OPTIONS, isOnlyParent: true, canDeleteAccount: false, canDeleteHousehold: true })
    await openMenu('teen')
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    await waitFor(() => expect(screen.getByText(/Delete the household from Settings instead/)).toBeTruthy())
    expect(screen.queryByRole('dialog', { name: 'Delete household' })).toBeNull()
    expect(screen.queryByLabelText('Your password')).toBeNull()
  })

  it('parents do not get the menu entry (they use Settings)', async () => {
    mockOptions(KID_OPTIONS)
    await openMenu('parent')
    expect(screen.queryByRole('button', { name: 'Delete my account' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy()
  })
})
