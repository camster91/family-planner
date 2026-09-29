// #161 observability foundation: request ids, build identity, the error
// envelope, route timing lines, the slow-query hook and the perf target guard.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)

import { getRequestId, isValidRequestId, newRequestId, resolveRequestId } from '@/lib/request-id'
import { apiError, apiErrorBody, describeError, logRouteError } from '@/lib/api-error'
import { getBuildInfo } from '@/lib/build-info'
import { shouldLogTiming, timingLine, withRouteTelemetry } from '@/lib/route-telemetry'
import { attachQueryTiming, queryShape, queryTimingConfig } from '@/lib/db-query-timing'
import { assertLocalPerfTarget, percentile, PerfTargetRefusedError } from '@/lib/perf-target'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function request(headers: Record<string, string> = {}, method = 'GET') {
  return { method, headers: new Headers(headers) }
}

describe('request id', () => {
  it('accepts well-formed inbound ids', () => {
    for (const id of ['abcdefgh', 'support-case-0001', 'A_b-9'.padEnd(12, 'x'), 'x'.repeat(64), newRequestId()]) {
      expect(isValidRequestId(id)).toBe(true)
      expect(resolveRequestId(id)).toBe(id)
    }
  })

  it.each([
    ['empty', ''],
    ['too short', 'abc'],
    ['too long', 'x'.repeat(65)],
    ['whitespace', 'abc def ghi'],
    ['newline (log injection)', 'abcdefgh\n{"level":"error"}'],
    ['quotes', 'abcdefgh"'],
    ['dots and slashes', '../../etc/passwd'],
    ['email', 'parent.a@example.test'],
    ['unicode', 'ÄÖÜabcdefgh'],
  ])('replaces an invalid inbound id (%s) with a new UUID', (_label, bad) => {
    expect(isValidRequestId(bad)).toBe(false)
    const id = resolveRequestId(bad)
    expect(id).not.toBe(bad)
    expect(id).toMatch(UUID_RE)
  })

  it('generates a new UUID when there is no inbound id', () => {
    expect(resolveRequestId(null)).toMatch(UUID_RE)
    expect(resolveRequestId(undefined)).toMatch(UUID_RE)
    expect(newRequestId()).not.toBe(newRequestId())
  })

  it('getRequestId reads the forwarded header and is stable per request object', () => {
    expect(getRequestId(request({ 'x-request-id': 'support-case-0001' }))).toBe('support-case-0001')
    const r = request()
    const first = getRequestId(r)
    expect(first).toMatch(UUID_RE)
    expect(getRequestId(r)).toBe(first)
    expect(getRequestId(request())).not.toBe(first)
    expect(getRequestId(request({ 'x-request-id': 'bad id' }))).toMatch(UUID_RE)
  })
})

