/** @jest-environment jsdom */
jest.mock('@/components/assistant/AssistantHost', () => ({ __esModule: true, default: () => null }))
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import DashboardLayout from '@/app/dashboard/layout'

jest.mock('next/headers', () => ({ headers: async () => ({ get: () => '/dashboard/today' }) }))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ getServerUser: async () => ({ id: 'p', family_id: 'f', role: 'parent' }) }))
jest.mock('@/lib/prisma', () => ({ prisma: {
  user: { findUnique: async () => ({ id: 'p', name: 'Avery', role: 'parent', avatar_url: null }) },
  family: { findUnique: async () => ({ features: {} }) },
} }))
jest.mock('../DashboardNav', () => ({ __esModule: true, default: () => null, TabBar: () => null }))
jest.mock('../CommandPaletteHost', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/ui/offline-banner', () => ({ OfflineBanner: () => null }))

it('uses a canonical grouped surface and names the actual dashboard for Herewoven', async () => {
  const { container } = render(await DashboardLayout({ children: <p>Household plans</p> }))
  expect(screen.getByRole('main', { name: 'Herewoven dashboard' }).textContent).toContain('Household plans')
  expect(container.firstElementChild?.className).toContain('bg-[var(--surface-grouped)]')
  const content = screen.getByText('Household plans').parentElement
  expect(content?.className).toContain('w-full')
  expect(content?.className).not.toContain('max-w-7xl')
})
