jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      headers: new Headers(),
      json: async () => body,
    }),
  },
}))
jest.mock('@/lib/api-auth', () => ({ authenticateWithFamily: jest.fn() }))
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: jest.fn() }))
jest.mock('@/lib/role-capabilities', () => ({ canCreateList: jest.fn(() => true) }))
jest.mock('@/lib/person-list-item-create', () => ({ createCapturedGrocery: jest.fn(), authorizePersonListItemReplay: jest.fn() }))
jest.mock('@/lib/idempotency', () => ({
  readIdempotencyKey: jest.fn(() => ({ key: '33333333-3333-4333-8333-333333333333', error: null })),
  withIdempotency: jest.fn(async (_db, _key, _context, _body, effect) => {
    const result = await effect({ recordId: 'receipt-a' })
    return {
      status: result.status,
      headers: new Headers(),
      json: async () => result.body,
    }
  }),
}))
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }))

import { POST } from '../route'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { createCapturedGrocery } from '@/lib/person-list-item-create'
import { withIdempotency } from '@/lib/idempotency'
import { prisma } from '@/lib/prisma'

const user = { id: 'user-a', family_id: 'family-a', role: 'parent', name: 'Parent A' }

function request(body: unknown) {
  return { json: async () => body, headers: new Headers({ 'Idempotency-Key': '33333333-3333-4333-8333-333333333333' }) } as any
}

describe('POST /api/capture/grocery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(authenticateWithFamily).mockResolvedValue([{ user }, null] as never)
    jest.mocked(featureGate).mockResolvedValue(null)
    jest.mocked(createCapturedGrocery).mockResolvedValue({ status: 200, body: { success: true, item: { id: 'item-a' } } })
  })

  it('delegates the keyed capture payload and actor to its canonical atomic effect', async () => {
    const response = await POST(request({ content: '  Milk  ' }))
    expect(response.status).toBe(200)
    expect(withIdempotency).toHaveBeenCalledWith(
      prisma,
      '33333333-3333-4333-8333-333333333333',
      expect.objectContaining({ action: 'capture.grocery.add' }),
      { content: 'Milk', quantity: 1 },
      expect.any(Function),
      expect.objectContaining({ beforeReplay: expect.any(Function) }),
    )
    expect(createCapturedGrocery).toHaveBeenCalledWith(
      prisma, { content: 'Milk', quantity: 1 },
      { familyId: 'family-a', addedBy: 'user-a', role: 'parent', generation: 0 }, 'receipt-a',
    )
  })

  it('rejects invalid input before opening the transaction', async () => {
    const response = await POST(request({ content: ' ' }))
    expect(response.status).toBe(400)
    expect(createCapturedGrocery).not.toHaveBeenCalled()
  })
})
