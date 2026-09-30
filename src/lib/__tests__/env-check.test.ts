import { assertProductionEnv, checkProductionEnv } from '@/lib/env-check'

const GOOD = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(64),
  DATABASE_URL: 'postgresql://u@h:5432/db',
  MAILGUN_API_KEY: 'key',
  TRUSTED_PROXY_HOPS: '1',
}

function quietLog() {
  return { warn: jest.fn(), error: jest.fn() }
}

describe('checkProductionEnv', () => {
  it('a complete production environment has no problems', () => {
    expect(checkProductionEnv(GOOD)).toEqual({ errors: [], warnings: [] })
  })

  it('a missing or short JWT_SECRET and a missing DATABASE_URL are errors', () => {
    expect(checkProductionEnv({ ...GOOD, JWT_SECRET: undefined }).errors).toHaveLength(1)
    expect(checkProductionEnv({ ...GOOD, JWT_SECRET: 'short' }).errors).toHaveLength(1)
    expect(checkProductionEnv({ ...GOOD, DATABASE_URL: '' }).errors).toHaveLength(1)
  })

  it('missing mail or proxy hops are warnings', () => {
    const { errors, warnings } = checkProductionEnv({
      ...GOOD,
      MAILGUN_API_KEY: undefined,
      TRUSTED_PROXY_HOPS: undefined,
    })
    expect(errors).toEqual([])
    expect(warnings).toHaveLength(2)
  })

  it.each(['0', 'two', '-1', '1.5'])('TRUSTED_PROXY_HOPS=%p is flagged as ignored', (hops) => {
    expect(checkProductionEnv({ ...GOOD, TRUSTED_PROXY_HOPS: hops }).warnings.join(' ')).toMatch(/TRUSTED_PROXY_HOPS/)
  })

  it('never includes a value in a message', () => {
    const { errors, warnings } = checkProductionEnv({ ...GOOD, JWT_SECRET: 'secret-value', TRUSTED_PROXY_HOPS: 'weird-value' })
    expect([...errors, ...warnings].join(' ')).not.toMatch(/secret-value|weird-value/)
  })
})

describe('assertProductionEnv', () => {
  it('throws in production when sign-in cannot work', () => {
    const log = quietLog()
    expect(() => assertProductionEnv({ ...GOOD, JWT_SECRET: undefined }, log)).toThrow(/Refusing to start/)
    expect(log.error).toHaveBeenCalled()
  })

  it('only warns for missing mail', () => {
    const log = quietLog()
    expect(() => assertProductionEnv({ ...GOOD, MAILGUN_API_KEY: undefined }, log)).not.toThrow()
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('does nothing outside production or during next build', () => {
    const log = quietLog()
    expect(() => assertProductionEnv({ NODE_ENV: 'development' }, log)).not.toThrow()
    expect(() => assertProductionEnv({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }, log)).not.toThrow()
    expect(() => assertProductionEnv({ NODE_ENV: 'production', npm_lifecycle_event: 'build' }, log)).not.toThrow()
    expect(log.warn).not.toHaveBeenCalled()
  })
})

describe('instrumentation register()', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('checks the environment on the Node.js runtime only', async () => {
    const { register } = await import('@/instrumentation')
    process.env = { ...saved, NEXT_RUNTIME: 'edge', NODE_ENV: 'production', JWT_SECRET: '' }
    await expect(register()).resolves.toBeUndefined()
    process.env = { ...saved, NEXT_RUNTIME: 'nodejs', NODE_ENV: 'production', JWT_SECRET: '', DATABASE_URL: '' }
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(register()).rejects.toThrow(/Refusing to start/)
  })
})
