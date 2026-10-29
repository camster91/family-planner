// Public pages and shared-device presence routing must remain available when
// the database module cannot load; protected sessions must still fail closed.
jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/session', () => { throw new Error('Session module unavailable') })

import { middleware } from '@/middleware'
import { signToken } from '@/lib/auth'

function request(path: string, cookies: Record<string, string> = {}): any {
  const url = new URL(`http://localhost${path}`)
  return {
    method: 'GET', url: url.toString(), nextUrl: url,
    headers: new Headers(),
    cookies: { get: (name: string) => cookies[name] ? { value: cookies[name] } : undefined },
  }
}

describe('middleware database loading boundary', () => {
  it('serves anonymous login with CSRF protection when the session module cannot load', async () => {
    const response = await middleware(request('/login'))
    expect(response.headers.get('location')).toBeNull()
    expect((response as any).setCookies.find((cookie: { name: string }) => cookie.name === 'csrf_token')?.value).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a valid signed cookie when session authority cannot load', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const token = signToken({ userId: 'fabricated-user', email: 'test@example.test', tv: 0 })
      const response = await middleware(request('/dashboard/today', { session_token: token }))
      const target = new URL(response.headers.get('location')!)
      expect(target.pathname).toBe('/login')
      expect(target.searchParams.get('redirect')).toBe('/dashboard/today')
    } finally { log.mockRestore() }
  })

  it('keeps unauthenticated mutations behind CSRF validation', async () => {
    const response = await middleware({ ...request('/api/lists'), method: 'POST' })
    expect(response.status).toBe(403)
  })
})
