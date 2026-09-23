// Readiness-probe contract for #187.
//
// A degraded instance MUST answer 503. The Docker HEALTHCHECK is
// `wget --spider`, which inspects only the status code — so while this route
// answered 200 unconditionally, a container with a dead database or a missing
// JWT_SECRET was reported healthy and Coolify would promote the deploy.

let mockPrisma: { $queryRaw: jest.Mock } | undefined

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    return mockPrisma
  },
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => ({
      status: init?.status || 200,
      json: async () => data,
    }),
  },
}))

import { GET as health } from '@/app/api/health/route'
import { GET as live } from '@/app/api/health/live/route'

const ORIGINAL = {
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
}

async function call(handler: () => Promise<unknown>) {
  const res = (await handler()) as { status: number; json: () => Promise<any> }
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  mockPrisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) }
  process.env.DATABASE_URL = 'postgresql://user@localhost:5432/familyplanner'
  process.env.JWT_SECRET = 'a'.repeat(32)
  process.env.NEXT_PUBLIC_APP_URL = 'https://family.ashbi.ca'
})

afterAll(() => {
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('GET /api/health (readiness)', () => {
  it('returns 200 and healthy when the database answers and config is present', async () => {
    const { status, body } = await call(health)
    expect(status).toBe(200)
    expect(body.status).toBe('healthy')
    expect(body.checks.database).toBe('connected')
    expect(body.checks.environment.jwtSecret).toBe('configured')
  })

  it('returns 503 when the database query fails', async () => {
    mockPrisma!.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'))
    const { status, body } = await call(health)
    expect(status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.checks.database).toBe('error')
  })

  it('returns 503 when the prisma client was never initialised', async () => {
    mockPrisma = undefined
    const { status, body } = await call(health)
    expect(status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.checks.database).toBe('disconnected')
  })

  it('returns 503 when JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET
    const { status, body } = await call(health)
    expect(status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.checks.environment.jwtSecret).toBe('missing')
  })

  it('returns 503 when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL
    const { status, body } = await call(health)
    expect(status).toBe(503)
    expect(body.checks.environment.databaseUrl).toBe('missing')
  })
})

describe('GET /api/health/live (liveness)', () => {
  it('returns 200 even when the database is unreachable', async () => {
    mockPrisma = undefined
    delete process.env.DATABASE_URL
    delete process.env.JWT_SECRET
    const { status, body } = await call(live)
    expect(status).toBe(200)
    expect(body.status).toBe('alive')
  })
})
