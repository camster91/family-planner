import { getClientIp } from '@/lib/client-ip'

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) }
}

describe('getClientIp', () => {
  const env = process.env

  afterEach(() => {
    process.env = env
  })

  it('ignores client-forged leading X-Forwarded-For entries', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('uses the only entry when the proxy sent one', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('honours TRUSTED_PROXY_HOPS for multi-proxy setups', () => {
    process.env = { ...env, TRUSTED_PROXY_HOPS: '2' }
    expect(getClientIp(req({ 'x-forwarded-for': 'forged, 203.0.113.9, 10.0.0.2' }))).toBe('203.0.113.9')
  })

  it('falls back to X-Real-IP and then unknown', () => {
    expect(getClientIp(req({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(getClientIp(req({}))).toBe('unknown')
  })
})
