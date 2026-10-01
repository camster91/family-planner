// Connect-time DNS pinning for user-supplied URLs (DNS rebinding guard).
// The resolver is injected, so no real DNS or network is used.

import type { LookupAddress } from 'node:dns'
import {
  UnsafeAddressError,
  createPinnedLookup,
  createSafeAgent,
  isUnsafeAddressError,
  safeFetch,
  type ResolvedAddress,
  type Resolver,
} from '../safe-fetch'

const PUBLIC_V4: ResolvedAddress = { address: '93.184.215.14', family: 4 }
const PUBLIC_V6: ResolvedAddress = { address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 }

const PRIVATE_ANSWERS: Array<[string, ResolvedAddress]> = [
  ['127.0.0.1', { address: '127.0.0.1', family: 4 }],
  ['10.x', { address: '10.1.2.3', family: 4 }],
  ['::1', { address: '::1', family: 6 }],
  ['::ffff:7f00:1', { address: '::ffff:7f00:1', family: 6 }],
  ['169.254.169.254', { address: '169.254.169.254', family: 4 }],
]

type LookupResult = { err: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number }

function runLookup(resolve: Resolver, options: { all?: boolean; family?: number } = {}): Promise<LookupResult> {
  const lookup = createPinnedLookup(resolve)
  return new Promise((done) => {
    lookup('feed.example.com', options, (err, address, family) => done({ err, address, family }))
  })
}

/** Answers with `first` for the first call and `later` for every call after. */
function rebindingResolver(first: ResolvedAddress[], later: ResolvedAddress[]) {
  let calls = 0
  const resolve = jest.fn(async () => (calls++ === 0 ? first : later))
  return resolve
}

async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (err) {
    return err
  }
  throw new Error('expected rejection')
}

describe('createPinnedLookup', () => {
  it('passes a public IPv4 answer through to the socket', async () => {
    const { err, address, family } = await runLookup(async () => [PUBLIC_V4])
    expect(err).toBeNull()
    expect(address).toBe(PUBLIC_V4.address)
    expect(family).toBe(4)
  })

  it('returns every vetted address when net asks for all (happy eyeballs)', async () => {
    const { err, address } = await runLookup(async () => [PUBLIC_V6, PUBLIC_V4], { all: true })
    expect(err).toBeNull()
    expect(address).toEqual([PUBLIC_V6, PUBLIC_V4])
  })

  it('honours a requested address family', async () => {
    const { err, address, family } = await runLookup(async () => [PUBLIC_V6, PUBLIC_V4], { family: 4 })
    expect(err).toBeNull()
    expect(address).toBe(PUBLIC_V4.address)
    expect(family).toBe(4)
  })

  it.each(PRIVATE_ANSWERS)('refuses a host that resolves to %s', async (_label, answer) => {
    const { err } = await runLookup(async () => [answer])
    expect(err).toBeInstanceOf(UnsafeAddressError)
  })

  it.each(PRIVATE_ANSWERS)('refuses a mixed public + %s answer', async (_label, answer) => {
    const { err } = await runLookup(async () => [PUBLIC_V4, answer], { all: true })
    expect(err).toBeInstanceOf(UnsafeAddressError)
    const single = await runLookup(async () => [PUBLIC_V4, answer])
    expect(single.err).toBeInstanceOf(UnsafeAddressError)
  })

  it('refuses an empty answer', async () => {
    const { err } = await runLookup(async () => [])
    expect(err).toBeInstanceOf(UnsafeAddressError)
  })

  it('passes resolver failures through', async () => {
    const failure = Object.assign(new Error('nope'), { code: 'ENOTFOUND' })
    const { err } = await runLookup(async () => {
      throw failure
    })
    expect(err).toBe(failure)
  })
})

describe('safeFetch', () => {
  it.each(PRIVATE_ANSWERS)(
    'refuses at connect time when DNS rebinds to %s after a passing check',
    async (_label, privateAnswer) => {
      const resolve = rebindingResolver([PUBLIC_V4], [privateAnswer])

      // The pre-flight check sees the public answer and passes.
      const check = await runLookup(resolve)
      expect(check.err).toBeNull()
      expect(check.address).toBe(PUBLIC_V4.address)

      // The connection resolves again, sees the private answer and is refused.
      const agent = createSafeAgent(resolve)
      try {
        const err = await rejectionOf(safeFetch('https://feed.example.com/a.ics', {}, { dispatcher: agent }))
        expect(isUnsafeAddressError(err)).toBe(true)
        expect(resolve).toHaveBeenCalledTimes(2)
        expect(resolve).toHaveBeenLastCalledWith('feed.example.com')
      } finally {
        await agent.close()
      }
    }
  )

  it('refuses a mixed public + private answer at connect time', async () => {
    const resolve = jest.fn(async () => [PUBLIC_V4, { address: '10.0.0.1', family: 4 }])
    const agent = createSafeAgent(resolve)
    try {
      const err = await rejectionOf(safeFetch('https://feed.example.com/a.ics', {}, { dispatcher: agent }))
      expect(isUnsafeAddressError(err)).toBe(true)
    } finally {
      await agent.close()
    }
  })

  it.each([
    'http://feed.example.com/a.ics',
    'https://127.0.0.1/a.ics',
    'https://[::ffff:7f00:1]/a.ics',
    'https://169.254.169.254/latest/meta-data',
    'https://user:pass@feed.example.com/a.ics',
  ])('refuses %s before any lookup or connection', async (url) => {
    const resolve = jest.fn(async () => [PUBLIC_V4])
    const agent = createSafeAgent(resolve)
    try {
      const err = await rejectionOf(safeFetch(url, {}, { dispatcher: agent }))
      expect(isUnsafeAddressError(err)).toBe(true)
      expect(resolve).not.toHaveBeenCalled()
    } finally {
      await agent.close()
    }
  })
})
