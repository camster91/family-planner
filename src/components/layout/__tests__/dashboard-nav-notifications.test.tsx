/**
 * @jest-environment jsdom
 */
// Notification switches for children (#286): they cannot open Settings
// (src/lib/kid-access.ts), so the user menu, which is on every page they can
// reach, opens the same switches in a dialog. Parents and teens (O-37) use
// Settings, and get the notifications bell.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DashboardNav from '../DashboardNav'
import type { NavUser } from '@/types'

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

function mockPrefs() {
  const calls: string[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return { ok: true, status: 200, json: async () => ({ preferences: { chores: true, events: false, messages: true } }) } as Response
  }) as unknown as typeof fetch
  return calls
}

async function openMenu(role: NavUser['role']) {
  render(<DashboardNav user={user(role)} />)
  await userEvent.click(screen.getByRole('button', { name: 'User menu' }))
}

describe('DashboardNav user menu: notifications', () => {
  it('a child opens their own notification switches from the menu', async () => {
    const calls = mockPrefs()
    await openMenu('child')
    const item = screen.getByRole('button', { name: 'Notifications' })
    expect(item.className).toContain('min-h-[44px]')
    await userEvent.click(item)
    expect(await screen.findByRole('dialog', { name: 'Notifications' })).toBeTruthy()
    const events = await screen.findByRole('switch', { name: 'Calendar events' })
    expect(events.getAttribute('aria-checked')).toBe('false')
    expect(calls).toEqual(['/api/users/preferences'])

    // Escape closes it and focus goes back to the menu button.
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'User menu' }))
  })

  it.each(['parent', 'teen'] as const)('a %s does not get the menu entry (they use Settings)', async (role) => {
    mockPrefs()
    await openMenu(role)
    expect(screen.queryByRole('button', { name: 'Notifications' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy()
    // The bell opens their own notifications list.
    expect(screen.getByRole('link', { name: 'Notifications' }).getAttribute('href')).toBe('/dashboard/notifications')
  })

  it('a child gets no Settings link and no notifications bell', async () => {
    mockPrefs()
    await openMenu('child')
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Notifications' })).toBeNull()
  })
})
