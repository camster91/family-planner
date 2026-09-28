/**
 * @jest-environment jsdom
 */
// Food inventory (#263) is reachable by touch from the user menu for every
// role when the feature is on, and hidden when it is off.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DashboardNav from '../DashboardNav'
import type { NavUser } from '@/types'

let mockInventoryOn = true
jest.mock('@/components/providers/features-provider', () => ({
  useFeatureEnabled: (key: string) => (key === 'inventory' ? mockInventoryOn : true),
}))
jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/offline-queue-browser', () => ({ clearAllPersonQueues: async () => undefined }))

const user = (role: NavUser['role']): NavUser => ({ id: 'u1', name: 'Sam Example', role, avatar_url: null }) as NavUser

async function openMenu(role: NavUser['role']) {
  render(<DashboardNav user={user(role)} />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'User menu' }))
}

describe('DashboardNav user menu: food inventory', () => {
  beforeEach(() => {
    mockInventoryOn = true
  })

  it.each(['parent', 'teen', 'child'] as const)('links a %s to /dashboard/inventory when the feature is on', async (role) => {
    await openMenu(role)
    const link = screen.getByRole('link', { name: 'Food inventory' })
    expect(link.getAttribute('href')).toBe('/dashboard/inventory')
    expect(link.className).toContain('min-h-[44px]')
  })

  it('hides the link when the feature is off', async () => {
    mockInventoryOn = false
    await openMenu('parent')
    expect(screen.queryByRole('link', { name: 'Food inventory' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Today board' })).toBeTruthy()
  })
})
