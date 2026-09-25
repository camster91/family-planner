import { checkProviderUrlShape, isPrivateAddress } from '@/lib/outbound-url'

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ])('rejects %s', (addr) => {
    expect(isPrivateAddress(addr)).toBe(true)
  })

  it.each(['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (addr) => {
      expect(isPrivateAddress(addr)).toBe(false)
    }
  )
})

describe('checkProviderUrlShape', () => {
  it('accepts a public https provider', () => {
    expect(checkProviderUrlShape('https://api.deepseek.com')).toBeNull()
    expect(checkProviderUrlShape('https://api.openai.com/v1')).toBeNull()
  })

  it.each([
    'http://api.example.com',
    'https://localhost:11434',
    'https://127.0.0.1',
    'https://169.254.169.254/latest',
    'https://[::1]/v1',
    'https://user:pass@api.example.com',
    'https://metadata.google.internal',
    'not a url',
  ])('rejects %s', (url) => {
    expect(checkProviderUrlShape(url)).not.toBeNull()
  })
})
