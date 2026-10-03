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

describe('calendar sync settings (#264)', () => {
  const KEY = Buffer.alloc(32, 7).toString('base64')
  const FULL = {
    ...GOOD,
    APP_URL: 'https://family.ashbi.ca',
    CALENDAR_TOKEN_KEY: KEY,
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret-VALUE',
  }
  const calendarWarnings = (env: Record<string, string | undefined>) =>
    checkProductionEnv(env).warnings.filter((w) => w.startsWith('Calendar sync:'))

  it('says nothing when calendar sync is not set up at all, or is set up completely', () => {
    expect(calendarWarnings(GOOD)).toEqual([])
    expect(calendarWarnings(FULL)).toEqual([])
    expect(
      calendarWarnings({ ...FULL, MICROSOFT_CLIENT_ID: 'm', MICROSOFT_CLIENT_SECRET: 's', MICROSOFT_TENANT: 'common' })
    ).toEqual([])
  })

  it('names what is missing or malformed in a half-done setup', () => {
    expect(calendarWarnings({ ...FULL, CALENDAR_TOKEN_KEY: 'a'.repeat(64) }).join(' ')).toMatch(
      /CALENDAR_TOKEN_KEY is not base64 of exactly 32 bytes/
    )
    expect(calendarWarnings({ ...FULL, CALENDAR_TOKEN_KEY: undefined }).join(' ')).toMatch(/CALENDAR_TOKEN_KEY is not set/)
    expect(calendarWarnings({ ...FULL, APP_URL: 'http://family.ashbi.ca' }).join(' ')).toMatch(/APP_URL/)
    expect(calendarWarnings({ ...FULL, GOOGLE_CLIENT_SECRET: '' }).join(' ')).toMatch(/GOOGLE_CLIENT_SECRET is not set/)
    // No tenant means "common" (personal and work accounts): not a problem.
    expect(calendarWarnings({ ...FULL, MICROSOFT_CLIENT_ID: 'm', MICROSOFT_CLIENT_SECRET: 's' })).toEqual([])
    expect(
      calendarWarnings({ ...FULL, MICROSOFT_CLIENT_ID: 'm', MICROSOFT_CLIENT_SECRET: 's', MICROSOFT_TENANT: 'not a tenant!' }).join(' ')
    ).toMatch(/MICROSOFT_TENANT is not a valid tenant/)
    expect(calendarWarnings({ ...FULL, CALENDAR_TOKEN_KEY_PREVIOUS: 'nope' }).join(' ')).toMatch(
      /CALENDAR_TOKEN_KEY_PREVIOUS/
    )
  })

  it('never includes a calendar secret or key in a message', () => {
    const text = calendarWarnings({ ...FULL, CALENDAR_TOKEN_KEY: 'BAD-KEY-VALUE', GOOGLE_CLIENT_ID: undefined }).join(' ')
    expect(text).not.toContain('BAD-KEY-VALUE')
    expect(text).not.toContain('secret-VALUE')
  })
})
