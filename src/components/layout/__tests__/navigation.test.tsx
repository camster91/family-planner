/**
 * @jest-environment jsdom
 */
// Shell (#269): one home, five tabs (phone tab bar and top bar), Emergency in
// Family, everything else under Family → More. Kid tabs follow the allowlist.
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import { defaultFeatures, type FamilyFeatures } from '@/lib/features'
import { KID_ALLOWED_PREFIXES, canRoleAccessPath } from '@/lib/kid-access'
import { isTabActive, moreItemsFor, tabsFor, PRIMARY_TABS, navItems, homeHrefFor } from '@/lib/nav-items'
import { TabBar } from '@/components/ui/tab-bar'
import DashboardNav from '../DashboardNav'
import MorePage from '@/app/dashboard/family/more/page'
import FamilyPage from '@/app/dashboard/family/page'
import type { NavUser } from '@/types'

let mockFeatures: FamilyFeatures = defaultFeatures()
let mockPath = '/dashboard/today'
jest.mock('@/components/providers/features-provider', () => ({
  useFeatures: () => ({ features: mockFeatures }),
}))
jest.mock('next/navigation', () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/offline-queue-browser', () => ({ clearAllPersonQueues: async () => undefined }))

const user = (role: NavUser['role']): NavUser => ({ id: 'u1', name: 'Sam Example', role, avatar_url: null }) as NavUser

beforeEach(() => {
  mockFeatures = defaultFeatures()
  mockPath = '/dashboard/today'
})

function tabLabels(container: HTMLElement) {
  return within(container).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])
}

describe('tab model', () => {
  it('parents get exactly Today · Calendar · Meals · Lists · Family', () => {
    expect(tabsFor('parent', defaultFeatures()).map((t) => [t.label, t.href])).toEqual([
      ['Today', '/dashboard/today'],
      ['Calendar', '/dashboard/calendar'],
      ['Meals', '/dashboard/meals'],
      ['Lists', '/dashboard/lists'],
      ['Family', '/dashboard/family'],
    ])
  })

  it('hides Meals when meal planning is off', () => {
    expect(tabsFor('parent', { ...defaultFeatures(), meals: false }).map((t) => t.label)).toEqual([
      'Today',
      'Calendar',
      'Lists',
      'Family',
    ])
  })

  it('child tabs are only allowlisted routes, with Emergency one tap away', () => {
    const tabs = tabsFor('child', defaultFeatures())
    expect(tabs.map((t) => [t.label, t.href])).toEqual([
      ['Today', '/dashboard'],
      ['Lists', '/dashboard/lists'],
      ['Emergency', '/dashboard/emergency'],
    ])
    for (const t of tabs) expect(canRoleAccessPath('child', t.href)).toBe(true)
  })

  it('teen tabs add Calendar and Meals (O-37), with Emergency one tap away', () => {
    const tabs = tabsFor('teen', defaultFeatures())
    expect(tabs.map((t) => [t.label, t.href])).toEqual([
      ['Today', '/dashboard'],
      ['Calendar', '/dashboard/calendar'],
      ['Meals', '/dashboard/meals'],
      ['Lists', '/dashboard/lists'],
      ['Emergency', '/dashboard/emergency'],
    ])
    for (const t of tabs) expect(canRoleAccessPath('teen', t.href)).toBe(true)
    // Feature-gated like a parent's tabs.
    expect(tabsFor('teen', { ...defaultFeatures(), meals: false, calendar: false }).map((t) => t.label)).toEqual([
      'Today',
      'Lists',
      'Emergency',
    ])
  })

  it('the kid allowlist is unchanged by the new shell', () => {
    expect([...KID_ALLOWED_PREFIXES]).toEqual([
      '/dashboard/wishlist',
      '/dashboard/emergency',
      '/dashboard/lists',
      '/dashboard/allowance',
      '/dashboard/handoff',
      '/dashboard/sick-days',
      '/dashboard/today',
      '/dashboard/inventory',
    ])
  })

  it('Today lights up for chores; Family for Emergency, More and the features under it', () => {
    const [today, calendar, , , family] = PRIMARY_TABS
    expect(isTabActive(today, '/dashboard')).toBe(true)
    expect(isTabActive(today, '/dashboard/chores')).toBe(true)
    expect(isTabActive(today, '/dashboard/calendar')).toBe(false)
    expect(isTabActive(calendar, '/dashboard/calendar/2026')).toBe(true)
    for (const p of ['/dashboard/family', '/dashboard/family/more', '/dashboard/emergency', '/dashboard/budget', '/dashboard/features', '/dashboard/inventory']) {
      expect(isTabActive(family, p)).toBe(true)
    }
    expect(isTabActive(family, '/dashboard/lists')).toBe(false)
  })

  it('home is the Today board for parents and the kid home for kids', () => {
    expect(homeHrefFor('parent')).toBe('/dashboard/today')
    expect(homeHrefFor('child')).toBe('/dashboard')
    expect(homeHrefFor('teen')).toBe('/dashboard')
  })
})

