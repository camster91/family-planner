// Middleware on the sign-up / join journey.
//
// A signed-in member with no household must be able to open /join: the login
// page sends an invited member there after sign-in (`/join?token=…`), the
// "Join an existing family" links on onboarding and Create Family point there,
// and a family code link (`/join?code=…`) is how a child or teen joins. The
// middleware used to treat /join like /login and bounce every signed-in visitor
// to /dashboard, so none of those paths could ever be finished.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/session', () => ({
  resolveSession: jest.fn(async (p: any) => ({ ...p, role: 'parent', family_id: null })),
}))
jest.mock('@/lib/prisma', () => ({ prisma: undefined }))

import { middleware } from '@/middleware'
import { signToken } from '@/lib/auth'
import { resolveSession } from '@/lib/session'

function request(path: string, cookies: Record<string, string> = {}): any {
  const url = new URL(`http://localhost${path}`)
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

describe('middleware: /join is reachable while signed in', () => {
  const session = () => ({ session_token: signToken({ userId: 'user-1', email: 'new@example.test', tv: 0 }) })

  it.each(['/join', '/join?token=abc', '/join?code=ABCD1234'])('signed in: %s is served, not redirected', async (path) => {
    const res = await middleware(request(path, session()))
    expect(location(res)).toBeNull()
  })

  it('signed out: /join is served too', async () => {
    expect(location(await middleware(request('/join?code=ABCD1234')))).toBeNull()
  })

  it.each(['/login', '/register'])('signed in: %s still goes to /dashboard', async (path) => {
    expect(location(await middleware(request(path, session())))).toBe('/dashboard')
  })
})


describe('middleware: returning visitors bypass marketing', () => {
  const session = () => ({ session_token: signToken({ userId: 'user-1', email: 'new@example.test', tv: 0 }) })
  beforeEach(() => jest.clearAllMocks())
  it('validates the current session and sends the homepage to the canonical dashboard', async () => {
    const response = await middleware(request('/?utm_source=bookmark', session()))
    expect(resolveSession).toHaveBeenCalledTimes(1)
    expect(location(response)).toBe('/dashboard')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it.each<Record<string, string>>([{}, { session_token: 'invalid-token' }])('keeps marketing for anonymous or malformed cookies', async cookies => {
    const response = await middleware(request('/', cookies))
    expect(location(response)).toBeNull()
    expect(resolveSession).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('does not admit a cryptographically valid but revoked session', async () => {
    ;(resolveSession as jest.Mock).mockResolvedValueOnce(null)
    expect(location(await middleware(request('/', session())))).toBeNull()
  })
  it('fails closed on lookup failure without a redirect loop', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(resolveSession as jest.Mock).mockRejectedValueOnce(new Error('database unavailable'))
    try { expect(location(await middleware(request('/', session())))).toBeNull() }
    finally { log.mockRestore() }
  })
})
