/**
 * @jest-environment jsdom
 */
// Help page (#146): renders every section, links only to real pages, and shows
// the support address from src/lib/support.ts, or plain "coming soon" text
// while it is not set. Parents and teens (O-37) reach it from the user menu;
// children do not. A teen sees parent-only pages named, never linked.
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HelpPage from '../page'
import HelpContent from '../HelpContent'
import DashboardNav from '@/components/layout/DashboardNav'
import { SUPPORT_EMAIL, SUPPORT_EMAIL_PENDING_TEXT, supportEmail } from '@/lib/support'
import type { NavUser } from '@/types'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  ),
}))
jest.mock('@/components/providers/features-provider', () => {
  const { defaultFeatures } = jest.requireActual('@/lib/features')
  return { useFeatures: () => ({ features: defaultFeatures() }) }
})
jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/offline-queue-browser', () => ({ clearAllPersonQueues: async () => undefined }))
// The server page reads the viewer's role from the database.
let mockRole: string = 'parent'
jest.mock('@/lib/supabase/server', () => ({
  getServerUser: async () => ({ id: 'u1', email: 'u1@example.test', role: 'parent', family_id: 'f1' }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: async () => ({ role: mockRole }) } },
}))

beforeEach(() => {
  mockRole = 'parent'
})

describe('Help page', () => {
  it('renders a heading and every help section', async () => {
    render(await HelpPage())
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeTruthy()
    for (const name of [
      'Getting started',
      'Chores and rewards',
      'Calendar, meals and lists',
      'Trouble signing in',
      'Your data',
      'Contact support',
    ]) {
      expect(screen.getByRole('region', { name })).toBeTruthy()
    }
  })

  it('links to the real pages for each task', async () => {
    render(await HelpPage())
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/dashboard/family/create',
        '/dashboard/family/invite',
        '/join',
        '/dashboard/chores',
        '/dashboard/rewards',
        '/dashboard/calendar',
        '/dashboard/meals',
        '/dashboard/lists',
        '/forgot-password',
        '/dashboard/settings',
        '/privacy',
      ])
    )
  })

  it('shows "coming soon" text, not an address, while the support email is unset', async () => {
    expect(SUPPORT_EMAIL).toBe('')
    render(await HelpPage())
    const contact = screen.getByRole('region', { name: 'Contact support' })
    expect(within(contact).getByTestId('support-email').textContent).toBe(SUPPORT_EMAIL_PENDING_TEXT)
    expect(within(contact).queryByRole('link')).toBeNull()
    expect(contact.textContent).not.toMatch(/@/)
  })

  it('gives a teen the same answers, but links only pages a teen may open', async () => {
    mockRole = 'teen'
    render(await HelpPage())
    expect(screen.getByRole('region', { name: 'Getting started' })).toBeTruthy()
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(
      expect.arrayContaining(['/join', '/dashboard/calendar', '/dashboard/meals', '/dashboard/lists', '/forgot-password', '/dashboard/settings', '/privacy'])
    )
    for (const parentOnly of ['/dashboard/family/create', '/dashboard/family/invite', '/dashboard/chores', '/dashboard/rewards']) {
      expect(hrefs).not.toContain(parentOnly)
    }
    // Still named, as text.
    expect(screen.getByText('Family → Invite')).toBeTruthy()
  })

  it('shows a mailto link once a support email is set', () => {
    render(<HelpContent supportEmail="  help@example.test " />)
    const link = screen.getByRole('link', { name: 'help@example.test' })
    expect(link.getAttribute('href')).toBe('mailto:help@example.test')
    expect(screen.queryByText(SUPPORT_EMAIL_PENDING_TEXT)).toBeNull()
  })

  it('keeps in-text links inline, with no padding that would overlap nearby lines', async () => {
    render(await HelpPage())
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).not.toMatch(/\bpy-|\bp-|block\b/)
    }
  })

  it('says "points" in plain words, never "XP"', async () => {
    render(await HelpPage())
    const chores = screen.getByRole('region', { name: 'Chores and rewards' })
    expect(chores.textContent).toContain('points')
    expect(document.body.textContent).not.toMatch(/\bXP\b/)
  })

  it('treats a blank support email as unset', () => {
    expect(supportEmail('')).toBeNull()
    expect(supportEmail('   ')).toBeNull()
    expect(supportEmail('a@example.test')).toBe('a@example.test')
  })
})

describe('DashboardNav user menu: Help', () => {
  const user = (role: NavUser['role']): NavUser =>
    ({ id: 'u1', name: 'Sam Example', role, avatar_url: null }) as NavUser

  it('links a parent to /dashboard/help', async () => {
    render(<DashboardNav user={user('parent')} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'User menu' }))
    const link = screen.getByRole('link', { name: 'Help' })
    expect(link.getAttribute('href')).toBe('/dashboard/help')
    expect(link.className).toContain('min-h-[44px]')
  })

  it('links a teen to /dashboard/help too (O-37)', async () => {
    render(<DashboardNav user={user('teen')} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'User menu' }))
    expect(screen.getByRole('link', { name: 'Help' }).getAttribute('href')).toBe('/dashboard/help')
  })

  it('does not show Help to a child (not on the kid allowlist)', async () => {
    render(<DashboardNav user={user('child')} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'User menu' }))
    expect(screen.queryByRole('link', { name: 'Help' })).toBeNull()
  })
})

it('does not expose personal sync diagnostics to a child', () => {
  render(<HelpContent role="child" userId="child-viewer" />)
  expect(screen.queryByRole('button', { name: 'View sync details' })).toBeNull()
  expect(screen.queryByRole('region', { name: 'appDiagnostics.title' })).toBeNull()
})
