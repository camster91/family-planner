/**
 * @jest-environment jsdom
 */
// Teen Settings (owner decision O-37): a teen opens /dashboard/settings and
// sees only their personal sections. Family-level sections are not rendered,
// their data is not fetched, and the server page does not read or pass any
// household-admin data for a teen. A child never gets the page.
import * as React from 'react'
import { render as renderUi, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsClient from '../SettingsClient'
import { I18nProvider } from '@/i18n'

function render(ui: React.ReactElement) {
  return renderUi(<I18nProvider locale="en">{ui}</I18nProvider>)
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  redirect: jest.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`)
  }),
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  ),
}))

function mockApi(role: string) {
  const urls: string[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    const body =
      url === '/api/users'
        ? { user: { name: 'Riley', email: 'riley@example.test', role, age: 15 } }
        : url === '/api/users/preferences'
          ? { preferences: { chores: true, events: true, messages: true } }
          : {}
    const ok = url === '/api/users' || url === '/api/users/preferences'
    return { ok, status: ok ? 200 : 404, json: async () => body } as Response
  }) as unknown as typeof fetch
  return urls
}

beforeAll(() => {
  // jsdom does not implement layout/scrolling; browser acceptance is separate.
  HTMLElement.prototype.scrollIntoView = jest.fn()
  window.matchMedia =
    window.matchMedia ||
    ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia)
})

const PERSONAL = ['Your account', 'Profile', 'Password', 'Language', 'Theme', 'Notifications', 'Privacy & data']
const FAMILY_LEVEL_HEADINGS = ['Family', 'Family tablet', 'AI capture', 'Calendar feed', 'Subscribed calendars', 'Connected calendars']

describe('SettingsClient for a teen', () => {
  beforeEach(() => window.history.replaceState({}, '', '/dashboard/settings'))
  it('renders only personal sections', async () => {
    const urls = mockApi('teen')
    // Even if a caller passed household data by mistake, a teen view never renders it.
    render(
      <SettingsClient
        viewerRole="teen"
        sharedDevice={{ hasPin: true }}
        betaMetrics={{ enabled: true }}
        calendarSync
        aiCaptureSettings
      />
    )
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeTruthy()
    for (const name of PERSONAL) expect(screen.getByRole('heading', { name, hidden: true })).toBeTruthy()
    for (const name of FAMILY_LEVEL_HEADINGS) expect(screen.queryByRole('heading', { name, hidden: true })).toBeNull()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Your account'])
    expect(screen.queryByRole('button', { name: 'Family' })).toBeNull()
    // Exactly two groups: Your account, then Privacy & data.
    expect(screen.getAllByRole('heading', { level: 2, hidden: true }).map((h) => h.textContent)).toEqual(['Your account', 'Privacy & data'])

    // Personal controls.
    expect(screen.getByLabelText('Full Name')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeTruthy()
    expect(screen.getByLabelText('Preferred language')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Privacy & data' }))
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Privacy & data'])
    expect(screen.getByRole('button', { name: /Data Export/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete Account' })).toBeTruthy()

    // No family-level links or controls.
    expect(screen.queryByRole('link', { name: /Features/, hidden: true })).toBeNull()
    expect(screen.queryByRole('link', { name: /Import family apps/, hidden: true })).toBeNull()
    expect(screen.queryByRole('link', { name: /Recent changes/, hidden: true })).toBeNull()
    expect(screen.queryByRole('link', { name: /Members|Household|Invite/, hidden: true })).toBeNull()
    expect(screen.queryByText(/Tablet PIN/i)).toBeNull()
    expect(screen.queryByText(/Shared tablets|Devices/)).toBeNull()
    expect(screen.queryByText(/beta usage counts/i)).toBeNull()
    expect(screen.queryByLabelText('API key')).toBeNull()
    expect(screen.queryByText(/family settings/)).toBeNull()

    // The household-admin APIs are never called for a teen.
    await waitFor(() => expect(urls).toContain('/api/users/preferences'))
    expect(urls.some((u) => u.startsWith('/api/family/'))).toBe(false)
    expect(urls.some((u) => u.startsWith('/api/calendar/'))).toBe(false)
  })

  it('a parent gets the three groups in order, with the family-level sections', async () => {
    const urls = mockApi('parent')
    render(
      <SettingsClient viewerRole="parent" sharedDevice={{ hasPin: true }} betaMetrics={{ enabled: true }} aiCaptureSettings />
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Family' }))
    expect(await screen.findByRole('heading', { name: 'AI capture' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 2, hidden: true }).map((h) => h.textContent)).toEqual([
      'Your account',
      'Family',
      'Privacy & data',
    ])
    expect(screen.getByRole('heading', { name: 'Family tablet' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Members/ }).getAttribute('href')).toBe('/dashboard/family')
    expect(screen.getByRole('link', { name: /Household/ }).getAttribute('href')).toBe('/dashboard/family/settings')
    expect(screen.getByRole('link', { name: /Invite and family code/ }).getAttribute('href')).toBe('/dashboard/family/invite')
    // Long, rarely used parts start closed.
    for (const name of ['Calendar feed', 'Subscribed calendars', 'AI capture']) {
      expect(screen.getByRole('heading', { name }).closest('details')?.open).toBe(false)
    }
    expect(screen.getByText('Tablet PIN')).toBeTruthy()
    // Privacy-only controls stay deferred until that group is opened.
    expect(screen.queryByText('Share beta usage counts')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Subscribed calendars' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Calendar feed' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Features/, hidden: true }).getAttribute('href')).toBe('/dashboard/features')
    expect(screen.getByRole('link', { name: /Recent changes/, hidden: true }).getAttribute('href')).toBe('/dashboard/settings/activity')
    await waitFor(() => expect(urls).toEqual(expect.arrayContaining(['/api/family/feed-token', '/api/family/ai-settings'])))
    await userEvent.click(screen.getByRole('button', { name: 'Privacy & data' }))
    expect(screen.getByRole('switch', { name: 'Share beta usage counts' })).toBeVisible()
  })

  it('hides the AI capture form for a parent unless the server turns it on', async () => {
    const urls = mockApi('parent')
    render(<SettingsClient viewerRole="parent" sharedDevice={null} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Family' }))
    expect(await screen.findByRole('heading', { name: 'Family' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'AI capture' })).toBeNull()
    expect(screen.queryByLabelText('API key')).toBeNull()
    await waitFor(() => expect(urls).toContain('/api/family/feed-token'))
    expect(urls).not.toContain('/api/family/ai-settings')
  })
})
