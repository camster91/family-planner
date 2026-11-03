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

jest.mock('@/lib/gemini-key-check', () => ({ checkGeminiKey: jest.fn() }))
import { checkGeminiKey } from '@/lib/gemini-key-check'
// The release decision is Gemini OFF (#144). Activation-path cases below opt in
// explicitly to keep the retained, not-yet-approved validation path tested.
let mockGeminiApproved = false
jest.mock('@/lib/gemini-policy', () => {
  const actual = jest.requireActual('@/lib/gemini-policy')
  return {
    ...actual,
    geminiProviderApproved: () => mockGeminiApproved,
    geminiBlocked: (value: string | null | undefined) => !mockGeminiApproved && actual.isGeminiProviderUrl(value),
  }
})

import { GET, POST } from '../route'
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


describe('Gemini off for this release (#144)', () => {
  it('refuses the Gemini preset before any key check or storage write', async () => {
    const response = await POST(request({ provider: 'gemini', apiKey: 'fabricated-gemini-key' }))
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('GEMINI_DISABLED')
    expect(checkGeminiKey).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
  it.each([
    'https://generativelanguage.googleapis.com/v1beta/openai',
    'https://generativelanguage.googleapis.com/v1beta',
    'https://us-central1-aiplatform.googleapis.com/v1/projects/x',
  ])('refuses a typed Gemini URL %s', async (baseUrl) => {
    const response = await POST(request({ apiKey: 'fabricated-gemini-key', baseUrl }))
    expect(response.status).toBe(409)
    expect(checkGeminiKey).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
  it('reports retained Gemini settings as turned off without returning the key', async () => {
    ;(prisma as any).family.findUnique.mockResolvedValue({ capture_ai_key_enc: encryptSecret('fabricated-gemini-key-123'), capture_ai_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', capture_ai_model: 'gemini-3.8-flash' })
    const body = await (await GET(request({}))).json()
    expect(body).toEqual(expect.objectContaining({ configured: true, geminiAvailable: false, providerDisabled: true }))
    expect(JSON.stringify(body)).not.toContain('fabricated-gemini-key-123')
  })
  it('does not move a retained Gemini key to another provider without a new key', async () => {
    ;(prisma as any).family.findUnique.mockResolvedValue({ capture_ai_key_enc: encryptSecret('fabricated-gemini-key-123'), capture_ai_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai' })
    expect((await POST(request({ baseUrl: '' }))).status).toBe(400)
    expect((await POST(request({ baseUrl: 'https://provider.example/v1' }))).status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
  it('still saves an unrelated provider with its own key', async () => {
    const response = await POST(request({ apiKey: 'fabricated-other-provider-key', baseUrl: 'https://provider.example/v1' }))
    expect(response.status).toBe(200)
    expect(checkGeminiKey).not.toHaveBeenCalled()
  })
})

describe('Gemini preset (retained path; only after a separately approved activation)', () => {
  beforeEach(() => { mockGeminiApproved = true })
  afterEach(() => { mockGeminiApproved = false })
  it('validates a new key and saves the supported endpoint and model', async () => {
    (checkGeminiKey as jest.Mock).mockResolvedValue('valid')
    const response = await POST(request({ provider: 'gemini', apiKey: 'fabricated-gemini-key' }))
    expect(response.status).toBe(200)
    expect(checkGeminiKey).toHaveBeenCalledWith('fabricated-gemini-key')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ capture_ai_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', capture_ai_model: 'gemini-3.8-flash' }) }))
  })
  it.each(['invalid', 'unavailable'])('preserves saved settings when key check is %s', async (result) => {
    (checkGeminiKey as jest.Mock).mockResolvedValue(result)
    const response = await POST(request({ provider: 'gemini', apiKey: 'fabricated-gemini-key' }))
    expect(response.status).toBe(result === 'invalid' ? 400 : 503)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})


it('does not persist a verified key after household access changes during verification', async () => {
  mockGeminiApproved = true;
  (checkGeminiKey as jest.Mock).mockResolvedValue('valid')
  mockAuth.mockResolvedValueOnce([{ user: { id: 'parent-a', role: 'parent', family_id: 'family-a' }, payload: { tv: 0 } }, null])
  mockAuth.mockResolvedValueOnce([{ user: { id: 'parent-a', role: 'parent', family_id: 'family-b' }, payload: { tv: 1 } }, null])
  expect((await POST(request({ provider: 'gemini', apiKey: 'fabricated-gemini-key' }))).status).toBe(409)
  expect(checkGeminiKey).toHaveBeenCalled()
  expect(mockUpdate).not.toHaveBeenCalled()
  mockGeminiApproved = false
})
it('never sends another provider retained key to Google', async () => {
  mockGeminiApproved = true
  ;(prisma as any).family.findUnique.mockResolvedValue({ capture_ai_key_enc: encryptSecret('fabricated-other-provider-key'), capture_ai_base_url: 'https://provider.example/v1' })
  expect((await POST(request({ provider: 'gemini' }))).status).toBe(400)
  expect(checkGeminiKey).not.toHaveBeenCalled()
  expect(mockUpdate).not.toHaveBeenCalled()
  mockGeminiApproved = false
})
