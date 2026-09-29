// GET /api/version (#161): exact server build, nothing secret-looking.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)

import { GET } from '../route'

const SAVED = { RELEASE_SHA: process.env.RELEASE_SHA, JWT_SECRET: process.env.JWT_SECRET, DATABASE_URL: process.env.DATABASE_URL }

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

function get(headers: Record<string, string> = {}): any {
  return GET({ method: 'GET', url: 'http://localhost/api/version', headers: new Headers(headers) } as any)
}

describe('GET /api/version', () => {
  it('returns exactly { version, commit, builtAt }, no-store, with the request id header', async () => {
    process.env.RELEASE_SHA = '0123456789abcdef0123456789abcdef01234567'
    process.env.JWT_SECRET = 'super-secret-value-'.repeat(3)
    process.env.DATABASE_URL = 'postgresql://user:hunter2@db.internal:5432/family_planner'
    const res = await get({ 'x-request-id': 'support-case-0001' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0')
    expect(res.headers.get('X-Request-Id')).toBe('support-case-0001')
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['builtAt', 'commit', 'version'])
    expect(body.commit).toBe('0123456789abcdef0123456789abcdef01234567')
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/)
    const text = JSON.stringify(body)
    for (const leak of ['secret', 'hunter2', 'postgres', 'db.internal', 'localhost', 'family_planner']) expect(text).not.toContain(leak)
  })

  it('reports "unknown" rather than failing when the build is not stamped', async () => {
    delete process.env.RELEASE_SHA
    const body = await (await get()).json()
    expect(body.commit).toBe('unknown')
    expect(body.builtAt).toBe('unknown')
  })
})