describe('error envelope', () => {
  it('flat (default) keeps `error` as the human message and adds code + requestId', () => {
    expect(apiErrorBody('QUERY_TOO_SHORT', 'Too short.', { requestId: 'req-00000001' })).toEqual({
      error: 'Too short.',
      code: 'QUERY_TOO_SHORT',
      requestId: 'req-00000001',
    })
  })

  it('nested matches the API_CONTRACTS.md target shape', () => {
    expect(apiErrorBody('VALIDATION_ERROR', 'Bad.', { requestId: 'req-00000001', shape: 'nested', retryable: false })).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Bad.', requestId: 'req-00000001', retryable: false },
    })
  })

  it('a malformed code falls back to INTERNAL_ERROR', () => {
    expect(apiErrorBody('not a code', 'x', { requestId: 'req-00000001' })).toMatchObject({ code: 'INTERNAL_ERROR' })
  })

  it('apiError sets status, headers and X-Request-Id', async () => {
    const res: any = apiError(429, 'RATE_LIMITED', 'Slow down.', { requestId: 'req-00000001', headers: { 'Retry-After': '5' } })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(res.headers.get('X-Request-Id')).toBe('req-00000001')
    expect(await res.json()).toEqual({ error: 'Slow down.', code: 'RATE_LIMITED', requestId: 'req-00000001' })
  })

  it('describeError keeps only a safe name and a short machine code', () => {
    const e = Object.assign(new Error('Unique constraint failed on title "Casey birthday"'), { name: 'PrismaClientKnownRequestError', code: 'P2002' })
    expect(describeError(e)).toEqual({ errorName: 'PrismaClientKnownRequestError', errorCode: 'P2002' })
    expect(describeError(Object.assign(new Error('x'), { code: 'value with spaces' }))).toEqual({ errorName: 'Error' })
    expect(describeError(Object.assign(new Error('x'), { name: 'Name with "quotes"' }))).toEqual({ errorName: 'unknown' })
    expect(describeError('a thrown string with private text')).toEqual({ errorName: 'unknown' })
    expect(describeError(null)).toEqual({ errorName: 'unknown' })
  })

  it('logRouteError logs exactly route, requestId, errorName and errorCode', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const e = Object.assign(new Error('medication for Riley: 5ml'), { name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { target: ['title'] } })
      logRouteError('GET /api/test', e, 'req-00000001')
      expect(spy).toHaveBeenCalledTimes(1)
      const line = String(spy.mock.calls[0][0])
      const json = JSON.parse(line.slice(line.indexOf('{')))
      expect(json).toEqual({ route: 'GET /api/test', requestId: 'req-00000001', errorName: 'PrismaClientKnownRequestError', errorCode: 'P2002' })
      expect(line).not.toContain('Riley')
      expect(line).not.toContain('title')
      expect(line).not.toContain('at ')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('build identity', () => {
  it('returns only version, commit and builtAt', () => {
    const info = getBuildInfo({ RELEASE_SHA: 'ABCDEF0123456789abcdef0123456789abcdef01', FP_BUILT_AT: '2026-09-29T12:00:00.000Z', JWT_SECRET: 's'.repeat(32), DATABASE_URL: 'postgresql://u:p@h/db' })
    expect(Object.keys(info).sort()).toEqual(['builtAt', 'commit', 'version'])
    expect(info.commit).toBe('abcdef0123456789abcdef0123456789abcdef01')
    expect(info.builtAt).toBe('2026-09-29T12:00:00.000Z')
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(JSON.stringify(info)).not.toMatch(/postgres|sss/)
  })

  it('reads anything malformed or missing as "unknown"', () => {
    expect(getBuildInfo({})).toMatchObject({ commit: 'unknown', builtAt: 'unknown' })
    expect(getBuildInfo({ RELEASE_SHA: 'main; rm -rf /', FP_BUILT_AT: 'yesterday' })).toMatchObject({ commit: 'unknown', builtAt: 'unknown' })
    expect(getBuildInfo({ RELEASE_SHA: 'abc' })).toMatchObject({ commit: 'unknown' })
  })
})

describe('route timing', () => {
  const ON = { ROUTE_TIMING_LOG: '1' }

  it('is off by default and when not exactly "1"', () => {
    expect(shouldLogTiming(200, {})).toBe(false)
    expect(shouldLogTiming(500, { ROUTE_TIMING_LOG: 'true' })).toBe(false)
  })

  it('samples 2xx/4xx but always writes 5xx while on', () => {
    expect(shouldLogTiming(200, ON)).toBe(true)
    expect(shouldLogTiming(200, { ...ON, ROUTE_TIMING_SAMPLE_RATE: '0' })).toBe(false)
    expect(shouldLogTiming(503, { ...ON, ROUTE_TIMING_SAMPLE_RATE: '0' })).toBe(true)
    expect(shouldLogTiming(200, { ...ON, ROUTE_TIMING_SAMPLE_RATE: '0.25' }, () => 0.1)).toBe(true)
    expect(shouldLogTiming(200, { ...ON, ROUTE_TIMING_SAMPLE_RATE: '0.25' }, () => 0.9)).toBe(false)
  })

  it('a timing line has only the documented fields', () => {
    const line = timingLine('/api/audit', 'get', 200, 12.345, 'req-00000001')
    expect(Object.keys(line).sort()).toEqual(['durationMs', 'event', 'level', 'method', 'release', 'requestId', 'route', 'status', 'ts'])
    expect(line).toMatchObject({ event: 'http.request', method: 'GET', route: '/api/audit', status: 200, durationMs: 12.3 })
    expect(timingLine('/x', 'BREW', 200, 1, 'r').method).toBe('OTHER')
  })

  describe('withRouteTelemetry', () => {
    let logSpy: jest.SpyInstance
    beforeEach(() => {
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    })
    afterEach(() => {
      logSpy.mockRestore()
      delete process.env.ROUTE_TIMING_LOG
    })

    it('adds X-Request-Id and writes nothing while off', async () => {
      const handler = withRouteTelemetry('/api/x', async (_r: { method?: string; headers?: Headers }) => ({ status: 204, headers: new Headers() }))
      const res = await handler(request({ 'x-request-id': 'support-case-0001' }))
      expect(res.headers.get('X-Request-Id')).toBe('support-case-0001')
      expect(logSpy).not.toHaveBeenCalled()
    })

    it('writes one JSON line with the route template, never the raw URL or query', async () => {
      process.env.ROUTE_TIMING_LOG = '1'
      const handler = withRouteTelemetry('/api/search', async (_r: { method?: string; headers?: Headers; url?: string }) => ({ status: 200, headers: new Headers() }))
      await handler({ ...request({ 'x-request-id': 'support-case-0001', cookie: 'session_token=secret' }), url: 'http://localhost/api/search?q=dentist' })
      expect(logSpy).toHaveBeenCalledTimes(1)
      const line = String(logSpy.mock.calls[0][0])
      const json = JSON.parse(line)
      expect(json).toMatchObject({ event: 'http.request', method: 'GET', route: '/api/search', status: 200, requestId: 'support-case-0001' })
      expect(line).not.toMatch(/dentist|secret|q=/)
    })

    it('records a thrown handler as 500 and rethrows', async () => {
      process.env.ROUTE_TIMING_LOG = '1'
      const handler = withRouteTelemetry('/api/boom', async (_r: { method?: string; headers?: Headers }) => {
        throw new Error('private text')
      })
      await expect(handler(request())).rejects.toThrow('private text')
      const json = JSON.parse(String(logSpy.mock.calls[0][0]))
      expect(json.status).toBe(500)
      expect(JSON.stringify(json)).not.toContain('private')
    })

    it('tolerates plain-object headers from mocked responses', async () => {
      const handler = withRouteTelemetry('/api/x', async (_r: { method?: string; headers?: Headers }) => ({ status: 200, headers: { a: 'b' } }))
      await expect(handler(request())).resolves.toEqual({ status: 200, headers: { a: 'b' } })
    })
  })
})

describe('slow-query hook', () => {
  it('is opt-in and refused in production', () => {
    expect(queryTimingConfig({})).toBeNull()
    expect(queryTimingConfig({ PRISMA_QUERY_TIMING: '1', NODE_ENV: 'production' })).toBeNull()
    expect(queryTimingConfig({ PRISMA_QUERY_TIMING: '1', NODE_ENV: 'development' })).toEqual({ thresholdMs: 100 })
    expect(queryTimingConfig({ PRISMA_QUERY_TIMING: '1', PRISMA_SLOW_QUERY_MS: '0' })).toEqual({ thresholdMs: 0 })
    expect(queryTimingConfig({ PRISMA_QUERY_TIMING: '1', PRISMA_SLOW_QUERY_MS: 'soon' })).toEqual({ thresholdMs: 100 })
  })

  it('masks literals and never reads params', () => {
    expect(queryShape(`SELECT "t"."id" FROM "public"."Chore" AS "t" WHERE "t"."title" = 'Casey''s room' AND "t"."xp" > 42 LIMIT $1`)).toBe(
      'SELECT "t"."id" FROM "public"."Chore" AS "t" WHERE "t"."title" = ? AND "t"."xp" > ? LIMIT $?'
    )
    const lines: string[] = []
    let listener: ((e: any) => void) | undefined
    attachQueryTiming({ $on: (_event, cb) => (listener = cb) }, { thresholdMs: 50 }, (l) => lines.push(l))
    listener!({ duration: 10, query: 'SELECT 1', params: '["fast"]' })
    listener!({ duration: 75, query: 'SELECT * FROM "Message" WHERE body = $1', params: '["private message body"]' })
    expect(lines).toHaveLength(1)
    const json = JSON.parse(lines[0])
    expect(Object.keys(json).sort()).toEqual(['durationMs', 'event', 'level', 'statement', 'ts'])
    expect(json).toMatchObject({ event: 'db.slow_query', durationMs: 75 })
    expect(lines[0]).not.toContain('private message body')
  })
})

describe('perf baseline target guard', () => {
  it.each(['http://localhost:3000', 'http://127.0.0.1:3100', 'http://[::1]:3000', 'https://localhost', undefined, ''])('allows loopback %s', (url) => {
    expect(() => assertLocalPerfTarget(url)).not.toThrow()
  })

  it.each([
    'https://family.ashbi.ca',
    'http://10.0.0.5:3000',
    'http://192.168.1.2',
    'http://localhost.example.com',
    'http://127.0.0.1.nip.io',
    'http://user:pass@localhost:3000',
    'ftp://localhost',
    'not a url',
  ])('refuses %s', (url) => {
    expect(() => assertLocalPerfTarget(url)).toThrow(PerfTargetRefusedError)
  })

  it('refuses NODE_ENV=production even on loopback', () => {
    expect(() => assertLocalPerfTarget('http://localhost:3000', { NODE_ENV: 'production' })).toThrow(PerfTargetRefusedError)
  })

  it('computes nearest-rank percentiles', () => {
    const samples = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(percentile(samples, 50)).toBe(10)
    expect(percentile(samples, 95)).toBe(19)
    expect(percentile([5], 95)).toBe(5)
    expect(percentile([], 50)).toBeNaN()
  })
})
