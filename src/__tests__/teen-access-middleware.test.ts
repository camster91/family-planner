// Middleware role gate (src/lib/kid-access.ts, owner decision O-37).
//
// Teens may open the calendar (month view and "Add event"), meals and recipes,
// Help, their notifications and the Settings page itself. Every Settings
// sub-route, Features, Family and event editing stay parent-only. Children are
// unchanged. The role comes from the database lookup (resolveSession), not the
// JWT claim.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
let mockRole = 'teen'
jest.mock('@/lib/session', () => ({
  resolveSession: jest.fn(async (p: any) => ({ ...p, role: mockRole, family_id: 'fam-1' })),
}))
jest.mock('@/lib/prisma', () => ({ prisma: undefined }))

import { middleware } from '@/middleware'
import { signToken } from '@/lib/auth'

function request(path: string): any {
  const url = new URL(`http://localhost${path}`)
  const cookies: Record<string, string> = {
    // The JWT claims parent; the database role (mockRole) must win.
    session_token: signToken({ userId: 'user-1', email: 'm@example.test', role: 'parent', tv: 0 } as any),
  }
  return {
    method: 'GET',
    url: url.toString(),
    nextUrl: url,
    headers: new Headers(),
    cookies: { get: (n: string) => (cookies[n] ? { value: cookies[n] } : undefined) },
  }
}

function location(res: any): string | null {
  const loc = res.headers.get('location')
  return loc ? new URL(loc).pathname : null
}

const TEEN_ONLY = [
  '/dashboard/calendar',
  '/dashboard/calendar?year=2026&month=10',
  '/dashboard/calendar/create',
  '/dashboard/meals',
  '/dashboard/meals/recipes/r1',
  '/dashboard/help',
  '/dashboard/notifications',
  '/dashboard/settings',
]

const PARENT_ONLY = [
  '/dashboard/settings/devices',
  '/dashboard/settings/activity',
  '/dashboard/settings/imports',
  '/dashboard/features',
  '/dashboard/family',
  '/dashboard/family/settings',
  '/dashboard/calendar/edit?id=e1',
  '/dashboard/chores',
  '/dashboard/search',
]

describe('middleware role gate', () => {
  it.each(TEEN_ONLY)('a teen is served %s', async (path) => {
    mockRole = 'teen'
    expect(location(await middleware(request(path)))).toBeNull()
  })

  it.each(TEEN_ONLY)('a child is sent home from %s', async (path) => {
    mockRole = 'child'
    expect(location(await middleware(request(path)))).toBe('/dashboard')
  })

  it.each(PARENT_ONLY)('a teen and a child are sent home from %s; a parent is served', async (path) => {
    for (const role of ['teen', 'child']) {
      mockRole = role
      expect(location(await middleware(request(path)))).toBe('/dashboard')
    }
    mockRole = 'parent'
    expect(location(await middleware(request(path)))).toBeNull()
  })

  it.each(['/dashboard', '/dashboard/lists', '/dashboard/emergency'])('both kid roles keep %s', async (path) => {
    for (const role of ['teen', 'child']) {
      mockRole = role
      expect(location(await middleware(request(path)))).toBeNull()
    }
  })
})
