/**
 * @jest-environment jsdom
 */
// UI review: the bell showed no badge with 2 unread notifications (it only
// counted while event reminders were on) and the review inbox icon had no
// count. Both now show a count badge and say the count in their names.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DashboardNav from '../DashboardNav'
import { REPORT_OPEN_EVENT } from '@/lib/report-launcher'
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

const person = (role: NavUser['role']): NavUser => ({ id: 'u1', name: 'Sam Example', role, avatar_url: null }) as NavUser

function mockCounts({ notifications = 0, checks = 0 }: { notifications?: number; checks?: number }) {
  const urls: string[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    if (url.startsWith('/api/notifications'))
      return { ok: true, json: async () => ({ notifications: Array.from({ length: notifications }, (_, i) => ({ id: `n${i}` })) }) } as Response
    if (url.startsWith('/api/chores'))
      return { ok: true, json: async () => ({ chores: Array.from({ length: checks }, (_, i) => ({ id: `c${i}` })) }) } as Response
    return { ok: false, json: async () => ({}) } as Response
  }) as unknown as typeof fetch
  return urls
}

describe('top bar count badges', () => {
  it('the bell counts any unread notification even while event reminders are off', async () => {
    mockCounts({ notifications: 2 })
    render(<DashboardNav user={person('parent')} remindersSupported={false} />)
    const bell = await screen.findByRole('link', { name: 'Notifications, 2 unread' })
    expect(within(bell).getByTestId('bell-unread-dot').textContent).toBe('2')
    expect(bell.getAttribute('href')).toBe('/dashboard/notifications')
  })

  it('the review inbox icon shows how many chores wait for a check, in its name too', async () => {
    const urls = mockCounts({ checks: 3 })
    render(<DashboardNav user={person('parent')} />)
    const inbox = await screen.findByRole('link', { name: 'Review inbox, 3 to check' })
    expect(within(inbox).getByTestId('review-inbox-count').textContent).toBe('3')
    expect(inbox.className).toContain('h-11')
    expect(urls).toContain('/api/chores?status=completed&limit=10&order=asc')
  })

  it('shows 9+ for many, and no badge when nothing waits', async () => {
    mockCounts({ checks: 12 })
    const view = render(<DashboardNav user={person('parent')} />)
    expect(await screen.findByRole('link', { name: 'Review inbox, 9+ to check' })).toBeTruthy()
    view.unmount()
    mockCounts({ checks: 0, notifications: 0 })
    render(<DashboardNav user={person('parent')} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.getByRole('link', { name: 'Review inbox' })).toBeTruthy()
    expect(screen.queryByTestId('review-inbox-count')).toBeNull()
    expect(screen.queryByTestId('bell-unread-dot')).toBeNull()
  })

  it('a teen gets no review inbox and no review count read', async () => {
    const urls = mockCounts({ checks: 3, notifications: 1 })
    render(<DashboardNav user={person('teen')} />)
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Review inbox/ })).toBeNull()
    expect(urls.some((url) => url.startsWith('/api/chores'))).toBe(false)
  })
})

describe('user menu: Report / Suggest', () => {
  it('opens the private report form and returns focus to the menu button', async () => {
    mockCounts({})
    const opened = jest.fn()
    window.addEventListener(REPORT_OPEN_EVENT, opened)
    try {
      render(<DashboardNav user={person('child')} />)
      const menuButton = screen.getByRole('button', { name: /User menu$/ })
      await userEvent.click(menuButton)
      const item = screen.getByRole('button', { name: 'Report / Suggest' })
      expect(item.className).toContain('min-h-[44px]')
      await userEvent.click(item)
      expect(opened).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(menuButton)
      expect(screen.queryByRole('button', { name: 'Report / Suggest' })).toBeNull()
    } finally {
      window.removeEventListener(REPORT_OPEN_EVENT, opened)
    }
  })
})
