jest.mock('@/lib/secret-box', () => ({
  decryptSecret: (value?: string | null) => (value ? `plain:${value}` : null),
}))

import { resolveCaptureConfig } from '@/lib/capture'

describe('resolveCaptureConfig', () => {
  const env = process.env

  beforeEach(() => {
    process.env = { ...env }
    delete process.env.CAPTURE_AI_KEY
    delete process.env.CAPTURE_AI_BASE_URL
    delete process.env.CAPTURE_AI_MODEL
  })

  afterAll(() => {
    process.env = env
  })

  it('returns null when neither family nor deployment key is set', () => {
    expect(resolveCaptureConfig({ capture_ai_base_url: 'https://evil.example' })).toBeNull()
  })

  it('never sends the deployment key to a family-supplied base URL', () => {
    process.env.CAPTURE_AI_KEY = 'server-key'
    process.env.CAPTURE_AI_BASE_URL = 'https://api.deepseek.com'
    const config = resolveCaptureConfig({ capture_ai_base_url: 'https://evil.example' })
    expect(config).toMatchObject({
      apiKey: 'server-key',
      baseUrl: 'https://api.deepseek.com',
      userSuppliedUrl: false,
    })
  })

  it('uses the family base URL with the family key and marks it for vetting', () => {
    process.env.CAPTURE_AI_KEY = 'server-key'
    const config = resolveCaptureConfig({
      capture_ai_key_enc: 'enc',
      capture_ai_base_url: 'https://api.openai.com/v1/',
    })
    expect(config).toMatchObject({
      apiKey: 'plain:enc',
      baseUrl: 'https://api.openai.com/v1',
      userSuppliedUrl: true,
    })
  })
})
