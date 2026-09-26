// Middleware and the shared device (#240, SHARED_DEVICE.md §4 "Cold-launch
// bootstrap", §12 pages, §14.6 items 40 and 42): presence checks only, no new
// CSRF exemption, and nothing changes while the kill switch is off.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/session', () => ({
  resolveSession: jest.fn(async (p: any) => ({ ...p, role: 'parent', family_id: 'family-A' })),
}))
jest.mock('@/lib/prisma', () => ({ prisma: undefined }))

import { middleware } from '@/middleware'
import { signToken } from '@/lib/auth'
import { resolveSession } from '@/lib/session'
import { clearsDeviceCookies } from '@/__tests__/helpers/device'

function request(path: string, cookies: Record<string, string> = {}, method = 'GET', headers: Record<string, string> = {}): any {
  const url = new URL(`http://localhost${path}`)
  return {
    method,
    url: url.toString(),
    nextUrl: url,
    headers: new Headers(headers),
    cookies: { get: (n: string) => (cookies[n] ? { value: cookies[n] } : undefined) },
  }
}

const DEVICE = { fp_device: 'fpd1_a_x' }
const REFRESH_ONLY = { fp_device_refresh: 'fpd1_r_x' }

function location(res: any): string | null {
  const loc = res.headers.get('location')
  return loc ? new URL(loc).pathname : null
}

describe('middleware with shared-device cookies', () => {
  afterEach(() => {
    delete process.env.SHARED_DEVICE_ENABLED
    ;(resolveSession as jest.Mock).mockClear()
  })

  describe('kill switch on', () => {
    beforeEach(() => {
      process.env.SHARED_DEVICE_ENABLED = 'true'
    })

    it.each(['/', '/login', '/register', '/dashboard', '/dashboard/today', '/dashboard/budget'])(
      'a device cookie without session_token sends %s to /device/today (no DB call)',
      async (path) => {
        for (const cookies of [DEVICE, REFRESH_ONLY]) {
          const res = await middleware(request(path, cookies))
          expect(location(res)).toBe('/device/today')
        }
        expect(resolveSession).not.toHaveBeenCalled()
      }
    )

    it('/device pages other than pair/removed need a device cookie', async () => {
      expect(location(await middleware(request('/device/today')))).toBe('/device/pair')
      expect(location(await middleware(request('/device/today', REFRESH_ONLY)))).toBeNull()
      expect(location(await middleware(request('/device/pair')))).toBeNull()
      expect(location(await middleware(request('/device/removed')))).toBeNull()
    })

    it('the device cookie wins over a person session on a paired tablet', async () => {
      const token = signToken({ userId: 'parent-a', email: 'p@x.test', tv: 0 })
      for (const path of ['/dashboard', '/register', '/login', '/']) {
        const res = await middleware(request(path, { session_token: token, ...DEVICE }))
        expect(location(res)).toBe('/device/today')
      }
    })

    it('a person session without device cookies is never redirected to the device board', async () => {
      const token = signToken({ userId: 'parent-a', email: 'p@x.test', tv: 0 })
      const res = await middleware(request('/dashboard', { session_token: token }))
      expect(location(res)).not.toBe('/device/today')
    })

    it('device API mutations still require CSRF (no new exemption)', async () => {
      for (const path of ['/api/device/pair/claim', '/api/device/pair/status', '/api/device/session/refresh', '/api/device/elevation', '/api/family/devices/pairings']) {
        const res: any = await middleware(request(path, DEVICE, 'POST'))
        expect(res.status).toBe(403)
      }
      const ok: any = await middleware(
        request('/api/device/pair/claim', { ...DEVICE, csrf_token: 'a'.repeat(64) }, 'POST', { 'x-csrf-token': 'a'.repeat(64) })
      )
      expect(ok.status).toBe(200)
    })
  })

  describe('kill switch off (default)', () => {
    it('device cookies are ignored: / renders, /dashboard goes to /login as today', async () => {
      expect(location(await middleware(request('/', DEVICE)))).toBeNull()
      expect(location(await middleware(request('/dashboard', DEVICE)))).toBe('/login')
      expect(location(await middleware(request('/device/today')))).toBeNull()
    })

    it('expires device cookies (HttpOnly) so a tablet cannot resume when the switch returns', async () => {
      for (const path of ['/device/today', '/', '/login']) {
        const res: any = await middleware(request(path, { ...DEVICE, ...REFRESH_ONLY }))
        expect(clearsDeviceCookies(res)).toBe(true)
      }
      // No device cookie, nothing to expire.
      const plain: any = await middleware(request('/device/today'))
      expect((plain.setCookies ?? []).map((c: any) => c.name)).not.toContain('fp_device')
      expect(resolveSession).not.toHaveBeenCalled()
    })
  })
})
