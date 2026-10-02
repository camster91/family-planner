/**
 * @jest-environment jsdom
 */
// Teen Settings (owner decision O-37): a teen opens /dashboard/settings and
// sees only their personal sections. Family-level sections are not rendered,
// their data is not fetched, and the server page does not read or pass any
// household-admin data for a teen. A child never gets the page.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import SettingsClient from '../SettingsClient'

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

// Server-page dependencies.
let mockSession: { id: string; email: string; role?: string; family_id?: string | null } | null = null
let mockDbRole = 'teen'
const mockPinFind = jest.fn(async () => ({ user_id: 'u1' }))
let mockFamilyRow: { beta_metrics_enabled: boolean; capture_ai_key_enc: string | null } = {
  beta_metrics_enabled: true,
  capture_ai_key_enc: null,
}
const mockFamilyFind = jest.fn(async () => mockFamilyRow)
jest.mock('@/lib/supabase/server', () => ({ getServerUser: async () => mockSession }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: async () => ({ role: mockDbRole, family_id: 'fam-1' }) },
    parentElevationPin: { findFirst: (...a: unknown[]) => mockPinFind(...(a as [])) },
    family: { findUnique: (...a: unknown[]) => mockFamilyFind(...(a as [])) },
  },
}))
jest.mock('@/lib/device-http', () => ({ isSharedDeviceEnabled: () => true }))
jest.mock('@/lib/calendar-sync/config', () => ({ isCalendarSyncEnabled: () => true }))

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
  window.matchMedia =
    window.matchMedia ||
    ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia)
})

const PERSONAL = ['Your account', 'Profile', 'Password', 'Language', 'Theme', 'Notifications', 'Privacy & data']
const FAMILY_LEVEL_HEADINGS = ['Family', 'Family tablet', 'AI capture', 'Calendar feed', 'Subscribed calendars', 'Connected calendars']

describe('SettingsClient for a teen', () => {
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
    expect(await screen.findByRole('heading', { name: 'Privacy & data' })).toBeTruthy()
    for (const name of PERSONAL) expect(screen.getByRole('heading', { name })).toBeTruthy()
    for (const name of FAMILY_LEVEL_HEADINGS) expect(screen.queryByRole('heading', { name })).toBeNull()
    // Exactly two groups: Your account, then Privacy & data.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Your account', 'Privacy & data'])

    // Personal controls.
    expect(screen.getByLabelText('Full Name')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeTruthy()
    expect(screen.getByLabelText('Preferred language')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Data Export/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete Account' })).toBeTruthy()

    // No family-level links or controls.
    expect(screen.queryByRole('link', { name: /Features/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Import family apps/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Recent changes/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Members|Household|Invite/ })).toBeNull()
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
    expect(await screen.findByRole('heading', { name: 'AI capture' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
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
    expect(screen.getByText('Share beta usage counts')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Subscribed calendars' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Calendar feed' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Features/ }).getAttribute('href')).toBe('/dashboard/features')
    expect(screen.getByRole('link', { name: /Recent changes/ }).getAttribute('href')).toBe('/dashboard/settings/activity')
    await waitFor(() => expect(urls).toEqual(expect.arrayContaining(['/api/family/feed-token', '/api/family/ai-settings'])))
  })

  it('hides the AI capture form for a parent unless the server turns it on', async () => {
    const urls = mockApi('parent')
    render(<SettingsClient viewerRole="parent" sharedDevice={null} />)
    expect(await screen.findByRole('heading', { name: 'Family' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'AI capture' })).toBeNull()
    expect(screen.queryByLabelText('API key')).toBeNull()
    await waitFor(() => expect(urls).toContain('/api/family/feed-token'))
    expect(urls).not.toContain('/api/family/ai-settings')
  })
})

describe('Settings server page', () => {
  // Imported lazily so the mocks above apply.
  async function renderProps() {
    const { default: SettingsPage } = await import('../page')
    const element = (await SettingsPage()) as React.ReactElement<Record<string, unknown>>
    return element.props
  }

  beforeEach(() => {
    mockPinFind.mockClear()
    mockFamilyFind.mockClear()
    mockFamilyRow = { beta_metrics_enabled: true, capture_ai_key_enc: null }
    delete process.env.CAPTURE_AI_SETTINGS_ENABLED
    // The JWT says parent; the database role must win.
    mockSession = { id: 'u1', email: 'u1@example.test', role: 'parent', family_id: 'fam-1' }
  })

  it('gives a teen the personal view and reads no household-admin data', async () => {
    mockDbRole = 'teen'
    process.env.CAPTURE_AI_SETTINGS_ENABLED = 'true'
    const props = await renderProps()
    expect(props).toEqual({
      viewerRole: 'teen',
      sharedDevice: null,
      betaMetrics: null,
      calendarSync: false,
      aiCaptureSettings: false,
    })
    expect(mockPinFind).not.toHaveBeenCalled()
    expect(mockFamilyFind).not.toHaveBeenCalled()
  })

  it('gives a parent the tablet PIN state, beta switch and calendar sync', async () => {
    mockDbRole = 'parent'
    const props = await renderProps()
    expect(props).toEqual({
      viewerRole: 'parent',
      sharedDevice: { hasPin: true },
      betaMetrics: { enabled: true },
      calendarSync: true,
      aiCaptureSettings: false,
    })
  })

  it('shows the AI capture form only with CAPTURE_AI_SETTINGS_ENABLED', async () => {
    mockDbRole = 'parent'
    process.env.CAPTURE_AI_SETTINGS_ENABLED = 'no'
    expect((await renderProps()).aiCaptureSettings).toBe(false)
    process.env.CAPTURE_AI_SETTINGS_ENABLED = '1'
    expect((await renderProps()).aiCaptureSettings).toBe(true)
    process.env.CAPTURE_AI_SETTINGS_ENABLED = 'TRUE'
    expect((await renderProps()).aiCaptureSettings).toBe(true)
  })

  it('still shows the AI capture form when the household already saved a key, so it can be removed', async () => {
    mockDbRole = 'parent'
    mockFamilyRow = { beta_metrics_enabled: false, capture_ai_key_enc: 'v1:encrypted' }
    const props = await renderProps()
    expect(props.aiCaptureSettings).toBe(true)
    // Only the fact that a key exists reaches the page, never the key.
    expect(JSON.stringify(props)).not.toContain('encrypted')
  })

  it('sends a child home before anything is read', async () => {
    mockDbRole = 'child'
    await expect(renderProps()).rejects.toThrow('REDIRECT /dashboard')
    expect(mockPinFind).not.toHaveBeenCalled()
    expect(mockFamilyFind).not.toHaveBeenCalled()
  })
})
