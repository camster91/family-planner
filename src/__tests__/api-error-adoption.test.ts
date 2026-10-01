// #161: the routes that adopted the error envelope (`src/lib/api-error.ts`)
// return a stable `code` and the request id on errors, keep their success
// bodies and status codes, and log failures without message, query or body.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import { GET as auditGET } from '@/app/api/audit/route'
import { GET as searchGET } from '@/app/api/search/route'
import { GET as prefsGET, PATCH as prefsPATCH } from '@/app/api/users/preferences/route'
import { db, fakePrisma, req, FAMILY_A } from '@/__tests__/helpers/two-household'
import { isValidRequestId } from '@/lib/request-id'

const INBOUND_ID = 'support-case-0001'
// Private-looking content that must never reach a log line.
const SECRET_MESSAGE = 'Casey Fixture-A lives at 12 Elm Street, token=abc123'

function privateError(): Error {
  return Object.assign(new Error(SECRET_MESSAGE), { name: 'PrismaClientKnownRequestError', code: 'P2024' })
}

let errorSpy: jest.SpyInstance
function logged(): string {
  return errorSpy.mock.calls.map((args) => args.map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')).join('\n')
}

beforeEach(() => {
  db.reset()
  db.rows('family').find((f) => f.id === FAMILY_A)!.features = { meals: true, notes: true, inventory: true }
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  jest.restoreAllMocks()
})

describe('GET /api/search', () => {
  it('400 keeps error + code and adds the forwarded request id (body and header)', async () => {
    const res = await searchGET(req({ as: 'parentA', path: '/api/search', query: { q: 'x' }, headers: { 'x-request-id': INBOUND_ID } }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Type at least 2 characters to search.', code: 'QUERY_TOO_SHORT', requestId: INBOUND_ID })
    expect(res.headers.get('X-Request-Id')).toBe(INBOUND_ID)
  })

  it('generates a request id when none was forwarded', async () => {
    const res = await searchGET(req({ as: 'parentA', path: '/api/search', query: { q: 'x' } }))
    const body = await res.json()
    expect(isValidRequestId(body.requestId)).toBe(true)
    expect(res.headers.get('X-Request-Id')).toBe(body.requestId)
  })

  it('200 body is unchanged (results only)', async () => {
    const res = await searchGET(req({ as: 'parentA', path: '/api/search', query: { q: 'Fixture' } }))
    expect(res.status).toBe(200)
    expect(Object.keys(await res.json())).toEqual(['results'])
  })

  it('500 INTERNAL_ERROR logs only route, request id, error name and code — never the message or the query', async () => {
    jest.spyOn(fakePrisma.family, 'findUnique').mockRejectedValueOnce(privateError())
    const res = await searchGET(req({ as: 'parentA', path: '/api/search', query: { q: 'dentist appointment' }, headers: { 'x-request-id': INBOUND_ID } }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Search is not working right now. Try again.', code: 'INTERNAL_ERROR', requestId: INBOUND_ID })
    const line = logged()
    expect(line).toContain('route.error')
    expect(line).toContain('GET /api/search')
    expect(line).toContain(INBOUND_ID)
    expect(line).toContain('PrismaClientKnownRequestError')
    expect(line).toContain('P2024')
    for (const forbidden of ['Casey', 'Elm', 'abc123', 'dentist', 'parent-a', FAMILY_A]) expect(line).not.toContain(forbidden)
  })
})

describe('GET /api/audit', () => {
  it('400 INVALID_QUERY with the request id, status unchanged', async () => {
    const res = await auditGET(req({ as: 'parentA', path: '/api/audit', query: { limit: '999' }, headers: { 'x-request-id': INBOUND_ID } }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'INVALID_QUERY', requestId: INBOUND_ID })
    expect(typeof body.error).toBe('string')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('200 body is unchanged (entries + nextCursor)', async () => {
    const res = await auditGET(req({ as: 'parentA', path: '/api/audit' }))
    expect(res.status).toBe(200)
    expect(Object.keys(await res.json()).sort()).toEqual(['entries', 'nextCursor'])
  })

  it('500 INTERNAL_ERROR without leaking the exception', async () => {
    jest.spyOn(fakePrisma.auditLog, 'findMany').mockRejectedValue(privateError())
    const res = await auditGET(req({ as: 'parentA', path: '/api/audit', headers: { 'x-request-id': INBOUND_ID } }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Could not load recent changes', code: 'INTERNAL_ERROR', requestId: INBOUND_ID })
    expect(JSON.stringify(body)).not.toContain('Elm')
    expect(logged()).not.toContain('Elm')
    expect(logged()).toContain('GET /api/audit')
  })
})

describe('/api/users/preferences (nested envelope)', () => {
  it('400 keeps the nested shape and adds requestId inside it', async () => {
    const res = await prefsPATCH(
      req({ as: 'parentA', path: '/api/users/preferences', method: 'PATCH', body: { chores: 'off' }, headers: { 'x-request-id': INBOUND_ID } })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR', requestId: INBOUND_ID })
    expect(typeof body.error.message).toBe('string')
  })

  it('200 body is unchanged (preferences, plus quietHours added by #141)', async () => {
    const res = await prefsGET(req({ as: 'parentA', path: '/api/users/preferences' }))
    expect(res.status).toBe(200)
    expect(Object.keys(await res.json())).toEqual(['preferences', 'quietHours'])
  })

  it('500 INTERNAL_ERROR logs without the exception message', async () => {
    const original = fakePrisma.user.findUnique
    jest.spyOn(fakePrisma.user, 'findUnique').mockImplementation(async (args: any) => {
      if (args?.select && 'notify_chores' in args.select) throw privateError()
      return original(args)
    })
    const res = await prefsGET(req({ as: 'parentA', path: '/api/users/preferences', headers: { 'x-request-id': INBOUND_ID } }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: INBOUND_ID } })
    expect(logged()).toContain('GET /api/users/preferences')
    expect(logged()).not.toContain('Casey')
  })
})
