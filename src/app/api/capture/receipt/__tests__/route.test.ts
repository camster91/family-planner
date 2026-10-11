jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: HeadersInit }) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => body,
    }),
  },
}))

jest.mock('@/lib/api-auth', () => ({ authenticateWithFamily: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    idempotencyRecord: { findFirst: jest.fn() },
    event: { findUnique: jest.fn() },
    listItem: { findUnique: jest.fn() },
  },
}))

import { GET } from '../route'
import { authenticateWithFamily } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

const auth = { user: { id: 'user-a', family_id: 'family-a', role: 'parent', name: 'Parent A' } }
const key = '33333333-3333-4333-8333-333333333333'
const hash = 'a'.repeat(64)
const db = prisma as unknown as {
  idempotencyRecord: { findFirst: jest.Mock }
  event: { findUnique: jest.Mock }
  listItem: { findUnique: jest.Mock }
}

function request(overrides: { key?: string; action?: string; hash?: string } = {}) {
  return {
    url: 'http://localhost/api/capture/receipt',
    headers: new Headers({
      'Idempotency-Key': overrides.key ?? key,
      'X-Capture-Action': overrides.action ?? 'event.create',
      'X-Capture-Request-Hash': overrides.hash ?? hash,
    }),
  } as any
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    family_id: 'family-a',
    action: 'event.create',
    request_hash: hash,
    response_status: 200,
    response_body: { event: { id: 'event-a' } },
    expires_at: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

describe('GET /api/capture/receipt', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(authenticateWithFamily).mockResolvedValue([auth, null] as never)
    db.idempotencyRecord.findFirst.mockResolvedValue(record())
    db.event.findUnique.mockResolvedValue({ id: 'event-a', family_id: 'family-a' })
  })

  it('requires the idempotency key in the header and returns only state', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: 'committed', current: 'present' })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(db.idempotencyRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { scope: 'user:user-a', key } }))

    const absent = await GET(request({ key: '' }))
    expect(absent.status).toBe(400)
  })

  it('enforces capture role permission before receipt lookup', async () => {
    jest.mocked(authenticateWithFamily).mockResolvedValue([{ ...auth, user: { ...auth.user, role: 'child' } }, null] as never)
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(db.idempotencyRecord.findFirst).not.toHaveBeenCalled()
  })

  it('does not confirm missing, expired, foreign or in-progress records', async () => {
    db.idempotencyRecord.findFirst.mockResolvedValueOnce(null)
    expect(await (await GET(request())).json()).toEqual({ state: 'absent' })
    db.idempotencyRecord.findFirst.mockResolvedValueOnce(record({ expires_at: new Date(Date.now() - 1) }))
    expect(await (await GET(request())).json()).toEqual({ state: 'expired' })
    db.idempotencyRecord.findFirst.mockResolvedValueOnce(record({ family_id: 'family-b' }))
    expect(await (await GET(request())).json()).toEqual({ state: 'absent' })
    db.idempotencyRecord.findFirst.mockResolvedValueOnce(record({ response_status: null, response_body: null }))
    expect(await (await GET(request())).json()).toEqual({ state: 'pending' })
    expect(db.event.findUnique).not.toHaveBeenCalled()
  })

  it('reports a deleted committed resource without returning receipt details', async () => {
    db.event.findUnique.mockResolvedValue(null)
    const response = await GET(request())
    expect(await response.json()).toEqual({ state: 'committed', current: 'removed' })
  })

  it('checks the family-scoped grocery resource for the capture action', async () => {
    db.idempotencyRecord.findFirst.mockResolvedValue(record({
      action: 'capture.grocery.add',
      response_body: { success: true, item: { id: 'item-a', content: 'Milk' } },
    }))
    db.listItem.findUnique.mockResolvedValue({ id: 'item-a', list: { family_id: 'family-a' } })
    const response = await GET(request({ action: 'capture.grocery.add' }))
    expect(await response.json()).toEqual({ state: 'committed', current: 'present' })
    expect(db.listItem.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'item-a' } }))
  })

  it('rejects changed action or hash without reading the resource', async () => {
    const response = await GET(request({ hash: 'b'.repeat(64) }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: { code: 'CAPTURE_RECEIPT_CONFLICT', message: 'This capture does not match the saved request.' },
    })
    expect(db.event.findUnique).not.toHaveBeenCalled()
  })
})
