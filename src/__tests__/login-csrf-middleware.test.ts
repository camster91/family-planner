// Login CSRF on the pre-auth endpoints.
//
// /api/auth/login (and the other pre-auth routes) are exempt from the
// double-submit CSRF check because the caller has no csrf_token cookie yet.
// Without another guard a cross-site `<form enctype="text/plain">` could sign
// the victim into the attacker's account: the route parses the body with
// request.json(), which ignores Content-Type. The middleware now refuses
// cross-site requests (Sec-Fetch-Site / Origin) and non-JSON bodies there,
// while non-browser clients (no Sec-Fetch-Site, no Origin) still work.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/session', () => ({ resolveSession: jest.fn(async () => null) }))
jest.mock('@/lib/prisma', () => ({ prisma: undefined }))

import { middleware } from '@/middleware'

function request(path: string, headers: Record<string, string> = {}, method = 'POST'): any {
  const url = new URL(`https://family.example.test${path}`)
  return {
    method,
    url: url.toString(),
    nextUrl: url,
    headers: new Headers({ host: 'family.example.test', ...headers }),
    cookies: { get: () => undefined },
  }
}

const JSON_CT = { 'content-type': 'application/json' }

describe('middleware: pre-auth endpoints refuse login CSRF', () => {
  it('a cross-site text/plain form post to login is refused', async () => {
    const res: any = await middleware(
      request('/api/auth/login', {
        'content-type': 'text/plain',
        'sec-fetch-site': 'cross-site',
        origin: 'https://evil.example',
      })
    )
    expect(res.status).toBe(403)
  })

  it.each(['cross-site', 'same-site'])('Sec-Fetch-Site: %s is refused even with JSON', async (site) => {
    const res: any = await middleware(request('/api/auth/login', { ...JSON_CT, 'sec-fetch-site': site }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Cross-site request refused' })
  })

  it('an old browser with a foreign Origin and no Sec-Fetch-Site is refused', async () => {
    const res: any = await middleware(request('/api/auth/login', { ...JSON_CT, origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
  })

  it('Origin: null is refused', async () => {
    const res: any = await middleware(request('/api/auth/login', { ...JSON_CT, origin: 'null' }))
    expect(res.status).toBe(403)
  })

  it.each([
    ['text/plain', 'text/plain'],
    ['form-urlencoded', 'application/x-www-form-urlencoded'],
    ['multipart', 'multipart/form-data; boundary=x'],
  ])('a same-origin %s body is refused with 415', async (_label, ct) => {
    const res: any = await middleware(
      request('/api/auth/login', { 'content-type': ct, 'sec-fetch-site': 'same-origin' })
    )
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({ error: 'Content-Type must be application/json' })
  })

  it('a missing Content-Type is refused with 415', async () => {
    const res: any = await middleware(request('/api/auth/login'))
    expect(res.status).toBe(415)
  })

  it.each([
    '/api/auth/register',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/verify-email',
    '/api/auth/resend-verification',
  ])('%s gets the same guard', async (path) => {
    expect((await middleware(request(path, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await middleware(request(path, { ...JSON_CT, 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
  })

  describe('legitimate callers pass through', () => {
    it('the web app (same-origin fetch with JSON)', async () => {
      const res: any = await middleware(
        request('/api/auth/login', {
          'content-type': 'application/json; charset=utf-8',
          'sec-fetch-site': 'same-origin',
          origin: 'https://family.example.test',
        })
      )
      expect(res.status).toBe(200)
    })

    it('a non-browser client with JSON and no Origin / Sec-Fetch-Site', async () => {
      expect((await middleware(request('/api/auth/login', JSON_CT))).status).toBe(200)
    })

    it('an old browser whose Origin matches the forwarded host behind a proxy', async () => {
      const res: any = await middleware(
        request('/api/auth/login', {
          ...JSON_CT,
          host: 'app:3000',
          'x-forwarded-host': 'family.example.test',
          origin: 'https://family.example.test',
        })
      )
      expect(res.status).toBe(200)
    })

    it('logout needs no Content-Type (it has no body) but is still same-origin only', async () => {
      expect((await middleware(request('/api/auth/logout', { 'sec-fetch-site': 'same-origin' }))).status).toBe(200)
      expect((await middleware(request('/api/auth/logout', { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    })

    it('GET requests are not affected', async () => {
      const res: any = await middleware(request('/api/auth/me', { 'sec-fetch-site': 'cross-site' }, 'GET'))
      expect(res.status).toBe(200)
    })
  })
})
