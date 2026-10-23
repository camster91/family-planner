/** @jest-environment node */
jest.mock('@/components/assistant/AssistantHost', () => ({ __esModule: true, default: () => null }))
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import DashboardLayout from '@/app/dashboard/layout'

jest.mock('next/headers', () => ({ headers: async () => ({ get: () => '/dashboard/today' }) }))
jest.mock('next/navigation', () => ({
  redirect: jest.fn(), usePathname: () => '/dashboard/today',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/supabase/server', () => ({ getServerUser: async () => ({ id: 'p', family_id: 'f', role: 'parent' }) }))
jest.mock('@/lib/prisma', () => ({ prisma: {
  user: { findUnique: async () => ({ id: 'p', name: 'Avery', role: 'parent', avatar_url: null }) },
  family: { findUnique: async () => ({ features: {} }) },
} }))
jest.mock('../DashboardNav', () => ({ __esModule: true, default: () => null, TabBar: () => null }))
jest.mock('../CommandPaletteHost', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/ui/offline-banner', () => ({ OfflineBanner: () => null }))

it('uses a canonical grouped surface and names the actual dashboard for Herewoven', async () => {
  const markup = renderToStaticMarkup(await DashboardLayout({ children: <p>Household plans</p>, forms: null }))
  const dom = new JSDOM(markup)
  try {
    const doc = dom.window.document
    expect(doc.querySelector('template[data-msg]')?.getAttribute('data-msg') ?? null).toBeNull()
    const main = doc.querySelector('main[aria-label="Herewoven dashboard"]')
    expect(main?.textContent).toContain('Household plans')
    expect(doc.body.firstElementChild?.className).toContain('bg-[var(--surface-grouped)]')
    const content = [...doc.querySelectorAll('p')].find(p => p.textContent === 'Household plans')?.parentElement
    expect(content?.className).toContain('w-full')
    expect(content?.className).not.toContain('max-w-7xl')
  } finally { dom.window.close() }
})
