/**
 * @jest-environment jsdom
 */
// Wishlist, allowance, handoff, sick days and notes are kid-allowed routes. They
// need an ordinary touch entry even though Family -> More remains parent-only.
import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DashboardNav from '../DashboardNav'
import type { NavUser } from '@/types'
import { defaultFeatures, type FamilyFeatures, type FeatureKey } from '@/lib/features'
import { I18nProvider } from '@/i18n'

let mockFeatures: FamilyFeatures = defaultFeatures()

jest.mock('@/components/providers/features-provider', () => ({
  useFeatures: () => ({ features: mockFeatures }),
}))
jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/offline-queue-browser', () => ({ clearAllPersonQueues: async () => undefined }))

const user = (role: NavUser['role']): NavUser => ({ id: 'u1', name: 'Sam Example', role, avatar_url: null }) as NavUser

const kidFeatureRoutes = [
  { key: 'wishlist', label: 'Wishlist', href: '/dashboard/wishlist' },
  { key: 'allowance', label: 'Allowance', href: '/dashboard/allowance' },
  { key: 'handoff', label: 'Handoff', href: '/dashboard/handoff' },
  { key: 'sick-days', label: 'Sick days', href: '/dashboard/sick-days' },
  { key: 'notes', label: 'Notes', href: '/dashboard/notes' },
] as const satisfies ReadonlyArray<{ key: FeatureKey; label: string; href: string }>

async function openMenu(role: NavUser['role']) {
  render(<DashboardNav user={user(role)} />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'User menu' }))
}

describe('DashboardNav user menu: kid feature discovery', () => {
  beforeEach(() => {
    mockFeatures = {
      ...defaultFeatures(),
      wishlist: true,
      allowance: true,
      handoff: true,
      'sick-days': true,
      notes: true,
    }
  })

  it.each(['teen', 'child'] as const)('offers every enabled kid route to a %s', async role => {
    await openMenu(role)
    const group = screen.getByTestId('kid-feature-menu-group')
    for (const { label, href } of kidFeatureRoutes) {
      const link = screen.getByRole('link', { name: label })
      expect(link.getAttribute('href')).toBe(href)
      expect(link.closest('[data-testid="kid-feature-menu-group"]')).toBe(group)
      expect(link.className).toContain('min-h-[44px]')
    }
  })

  it('keeps the group out of the parent menu, where More remains the discovery surface', async () => {
    await openMenu('parent')
    expect(screen.queryByTestId('kid-feature-menu-group')).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Explore' })).toHaveLength(2)
    for (const { label } of kidFeatureRoutes) {
      expect(screen.queryByRole('link', { name: label })).toBeNull()
    }
  })

  it.each(kidFeatureRoutes)('hides the $label route when that feature is off for both kid roles', async ({ key, label }) => {
    mockFeatures = { ...mockFeatures, [key]: false }
    for (const role of ['teen', 'child'] as const) {
      await openMenu(role)
      expect(screen.queryByRole('link', { name: label })).toBeNull()
      cleanup()
    }
  })

  it('does not add Family, Features or More links for kids', async () => {
    await openMenu('child')
    expect(screen.queryByRole('link', { name: 'Family' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Features' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Explore' })).toBeNull()
  })

  it('uses the Spanish labels for the kid feature group', async () => {
    render(
      <I18nProvider locale="es">
        <DashboardNav user={user('child')} />
      </I18nProvider>,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Menú de usuario' }))
    for (const label of ['Lista de deseos', 'Mesada', 'Entrega al cuidador', 'Días de enfermedad', 'Notas']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy()
    }
  })
})
