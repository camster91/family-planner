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

  it('falls back to X-Real-IP only when a proxy chain is declared, then unknown', () => {
    process.env = { ...env, TRUSTED_PROXY_HOPS: '1' }
    expect(getClientIp(req({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(getClientIp(req({}))).toBe('unknown')
  })

  it('ignores a client-supplied X-Real-IP when no proxy is declared', () => {
    const { TRUSTED_PROXY_HOPS: _unset, ...rest } = env
    void _unset
    process.env = rest
    expect(getClientIp(req({ 'x-real-ip': '203.0.113.7' }))).toBe('unknown')
    process.env = { ...env, TRUSTED_PROXY_HOPS: '' }
    expect(getClientIp(req({ 'x-real-ip': '203.0.113.7' }))).toBe('unknown')
    process.env = { ...env, TRUSTED_PROXY_HOPS: '0' }
    expect(getClientIp(req({ 'x-real-ip': '203.0.113.7' }))).toBe('unknown')
  })

  it('still prefers X-Forwarded-For over X-Real-IP', () => {
    process.env = { ...env, TRUSTED_PROXY_HOPS: '1' }
    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '1.2.3.4' }))).toBe('203.0.113.9')
  })
})
