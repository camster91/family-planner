/**
 * @jest-environment jsdom
 */
// The user menu used to show a "Switch View: Parent / Teen / Child" control to
// every role, children included, whose handler did nothing. A role is set by a
// parent in Family, never from this menu, so the control is gone for everyone.
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

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response) as unknown as typeof fetch
})

const user = (role: NavUser['role']): NavUser => ({ id: 'u1', name: 'Sam Example', role, avatar_url: null }) as NavUser

describe('DashboardNav user menu: no role switcher', () => {
  it.each(['parent', 'teen', 'child'] as const)('a %s sees no "Switch View" control', async (role) => {
    render(<DashboardNav user={user(role)} />)
    await userEvent.click(screen.getByRole('button', { name: 'User menu' }))
    expect(screen.queryByText('Switch View')).toBeNull()
    for (const name of ['Parent', 'Teen', 'Child']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // The role badge still says who is signed in.
    expect(screen.getByText(role === 'parent' ? 'Parent' : role === 'teen' ? 'Teen' : 'Child')).toBeTruthy()
  })
})
