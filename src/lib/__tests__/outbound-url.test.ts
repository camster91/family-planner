import { assertPublicProviderUrl, checkProviderUrlShape, isPrivateAddress } from '@/lib/outbound-url'

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1',
    // IPv4-mapped in the hex form the URL parser normalises to.
    '::ffff:7f00:1', '[::ffff:7f00:1]', '::ffff:a9fe:a9fe', '::FFFF:7F00:1', '0:0:0:0:0:ffff:7f00:1',
    // IPv4-compatible (deprecated) — refused outright.
    '::7f00:1', '::127.0.0.1', '::808:808',
    // NAT64 well-known prefix embedding a private IPv4, and the local-use prefix.
    '64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '64:ff9b::a9fe:a9fe', '64:ff9b:1::1',
    // 6to4 embedding a private IPv4.
    '2002:7f00:1::1', '2002:a9fe:a9fe::', '2002:c0a8:101::1',
    // IPv4-translated, Teredo, documentation.
    '::ffff:0:7f00:1', '2001:0:4136:e378::1', '2001:db8::1',
    // Link-local, ULA, site-local, multicast in various spellings.
    'fe80::1%eth0', 'FEBF::1', 'fc00::', 'fdff:ffff::1', 'fec0::1', 'ff02::1',
    // TEST-NET ranges.
    '198.51.100.1', '203.0.113.5',
  ])('rejects %s', (addr) => {
    expect(isPrivateAddress(addr)).toBe(true)
  })

  it.each([
    '8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8',
    '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1', '2a00:1450:4001:80b::200e',
  ])('allows %s', (addr) => {
    expect(isPrivateAddress(addr)).toBe(false)
  })

  it('returns false for non-IP strings (hostnames are judged after DNS)', () => {
    expect(isPrivateAddress('example.com')).toBe(false)
  })
})

describe('checkProviderUrlShape', () => {
  it('accepts a public https provider', () => {
    expect(checkProviderUrlShape('https://api.deepseek.com')).toBeNull()
    expect(checkProviderUrlShape('https://api.openai.com/v1')).toBeNull()
    expect(checkProviderUrlShape('https://[2606:4700:4700::1111]/v1')).toBeNull()
    expect(checkProviderUrlShape('https://[::ffff:8.8.8.8]/v1')).toBeNull()
  })

  it.each([
    'http://api.example.com',
    'https://localhost:11434',
    'https://localhost.:11434',
    'https://127.0.0.1',
    'https://169.254.169.254/latest',
    'https://[::1]/v1',
    'https://user:pass@api.example.com',
    'https://metadata.google.internal',
    'not a url',
    // IPv6 forms that embed a private IPv4 address.
    'https://[::ffff:127.0.0.1]/v1',
    'https://[::ffff:7f00:1]/v1',
    'https://[::ffff:169.254.169.254]/latest',
    'https://[::127.0.0.1]/',
    'https://[::7f00:1]/',
    'https://[64:ff9b::127.0.0.1]/',
    'https://[64:ff9b::a9fe:a9fe]/',
    'https://[2002:7f00:1::]/',
    'https://[fe80::1]/',
    'https://[fd12:3456::1]/',
    'https://0.0.0.0/',
    // Alternative IPv4 spellings the URL parser normalises to dotted form.
    'https://2130706433/',
    'https://0x7f.1/',
    'https://017700000001/',
    'https://0251.0376.0251.0376/',
    'https://127.1/',
  ])('rejects %s', (url) => {
    expect(checkProviderUrlShape(url)).not.toBeNull()
  })
})

describe('assertPublicProviderUrl', () => {
  it.each(['https://[::ffff:127.0.0.1]/v1', 'https://[64:ff9b::a9fe:a9fe]/', 'https://2130706433/'])(
    'refuses %s without resolving DNS',
    async (url) => {
      await expect(assertPublicProviderUrl(url)).rejects.toThrow('public address')
    }
  )

  it('allows a public IPv6 literal without DNS', async () => {
    await expect(assertPublicProviderUrl('https://[2606:4700:4700::1111]/')).resolves.toBeUndefined()
  })
})
