// Route allowlist (#240, SHARED_DEVICE.md §14.1 item 1, ADR-0006 decision 1).
//
// Walks EVERY src/app/api/**/route.ts, calls every exported handler with only
// a valid device cookie of tablet D1 (household H1) plus CSRF, and asserts:
//   * routes outside DEVICE_ALLOWED_ROUTES refuse it (401/404) — except the
//     public, non-cookie routes listed in PUBLIC_ROUTES, which do not
//     authenticate anyone by cookie;
//   * no response carries an H1 canary.
// A new route that starts accepting device cookies, or a new public route,
// fails this test until it is reviewed and listed.
//
// Also covers §14.6 item 42: with the kill switch off every device and
// device-management route is 404, even for a parent session.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import fs from 'fs'
import { FOREIGN } from '@/__tests__/helpers/two-household'
import path from 'path'
import {
  H1_CANARIES,
  db,
  deviceReq,
  disableSharedDevice,
  enableSharedDevice,
  resetClock,
  seedDevices,
  setNow,
  setPassword,
  setPin,
} from '@/__tests__/helpers/device'

const API_ROOT = path.join(__dirname, '..')
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

/** The only handlers that accept a device cookie (SHARED_DEVICE.md §12.2–§12.3). */
const DEVICE_ALLOWED_ROUTES = new Set([
  'GET /api/device/me',
  'GET /api/device/today',
  'POST /api/device/session/refresh',
  'POST /api/device/elevation',
  'DELETE /api/device/elevation',
  'POST /api/device/revoke-self', // requires elevation on top
  'PATCH /api/device/label', // requires elevation on top
  'POST /api/device/pair/claim', // public: needs a pairing code, not a cookie
  'POST /api/device/pair/status', // public: needs a claim token, not a cookie
])

/**
 * Handlers that authenticate nobody by cookie (credentials, bearer token in
 * the URL, cron secret, or no auth at all). A device cookie is irrelevant to
 * them; they are still checked for H1 canaries. Status noted per route.
 */
const PUBLIC_ROUTES: Record<string, number[]> = {
  'POST /api/auth/login': [409], // device cookie present → DEVICE_MODE_LOGIN_BLOCKED
  'POST /api/auth/register': [409], // device cookie present → DEVICE_MODE_LOGIN_BLOCKED (invite branch issues a session)
  'POST /api/auth/forgot-password': [400],
  'POST /api/auth/reset-password': [400],
  'POST /api/auth/resend-verification': [400],
  'GET /api/auth/verify-email': [307], // redirects to the sign-in page with an error
  'POST /api/auth/logout': [200], // clears session_token only; nothing to revoke
  'GET /api/health': [200, 503],
  'GET /api/health/live': [200],
  'POST /api/analytics/event': [200, 204, 400], // anonymous callers are a no-op
  'GET /api/family/invites/preview': [400, 404],
  'GET /api/handoff/share/[token]': [404],
  'GET /api/calendar/feed': [400, 401, 404],
  'POST /api/cron/recurring-chores': [401, 500],
}

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : routeFiles(full)
    return entry.name === 'route.ts' ? [full] : []
  })
}

function urlPath(file: string): string {
  return '/api/' + path.relative(API_ROOT, path.dirname(file)).split(path.sep).join('/')
}

const anyParam = new Proxy({}, { get: (_t, key) => (key === 'then' ? undefined : 'unknown-id') })

async function bodyText(res: any): Promise<string> {
  if (!res) return ''
  try {
    return typeof res.text === 'function' ? String(await res.text()) : JSON.stringify(res.body ?? null)
  } catch {
    return ''
  }
}

const files = routeFiles(API_ROOT).sort()

describe('device cookie route allowlist', () => {
  beforeAll(() => {
    for (const level of ['log', 'warn', 'error', 'info'] as const) jest.spyOn(console, level).mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    enableSharedDevice()
    setNow(new Date())
  })
  afterAll(() => {
    disableSharedDevice()
    resetClock()
  })

  it('finds every API route file', () => {
    expect(files.length).toBeGreaterThanOrEqual(105)
  })

  it('no route outside the allowlist accepts a device cookie, and none leaks H1 data', async () => {
    const seen = new Set<string>()
    const failures: string[] = []

    for (const file of files) {
      const mod = require(file)
      for (const method of METHODS) {
        const handler = mod[method]
        if (typeof handler !== 'function') continue
        const route = `${method} ${urlPath(file)}`
        seen.add(route)

        db.reset()
        const fx = seedDevices()
        const csrf = 'c'.repeat(64)
        const req = deviceReq({
          method,
          path: urlPath(file).replace(/\[(\w+)\]/g, 'unknown-id'),
          cookies: { ...fx.d1.cookies, csrf_token: csrf },
          headers: { 'x-csrf-token': csrf, 'x-cron-secret': 'wrong' },
          body: {},
        })

        let res: any
        try {
          res = await handler(req, { params: Promise.resolve(anyParam) })
        } catch (error) {
          failures.push(`${route}: threw ${(error as Error).message}`)
          continue
        }
        const text = await bodyText(res)
        if (DEVICE_ALLOWED_ROUTES.has(route)) {
          // D1 may read its own household here, never another one.
          if (text.includes(FOREIGN)) failures.push(`${route}: leaked H2 data to D1`)
          continue
        }
        const leaked = H1_CANARIES.filter((c) => text.includes(c))
        if (leaked.length) failures.push(`${route}: leaked ${leaked.join(', ')}`)
        const expected = PUBLIC_ROUTES[route] ?? [401, 404]
        if (!expected.includes(res?.status)) failures.push(`${route}: status ${res?.status}, expected ${expected.join('/')}`)
      }
    }

    expect(failures).toEqual([])
    // Every allowlisted and public route exists, so the lists cannot go stale.
    for (const route of [...DEVICE_ALLOWED_ROUTES, ...Object.keys(PUBLIC_ROUTES)]) expect(seen).toContain(route)
  })

  it('the allowlisted read routes do accept the device cookie', async () => {
    const fx = seedDevices()
    for (const p of ['me', 'today']) {
      const mod = require(path.join(API_ROOT, 'device', p, 'route.ts'))
      const res = await mod.GET(deviceReq({ cookies: fx.d1.cookies }))
      expect(res.status).toBe(200)
    }
  })

  it('kill switch off: every device and device-management route is 404, whoever calls', async () => {
    disableSharedDevice()
    const deviceFiles = files.filter((f) =>
      /\/api\/(device|family\/devices)\//.test(urlPath(f) + '/') || urlPath(f) === '/api/users/elevation-pin'
    )
    expect(deviceFiles.length).toBe(16)
    for (const file of deviceFiles) {
      const mod = require(file)
      for (const method of METHODS) {
        if (typeof mod[method] !== 'function') continue
        for (const as of [null, 'parentA'] as const) {
          db.reset()
          const fx = seedDevices()
          setPassword('parentA', 'parent-a-password')
          setPin('parentA', '482913')
          const res = await mod[method](
            deviceReq({
              method,
              as,
              cookies: fx.d1.cookies,
              body: { label: 'x', code: 'ABCD-EFGH', platform: 'web', userId: 'parent-a', method: 'pin', secret: '482913' },
            }),
            { params: Promise.resolve(anyParam) }
          )
          expect([`${method} ${urlPath(file)}`, res.status]).toEqual([`${method} ${urlPath(file)}`, 404])
          expect(db.writes).toEqual([])
        }
      }
    }
  })
})