describe('More list', () => {
  it('lists Chores plus only the features that are on, never a tab', () => {
    const f = { ...defaultFeatures(), inventory: true, notes: true, budget: false, pickups: true, gamification: false }
    const keys = moreItemsFor('parent', f).map((i) => i.key)
    expect(keys[0]).toBe('chores')
    expect(keys).toEqual(expect.arrayContaining(['emergency', 'inventory', 'notes', 'pickups']))
    // Off (or needing Points & streaks, which is off): absent.
    for (const k of ['budget', 'rewards', 'analytics', 'allowance', 'locations', 'travel', 'handoff', 'sick-days', 'wishlist']) {
      expect(keys).not.toContain(k)
    }
    // Tabs and the Points & streaks setting are never in More.
    for (const k of ['calendar', 'meals', 'lists', 'family', 'gamification']) expect(keys).not.toContain(k)
  })

  it('the More page renders exactly the enabled items and a link to turn features on', () => {
    mockFeatures = { ...defaultFeatures(), inventory: true, allowance: true, budget: false }
    render(<MorePage />)
    const list = screen.getByTestId('more-list')
    const titles = within(list).getAllByRole('listitem').map((li) => li.querySelector('.text-body')?.textContent)
    expect(titles).toEqual(moreItemsFor('parent', mockFeatures).map((i) => i.title))
    expect(titles).toContain('Food inventory')
    expect(titles).toContain('Allowance & IOUs')
    expect(titles).not.toContain('Budget')
    expect(screen.getByRole('link', { name: /Turn features on or off/ }).getAttribute('href')).toBe('/dashboard/features')
  })

  it('the command palette offers More and Emergency', () => {
    expect(navItems.find((i) => i.name === 'More')?.href).toBe('/dashboard/family/more')
    expect(navItems.find((i) => i.name === 'Emergency')?.href).toBe('/dashboard/emergency')
    expect(navItems.find((i) => i.name === 'Today')?.href).toBe('/dashboard/today')
  })
})

describe('TabBar (phone)', () => {
  it('shows exactly five tabs for a parent, Today current on the board', () => {
    const { container } = render(<TabBar user={user('parent')} />)
    expect(tabLabels(container)).toEqual([
      ['Today', '/dashboard/today'],
      ['Calendar', '/dashboard/calendar'],
      ['Meals', '/dashboard/meals'],
      ['Lists', '/dashboard/lists'],
      ['Family', '/dashboard/family'],
    ])
    expect(screen.getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBe('page')
  })

  it('drops Meals when it is off and marks Family current on Emergency', () => {
    mockFeatures = { ...defaultFeatures(), meals: false }
    mockPath = '/dashboard/emergency'
    const { container } = render(<TabBar user={user('parent')} />)
    expect(tabLabels(container).map(([l]) => l)).toEqual(['Today', 'Calendar', 'Lists', 'Family'])
    expect(screen.getByRole('link', { name: 'Family' }).getAttribute('aria-current')).toBe('page')
  })

  it('gives a child Today (kid home), Lists and Emergency', () => {
    mockPath = '/dashboard'
    const { container } = render(<TabBar user={user('child')} />)
    expect(tabLabels(container)).toEqual([
      ['Today', '/dashboard'],
      ['Lists', '/dashboard/lists'],
      ['Emergency', '/dashboard/emergency'],
    ])
  })

  it('gives a teen Today (kid home), Calendar, Meals, Lists and Emergency (O-37)', () => {
    mockPath = '/dashboard/calendar'
    const { container } = render(<TabBar user={user('teen')} />)
    expect(tabLabels(container)).toEqual([
      ['Today', '/dashboard'],
      ['Calendar', '/dashboard/calendar'],
      ['Meals', '/dashboard/meals'],
      ['Lists', '/dashboard/lists'],
      ['Emergency', '/dashboard/emergency'],
    ])
    expect(screen.getByRole('link', { name: 'Calendar' }).getAttribute('aria-current')).toBe('page')
  })
})

describe('DashboardNav (top bar)', () => {
  it('shows the same five tabs and a home link to the board', () => {
    render(<DashboardNav user={user('parent')} />)
    expect(tabLabels(screen.getByTestId('top-tabs')).map(([l]) => l)).toEqual([
      'Today',
      'Calendar',
      'Meals',
      'Lists',
      'Family',
    ])
    expect(screen.getByRole('link', { name: 'Family Planner home' }).getAttribute('href')).toBe('/dashboard/today')
    expect(screen.queryByRole('link', { name: 'Emergency' })).toBeNull()
  })

  it('gives a child its own tabs and a home link to the kid home', () => {
    render(<DashboardNav user={user('child')} />)
    expect(tabLabels(screen.getByTestId('top-tabs')).map(([l]) => l)).toEqual(['Today', 'Lists', 'Emergency'])
    expect(screen.getByRole('link', { name: 'Family Planner home' }).getAttribute('href')).toBe('/dashboard')
  })

  it('gives a teen Calendar and Meals too, and the kid home (O-37)', () => {
    render(<DashboardNav user={user('teen')} />)
    expect(tabLabels(screen.getByTestId('top-tabs')).map(([l]) => l)).toEqual([
      'Today',
      'Calendar',
      'Meals',
      'Lists',
      'Emergency',
    ])
    expect(screen.getByRole('link', { name: 'Family Planner home' }).getAttribute('href')).toBe('/dashboard')
  })
})

describe('Family page', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body =
        url === '/api/auth/me'
          ? { user: { id: 'u1', role: 'parent', family_id: 'f1', family: { name: 'Example' } } }
          : { members: [{ id: 'u1', name: 'Sam Example', role: 'parent', email: 's@example.test' }] }
      return { ok: true, status: 200, json: async () => body } as Response
    }) as unknown as typeof fetch
  })

  it('holds Emergency and More', async () => {
    render(<FamilyPage />)
    expect((await screen.findByRole('link', { name: /Emergency/ })).getAttribute('href')).toBe('/dashboard/emergency')
    expect(screen.getByRole('link', { name: /More/ }).getAttribute('href')).toBe('/dashboard/family/more')
  })

  it('hides Emergency when it is off', async () => {
    mockFeatures = { ...defaultFeatures(), emergency: false }
    render(<FamilyPage />)
    await screen.findByRole('link', { name: /More/ })
    expect(screen.queryByRole('link', { name: /Emergency/ })).toBeNull()
  })
})
