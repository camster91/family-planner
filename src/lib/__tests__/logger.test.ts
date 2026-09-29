// src/lib/logger.ts writes only an error's identity (docs/architecture/
// OBSERVABILITY.md "Logger field rules"): errorName, errorCode, errorStatus.
// Never a message, stack, cause, Prisma meta, response body or any other field
// of a thrown value, in production (JSON) or development (text) format.

type Logger = typeof import('@/lib/logger')

const SECRET = 'Riley medication 5ml at 12 Elm Street, parent.a@example.test'

function loadLogger(nodeEnv: string): Logger {
  const env = process.env as Record<string, string | undefined>
  const previous = env.NODE_ENV
  env.NODE_ENV = nodeEnv
  try {
    let mod: Logger | undefined
    jest.isolateModules(() => {
      mod = require('@/lib/logger') as Logger
    })
    return mod!
  } finally {
    env.NODE_ENV = previous
  }
}

function prismaLike() {
  return Object.assign(new Error(`Unique constraint failed on the fields: (\`title\`) value "${SECRET}"`), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2002',
    clientVersion: '7.0.0',
    meta: { target: ['title'], modelName: SECRET },
  })
}

function axiosLike() {
  return Object.assign(new Error(`Request failed with status code 502: ${SECRET}`), {
    name: 'AxiosError',
    code: 'ERR_BAD_RESPONSE',
    config: { url: `https://provider.example/api?q=${encodeURIComponent(SECRET)}`, data: SECRET },
    response: { status: 502, data: { error: SECRET }, headers: { 'x-echo': SECRET } },
  })
}

function nodeLike() {
  return Object.assign(new Error(`connect ECONNRESET ${SECRET}`), { code: 'ECONNRESET', syscall: SECRET })
}

function withCause() {
  return new Error('outer', { cause: new Error(SECRET) })
}

const plainObject = { message: SECRET, stack: SECRET, body: { text: SECRET }, status: 500, cause: SECRET }

const THROWN: Array<[string, unknown, Record<string, unknown>]> = [
  ['Error', new Error(SECRET), { errorName: 'Error' }],
  ['Prisma-like', prismaLike(), { errorName: 'PrismaClientKnownRequestError', errorCode: 'P2002' }],
  ['Axios-like', axiosLike(), { errorName: 'AxiosError', errorCode: 'ERR_BAD_RESPONSE', errorStatus: 502 }],
  ['Node-like', nodeLike(), { errorName: 'Error', errorCode: 'ECONNRESET' }],
  ['Error with cause', withCause(), { errorName: 'Error' }],
  ['plain object', plainObject, { errorName: 'unknown', errorStatus: 500 }],
  ['string', SECRET, { errorName: 'unknown' }],
  ['null', null, { errorName: 'unknown' }],
]

function captureAll(fn: () => void): string[] {
  const out: string[] = []
  const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
    jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      out.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    })
  )
  try {
    fn()
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  return out
}

function expectNoContent(lines: string[]) {
  const all = lines.join('\n')
  for (const fragment of ['Riley', 'Elm Street', 'example.test', 'provider.example', 'title', ' at ', 'Unique constraint', 'outer']) {
    expect(all).not.toContain(fragment)
  }
}

describe.each([
  ['production', 'production'],
  ['development', 'development'],
])('logger (%s format)', (_label, nodeEnv) => {
  const { log, describeError } = loadLogger(nodeEnv)

  function fields(line: string): Record<string, unknown> {
    const json = JSON.parse(line.slice(line.indexOf('{')))
    delete json.ts
    delete json.level
    delete json.event
    return json
  }

  it.each(THROWN)('log.error(event, thrown, context) keeps only the identity of a %s', (_name, thrown, identity) => {
    const lines = captureAll(() => log.error('test.failed', thrown, { type: 'device.paired' }))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('test.failed')
    expect(fields(lines[0])).toEqual({ type: 'device.paired', ...identity })
    expect(describeError(thrown)).toEqual(identity)
    expectNoContent(lines)
  })

  it.each(THROWN.filter(([name]) => name !== 'plain object'))(
    'log.error(event, thrown) without a context keeps only the identity of a %s',
    (_name, thrown, identity) => {
      const lines = captureAll(() => log.error('test.failed', thrown))
      expect(fields(lines[0])).toEqual(identity)
      expectNoContent(lines)
    }
  )

  it('a plain-object throw passed alone is read as context, and its message/stack/cause/object fields are still dropped', () => {
    const lines = captureAll(() => log.error('test.failed', plainObject))
    expect(fields(lines[0])).toEqual({ body: { errorName: 'unknown' }, status: 500 })
    expectNoContent(lines)
  })

  it.each(['warn', 'info'] as const)('log.%s reduces an Error or object passed as a field value', (level) => {
    const lines = captureAll(() =>
      log[level]('test.event', {
        count: 3,
        ok: true,
        route: 'GET /api/x',
        missing: undefined,
        nothing: null,
        err: prismaLike(),
        response: axiosLike(),
        nested: { deep: SECRET },
        list: [SECRET],
        message: SECRET,
        stack: SECRET,
        cause: SECRET,
      })
    )
    expect(lines).toHaveLength(1)
    expect(fields(lines[0])).toEqual({
      count: 3,
      ok: true,
      route: 'GET /api/x',
      nothing: null,
      err: { errorName: 'PrismaClientKnownRequestError', errorCode: 'P2002' },
      response: { errorName: 'AxiosError', errorCode: 'ERR_BAD_RESPONSE', errorStatus: 502 },
      nested: { errorName: 'unknown' },
      list: { errorName: 'unknown' },
    })
    expectNoContent(lines)
  })

  it('a malformed code, name or status is dropped rather than written', () => {
    const odd = Object.assign(new Error(SECRET), { name: `Bad ${SECRET}`, code: `code ${SECRET}`, status: 42 })
    expect(describeError(odd)).toEqual({ errorName: 'unknown' })
    expect(describeError({ statusCode: 404 })).toEqual({ errorName: 'unknown', errorStatus: 404 })
    expectNoContent(captureAll(() => log.error('test.failed', odd, {})))
  })

  it('a context-only error line is unchanged in shape', () => {
    const lines = captureAll(() => log.error('route.error', { route: 'GET /api/x', requestId: 'req-00000001', errorName: 'Error' }))
    expect(fields(lines[0])).toEqual({ route: 'GET /api/x', requestId: 'req-00000001', errorName: 'Error' })
  })
})
