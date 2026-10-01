// #161: the middleware puts X-Request-Id on every response (API, pages,
// CSRF rejections, redirects) and forwards the same id to route handlers.
// Existing behaviour (auth redirects, security headers, CSRF) is unchanged.

const nextCalls: any[] = []
jest.mock('next/server', () => {
  const base = require('@/__tests__/helpers/two-household').nextServerMock
  class Res extends base.NextResponse {
    static next(init?: unknown) {
      nextCalls.push(init)
      return base.NextResponse.next()
    }
  }
  return { ...base, NextResponse: Res }
})
jest.mock('@/lib/session', () => ({
  resolveSession: jest.fn(async (p: any) => ({ ...p, role: 'parent', family_id: 'family-A' })),
}))
jest.mock('@/lib/prisma', () => ({ prisma: undefined }))

import { middleware } from '@/middleware'
import { signToken } from '@/lib/auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function request(path: string, opts: { method?: string; headers?: Record<string, string>; cookies?: Record<string, string> } = {}): any {
  const url = new URL(`http://localhost${path}`)
  const cookies = opts.cookies ?? {}
  return {
    method: opts.method ?? 'GET',
    url: url.toString(),
    nextUrl: url,
    headers: new Headers(opts.headers ?? {}),
    cookies: { get: (n: string) => (cookies[n] ? { value: cookies[n] } : undefined) },
  }
}

beforeEach(() => {
  nextCalls.length = 0
})

describe('middleware request id', () => {
  it('generates an id for an API response and forwards the same id to the handler', async () => {
    const res: any = await middleware(request('/api/audit', { headers: { accept: 'application/json' } }))
    const id = res.headers.get('X-Request-Id')
    expect(id).toMatch(UUID_RE)
    expect(nextCalls).toHaveLength(1)
    const forwarded: Headers = nextCalls[0].request.headers
    expect(forwarded.get('x-request-id')).toBe(id)
    // Inbound headers survive the forward.
    expect(forwarded.get('accept')).toBe('application/json')
  })

  it('keeps a well-formed inbound id', async () => {
    const res: any = await middleware(request('/api/search?q=ab', { headers: { 'X-Request-Id': 'support-case-0001' } }))
    expect(res.headers.get('X-Request-Id')).toBe('support-case-0001')
    expect(nextCalls[0].request.headers.get('x-request-id')).toBe('support-case-0001')
  })

  it.each(['short', 'has spaces in it', 'x'.repeat(65), 'abcdefgh\r\nSet-Cookie: a=b'])('replaces a malformed inbound id (%j)', async (bad) => {
    let headers: Record<string, string> = {}
    try {
      headers = { 'X-Request-Id': bad }
      new Headers(headers)
    } catch {
      headers = {}
    }
    const res: any = await middleware(request('/api/audit', { headers }))
    const id = res.headers.get('X-Request-Id')
    expect(id).not.toBe(bad)
    expect(id).toMatch(UUID_RE)
  })

  it('sets the id on a CSRF rejection, which stays 403', async () => {
    const res: any = await middleware(request('/api/lists/create', { method: 'POST', headers: { 'X-Request-Id': 'support-case-0002' } }))
    expect(res.status).toBe(403)
    expect(res.headers.get('X-Request-Id')).toBe('support-case-0002')
  })

  it('sets the id on the signed-out /dashboard redirect, which is unchanged', async () => {
    const res: any = await middleware(request('/dashboard/today'))
    expect(new URL(res.headers.get('location')).pathname).toBe('/login')
    expect(res.headers.get('X-Request-Id')).toMatch(UUID_RE)
  })

  it('keeps the security headers and the CSRF cookie on a normal response', async () => {
    const token = signToken({ userId: 'parent-a', email: 'p@x.test', tv: 0 })
    const res: any = await middleware(request('/dashboard/today', { cookies: { session_token: token } }))
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.setCookies.map((c: any) => c.name)).toContain('csrf_token')
    expect(res.headers.get('X-Request-Id')).toMatch(UUID_RE)
  })

  // The dashboard layout's kid gate reads x-pathname via headers(), which only
  // sees REQUEST headers, so it must be on the forwarded request.
  it('forwards the pathname to layouts as a request header', async () => {
    const token = signToken({ userId: 'parent-a', email: 'p@x.test', tv: 0 })
    await middleware(request('/dashboard/wishlist', { cookies: { session_token: token } }))
    expect(nextCalls).toHaveLength(1)
    expect(nextCalls[0].request.headers.get('x-pathname')).toBe('/dashboard/wishlist')
  })

  it('overwrites a client-sent x-pathname', async () => {
    const token = signToken({ userId: 'parent-a', email: 'p@x.test', tv: 0 })
    await middleware(
      request('/dashboard/settings', { cookies: { session_token: token }, headers: { 'x-pathname': '/dashboard' } })
    )
    expect(nextCalls[0].request.headers.get('x-pathname')).toBe('/dashboard/settings')
  })
})
