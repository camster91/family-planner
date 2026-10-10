jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: any) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => data,
    }),
  },
}))

jest.mock('@/lib/api-auth', () => ({
  authenticateWithFamily: jest.fn(),
  requireParent: (role: string) =>
    role === 'parent'
      ? null
      : { status: 403, json: async () => ({ error: 'Only parents can perform this action' }) },
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    family: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}))

import { POST } from '../route'
import { authenticateWithFamily } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { encryptSecret } from '@/lib/secret-box'

const mockAuth = authenticateWithFamily as jest.Mock
const mockUpdate = (prisma as any).family.update as jest.Mock

function request(body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body)
  return {
    headers: new Headers(headers),
    text: async () => text,
  } as any
}

beforeAll(() => {
  process.env.JWT_SECRET = 'ai-settings-test-secret'
})

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue([
    { user: { id: 'parent-a', role: 'parent', family_id: 'family-a' } },
    null,
  ])
  mockUpdate.mockResolvedValue({
    capture_ai_key_enc: null,
    capture_ai_base_url: null,
    capture_ai_model: null,
  })
})

describe('POST /api/family/ai-settings bounds and compatibility', () => {
  it('saves a normal configuration', async () => {
    mockUpdate.mockResolvedValue({
      capture_ai_key_enc: encryptSecret('sk-test-family-key'),
      capture_ai_base_url: 'https://provider.example/v1',
      capture_ai_model: 'family-model',
    })

    const response = await POST(
      request({
        apiKey: 'sk-test-family-key',
        baseUrl: 'https://provider.example/v1',
        model: 'family-model',
      }),
    )

    expect(response.status).toBe(200)
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: 'family-a' },
      data: {
        capture_ai_base_url: 'https://provider.example/v1',
        capture_ai_model: 'family-model',
      },
    })
    expect(mockUpdate.mock.calls[0][0].data.capture_ai_key_enc).toEqual(expect.any(String))
  })

  it('keeps the existing key when apiKey is empty or omitted', async () => {
    const response = await POST(
      request({ baseUrl: 'https://provider.example/v1', model: 'family-model' }),
    )

    expect(response.status).toBe(200)
    expect(mockUpdate.mock.calls[0][0].data).toEqual({
      capture_ai_base_url: 'https://provider.example/v1',
      capture_ai_model: 'family-model',
    })
  })

  it('keeps clear semantics for the whole provider configuration', async () => {
    const response = await POST(request({ clear: true }))

    expect(response.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'family-a' },
      data: {
        capture_ai_key_enc: null,
        capture_ai_base_url: null,
        capture_ai_model: null,
      },
    })
  })

  it('rejects a body over the streamed request limit before writing', async () => {
    const response = await POST(request({ apiKey: 'a'.repeat(17_000) }))

    expect(response.status).toBe(413)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['apiKey', { apiKey: 'a'.repeat(4097) }],
    ['baseUrl', { baseUrl: `https://${'a'.repeat(2041)}.example` }],
    ['model', { model: 'm'.repeat(257) }],
  ])('rejects an oversized %s field before writing', async (_field, body) => {
    const response = await POST(request(body))

    expect(response.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

