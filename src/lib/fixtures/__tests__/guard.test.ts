import {
  assertFixtureTargetAllowed,
  evaluateFixtureTarget,
  FixtureTargetRefusedError,
} from '../guard'

const ok = (DATABASE_URL: string, extra: Record<string, string | undefined> = {}) => ({
  FIXTURES_ALLOW: '1',
  NODE_ENV: 'development',
  DATABASE_URL,
  ...extra,
})

describe('evaluateFixtureTarget', () => {
  it.each([
    'postgresql://postgres@localhost:5432/familyplanner_ci',
    'postgresql://u@127.0.0.1:5432/family_planner',
    'postgres://u@127.0.0.2/anything',
    'postgresql://u@[::1]:5432/fp_local',
    'postgresql://u@postgres:5432/family_planner_test',
    'postgresql://u@db:5432/fp-dev',
    'postgresql://u@postgres-e2e:5432/fp_e2e',
  ])('allows %s', (url) => {
    const v = evaluateFixtureTarget(ok(url))
    expect(v.reasons).toEqual([])
    expect(v.allowed).toBe(true)
  })

  it('also allows NODE_ENV=test and unset NODE_ENV', () => {
    expect(evaluateFixtureTarget(ok('postgresql://localhost/x', { NODE_ENV: 'test' })).allowed).toBe(true)
    expect(evaluateFixtureTarget(ok('postgresql://localhost/x', { NODE_ENV: undefined })).allowed).toBe(true)
  })

  it('requires the explicit opt-in to be exactly "1"', () => {
    for (const FIXTURES_ALLOW of [undefined, '', '0', 'true', 'yes', ' 1']) {
      const v = evaluateFixtureTarget(ok('postgresql://localhost/fp_test', { FIXTURES_ALLOW }))
      expect(v.allowed).toBe(false)
      expect(v.reasons.join()).toMatch(/FIXTURES_ALLOW=1/)
    }
  })

  it.each(['production', 'PRODUCTION', ' production '])('refuses NODE_ENV=%p', (NODE_ENV) => {
    const v = evaluateFixtureTarget(ok('postgresql://localhost/fp_test', { NODE_ENV }))
    expect(v.allowed).toBe(false)
    expect(v.reasons.join()).toMatch(/NODE_ENV/)
  })

  it.each([
    ['production docker shape (service host, prod db name)', 'postgresql://family_planner@postgres:5432/family_planner'],
    ['service host without test/dev token', 'postgresql://u@db:5432/familyplanner'],
    ['token only as a substring', 'postgresql://u@db:5432/contestant'],
    ['ashbi host', 'postgresql://u@family.ashbi.ca:5432/fp_test'],
    ['ashbi db on loopback', 'postgresql://u@localhost:5432/ashbi_family'],
    ['prod db on loopback', 'postgresql://u@localhost:5432/family_prod'],
    ['prod service host', 'postgresql://u@postgres-prod:5432/fp_test'],
    ['remote FQDN with test db', 'postgresql://u@db.example.com:5432/fp_test'],
    ['remote IP', 'postgresql://u@10.0.0.5:5432/fp_test'],
    ['host override in query', 'postgresql://u@localhost:5432/fp_test?host=/var/run/prod'],
    ['wrong scheme', 'mysql://u@localhost:3306/fp_test'],
    ['no database name', 'postgresql://u@localhost:5432'],
    ['not a URL', 'not a url'],
    ['empty', ''],
  ])('refuses %s', (_label, url) => {
    const v = evaluateFixtureTarget(ok(url))
    expect(v.allowed).toBe(false)
    expect(v.reasons.length).toBeGreaterThan(0)
  })

  it('refuses when DATABASE_URL is missing', () => {
    const v = evaluateFixtureTarget({ FIXTURES_ALLOW: '1', NODE_ENV: 'development' })
    expect(v.allowed).toBe(false)
    expect(v.reasons).toContain('DATABASE_URL is not set')
  })

  it('never echoes credentials in reasons', () => {
    // Built at runtime so secret scanners don't flag a fake credential URL.
    const password = ['not', 'a', 'real', 'secret'].join('-')
    const url = new URL('postgresql://prod.ashbi.ca:5432/family_planner')
    url.username = 'admin'
    url.password = password
    const v = evaluateFixtureTarget(ok(url.toString(), { NODE_ENV: 'production' }))
    expect(v.allowed).toBe(false)
    expect(JSON.stringify(v)).not.toContain(password)
    expect(JSON.stringify(v)).not.toContain('admin')
  })
})

describe('assertFixtureTargetAllowed', () => {
  it('returns the verdict when allowed', () => {
    expect(assertFixtureTargetAllowed(ok('postgresql://localhost/fp_test'))).toMatchObject({
      allowed: true,
      host: 'localhost',
      database: 'fp_test',
    })
  })

  it('throws a typed error listing every reason when refused', () => {
    expect.assertions(3)
    try {
      assertFixtureTargetAllowed({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u@postgres/family_planner' })
    } catch (err) {
      expect(err).toBeInstanceOf(FixtureTargetRefusedError)
      const reasons = (err as FixtureTargetRefusedError).reasons
      expect(reasons.length).toBeGreaterThanOrEqual(3)
      expect((err as Error).message).toMatch(/Refusing/)
    }
  })
})
