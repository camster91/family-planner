// POST /api/calendar/import-suggestions and its undo (#270): kill switch,
// feature gate, roles (parent and teen; child 403), paired-device refusal,
// text/image/PDF inputs, size/type checks, rate limits and the daily spend cap,
// provider failures, malformed output and refusals, two households, and that
// nothing is written or logged beyond content-minimal metadata. The provider
// HTTP call is always mocked: no test reaches the network.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
const mockGate = jest.fn(async (_familyId: string, _key: string): Promise<unknown> => null)
jest.mock('@/lib/feature-gate-server', () => ({
  featureGate: (familyId: string, key: string) => mockGate(familyId, key),
}))
// A real fixed-window counter per key, in memory, so limits can be exercised.
const mockCounts = new Map<string, number>()
const mockRateCalls: Array<{ key: string; max: number; windowMs: number }> = []
jest.mock('@/lib/rate-limit-db', () => ({
  checkRateLimit: async (key: string, max: number, windowMs: number) => {
    mockRateCalls.push({ key, max, windowMs })
    const n = (mockCounts.get(key) ?? 0) + 1
    mockCounts.set(key, n)
    return n > max ? { allowed: false, remaining: 0, retryAfterMs: 1_800_000 } : { allowed: true, remaining: max - n, retryAfterMs: 0 }
  },
}))

import { POST } from '../route'
import { POST as UNDO } from '../undo/route'
import { db, req, FOREIGN, USER_IDS, type UserKey } from '@/__tests__/helpers/two-household'
import { deviceReq, enableSharedDevice, disableSharedDevice, seedDevices } from '@/__tests__/helpers/device'
import {
  EVENT_IMPORT_ENDPOINT,
  EVENT_IMPORT_IMAGE_MAX_BYTES,
  EVENT_IMPORT_PDF_MAX_BYTES,
  EVENT_IMPORT_TEXT_MAX_CHARS,
} from '@/lib/event-import'

const KEY = 'sk-test-not-a-real-key'
const TODAY = new Date().toISOString().slice(0, 10)
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5])
const PDF = new Uint8Array(Buffer.from('%PDF-1.7\n1 0 obj << /Type /Page >>\n%%EOF'))
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0])
const GIF = new Uint8Array([...Buffer.from('GIF89a'), 1, 0, 1, 0])
const SVG = new Uint8Array(Buffer.from('<svg onload="alert(1)"></svg>'))
const FLYER = 'Picture day is next Friday! Bake sale Oct 9, 3:30-5pm in the gym.'

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const IN_4 = addDays(TODAY, 4)
const IN_11 = addDays(TODAY, 11)

function textReq(as: UserKey | null, body: unknown = { text: FLYER, today: TODAY, timeZone: 'America/Toronto' }, headers: Record<string, string> = {}) {
  const json = JSON.stringify(body)
  return req({
    as,
    method: 'POST',
    path: '/api/calendar/import-suggestions',
    body,
    headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(json)), ...headers },
  })
}

type Upload = { bytes?: Uint8Array; type?: string; field?: string; contentLength?: string | null; today?: string; timeZone?: string }

function fileReq(as: UserKey | null, upload: Upload = {}) {
  const bytes = upload.bytes ?? JPEG
  const form = new FormData()
  form.append(upload.field ?? 'file', new Blob([bytes as BlobPart], { type: upload.type ?? 'image/jpeg' }), 'flyer')
  form.append('today', upload.today ?? TODAY)
  if (upload.timeZone) form.append('timeZone', upload.timeZone)
  const headers: Record<string, string> = { 'content-type': 'multipart/form-data; boundary=----test' }
  const length = upload.contentLength === undefined ? String(bytes.length + 400) : upload.contentLength
  if (length !== null) headers['content-length'] = length
  return { ...req({ as, method: 'POST', path: '/api/calendar/import-suggestions', headers }), formData: async () => form }
}

function providerJson(output: unknown, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    body: null,
    json: async () => ({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }],
      ...extra,
    }),
  }
}

const GOOD = {
  status: 'ok',
  events: [
    { title: 'Bake sale', date: IN_11, start_time: '15:30', end_date: null, end_time: '17:00', all_day: false, location: 'Gym', notes: 'Bring $2', confidence: 0.92 },
    { title: 'Picture day', date: IN_4, start_time: null, end_date: null, end_time: null, all_day: true, location: null, notes: null, confidence: 0.8 },
  ],
}

let fetchMock: jest.Mock
const logs: string[] = []
const realFetch = global.fetch

beforeAll(() => {
  for (const level of ['log', 'warn', 'error', 'info'] as const) {
    jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    })
  }
})
afterAll(() => {
  global.fetch = realFetch
  delete process.env.EVENT_IMPORT_ANTHROPIC_API_KEY
  delete process.env.EVENT_IMPORT_MODEL
  delete process.env.EVENT_IMPORT_DAILY_LIMIT
})
beforeEach(() => {
  db.reset()
  mockGate.mockReset()
  mockGate.mockImplementation(async () => null)
  mockCounts.clear()
  mockRateCalls.length = 0
  logs.length = 0
  process.env.EVENT_IMPORT_ANTHROPIC_API_KEY = KEY
  delete process.env.EVENT_IMPORT_MODEL
  delete process.env.EVENT_IMPORT_DAILY_LIMIT
  fetchMock = jest.fn(async () => providerJson(GOOD))
  global.fetch = fetchMock as unknown as typeof fetch
})

async function errorCode(res: any): Promise<string | undefined> {
  const body = await res.json()
  return body?.error?.code
}

function sentBody(call = 0) {
  const [url, init] = fetchMock.mock.calls[call]
  return { url, init, body: JSON.parse(init.body) }
}

describe('POST /api/calendar/import-suggestions', () => {
  describe('success', () => {
    it('turns pasted text into cleaned suggestions in the household zone and writes nothing', async () => {
      const res = await POST(textReq('parentA'))
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      const body = await res.json()
      expect(body.unreadable).toBe(false)
      expect(body.timeZone).toBe('America/Toronto')
      expect(body.suggestions).toHaveLength(2)
      // Sorted by start: picture day first.
      expect(body.suggestions[0]).toEqual({
        title: 'Picture day', start: IN_4, end: null, allDay: true, location: null, notes: null, confidence: 0.8,
      })
      expect(body.suggestions[1]).toMatchObject({ title: 'Bake sale', allDay: false, location: 'Gym', notes: 'Bring $2' })
      expect(body.suggestions[1].start).toMatch(new RegExp(`^${IN_11}T15:30:00-0[45]:00$`))
      expect(body.suggestions[1].end).toMatch(new RegExp(`^${IN_11}T17:00:00-0[45]:00$`))
      expect(db.writes).toHaveLength(0)
    })

    it('calls only the fixed provider endpoint with the server key, model, schema, today and fenced text', async () => {
      process.env.EVENT_IMPORT_MODEL = 'claude-sonnet-5'
      await POST(textReq('teenA'))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const { url, init, body } = sentBody()
      expect(url).toBe(EVENT_IMPORT_ENDPOINT)
      expect(url).toBe('https://api.anthropic.com/v1/messages')
      expect(init.redirect).toBe('manual')
      expect(init.headers['x-api-key']).toBe(KEY)
      expect(init.headers['anthropic-version']).toBe('2023-06-01')
      expect(body.model).toBe('claude-sonnet-5')
      expect(body.output_config.format.type).toBe('json_schema')
      const [block] = body.messages[0].content
      expect(block.type).toBe('text')
      expect(block.text).toContain(`${TODAY}.`)
      expect(block.text).toContain(`<<<SOURCE\n${FLYER}\nSOURCE>>>`)
    })

    it('sends a photo as an image block using the sniffed type', async () => {
      const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3])
      const res = await POST(fileReq('parentA', { bytes: PNG, type: 'image/jpeg', timeZone: 'Europe/Lisbon' }))
      expect(res.status).toBe(200)
      expect((await res.json()).timeZone).toBe('Europe/Lisbon')
      const [image, text] = sentBody().body.messages[0].content
      expect(image).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(PNG).toString('base64') } })
      expect(text.text).toContain('Europe/Lisbon')
    })

    it('sends a PDF as a base64 document block (even when declared as an image)', async () => {
      const res = await POST(fileReq('parentA', { bytes: PDF, type: 'image/jpeg' }))
      expect(res.status).toBe(200)
      const [doc] = sentBody().body.messages[0].content
      expect(doc).toEqual({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(PDF).toString('base64') },
      })
    })
  })

  describe('kill switch, auth, feature and roles', () => {
    it('answers 404 and never calls the provider while no key is configured', async () => {
      delete process.env.EVENT_IMPORT_ANTHROPIC_API_KEY
      const res = await POST(textReq('parentA'))
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('EVENT_IMPORT_DISABLED')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(mockRateCalls).toHaveLength(0)
    })

    it('does not use the fridge scan key', async () => {
      delete process.env.EVENT_IMPORT_ANTHROPIC_API_KEY
      process.env.INVENTORY_SCAN_ANTHROPIC_API_KEY = 'sk-scan'
      try {
        expect((await POST(textReq('parentA'))).status).toBe(404)
      } finally {
        delete process.env.INVENTORY_SCAN_ANTHROPIC_API_KEY
      }
    })

    it('requires a session (401) before revealing whether the feature is configured', async () => {
      delete process.env.EVENT_IMPORT_ANTHROPIC_API_KEY
      expect((await POST(textReq(null))).status).toBe(401)
      process.env.EVENT_IMPORT_ANTHROPIC_API_KEY = KEY
      expect((await POST(textReq(null))).status).toBe(401)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('is refused when the household has the calendar feature off', async () => {
      mockGate.mockImplementation(async () => ({ status: 403, json: async () => ({ error: 'off' }), headers: new Headers() }))
      const res = await POST(textReq('parentA'))
      expect(res.status).toBe(403)
      expect(mockGate).toHaveBeenCalledWith('family-A', 'calendar')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('allows a teen', async () => {
      expect((await POST(textReq('teenA'))).status).toBe(200)
    })

    it('refuses a child before any rate-limit write or provider call', async () => {
      const res = await POST(textReq('childA'))
      expect(res.status).toBe(403)
      expect((await res.json()).error).toEqual({
        code: 'EVENT_IMPORT_FORBIDDEN',
        message: 'Ask a parent or teen to import events.',
        retryable: false,
      })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(mockRateCalls).toHaveLength(0)
    })

    it('refuses a paired shared device with 403 before person auth', async () => {
      enableSharedDevice()
      try {
        const fx = seedDevices()
        const csrf = 'c'.repeat(64)
        const res = await POST(
          deviceReq({
            method: 'POST',
            path: '/api/calendar/import-suggestions',
            cookies: { ...fx.d1.cookies, csrf_token: csrf },
            headers: { 'x-csrf-token': csrf },
            body: { text: FLYER },
          })
        )
        expect(res.status).toBe(403)
        expect(fetchMock).not.toHaveBeenCalled()
      } finally {
        disableSharedDevice()
      }
    })
  })

  describe('input checks', () => {
    it('requires Content-Length (411) and a known content type (415)', async () => {
      const noLength = textReq('parentA')
      noLength.headers.delete('content-length')
      expect((await POST(noLength)).status).toBe(411)
      const res = await POST(textReq('parentA', { text: FLYER }, { 'content-type': 'text/plain' }))
      expect(res.status).toBe(415)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects text over 20,000 characters with 413', async () => {
      const res = await POST(textReq('parentA', { text: 'a'.repeat(EVENT_IMPORT_TEXT_MAX_CHARS + 1) }))
      expect(res.status).toBe(413)
      expect(await errorCode(res)).toBe('TEXT_TOO_LONG')
      const huge = await POST(textReq('parentA', { text: FLYER }, { 'content-length': String(10 * 1024 * 1024) }))
      expect(huge.status).toBe(413)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects empty, missing or extra fields with 400', async () => {
      for (const body of [{ text: '   ' }, {}, { text: 5 }, { text: FLYER, family_id: 'family-B' }, [FLYER]]) {
        const res = await POST(textReq('parentA', body))
        expect(res.status).toBe(400)
        expect(await errorCode(res)).toBe('INVALID_BODY')
      }
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects a today far from the server date with 400', async () => {
      const res = await POST(textReq('parentA', { text: FLYER, today: addDays(TODAY, 5) }))
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('INVALID_TODAY')
      expect(mockRateCalls).toHaveLength(0)
    })

    it('rejects a declared multipart body over the limit before reading it', async () => {
      const r = fileReq('parentA', { contentLength: String(EVENT_IMPORT_PDF_MAX_BYTES + 128 * 1024) })
      const formData = jest.fn(r.formData)
      const res = await POST({ ...r, formData })
      expect(res.status).toBe(413)
      expect(await errorCode(res)).toBe('FILE_TOO_LARGE')
      expect(formData).not.toHaveBeenCalled()
    })

    it('limits photos to 8 MB and PDFs to 10 MB', async () => {
      const bigPhoto = new Uint8Array(EVENT_IMPORT_IMAGE_MAX_BYTES + 1)
      bigPhoto.set(JPEG)
      expect((await POST(fileReq('parentA', { bytes: bigPhoto }))).status).toBe(413)
      const bigPdf = new Uint8Array(EVENT_IMPORT_PDF_MAX_BYTES + 1)
      bigPdf.set(PDF)
      expect((await POST(fileReq('parentA', { bytes: bigPdf }))).status).toBe(413)
      // A 9 MB PDF is fine.
      const okPdf = new Uint8Array(9 * 1024 * 1024)
      okPdf.set(PDF)
      expect((await POST(fileReq('parentA', { bytes: okPdf }))).status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('refuses a PDF with too many visible pages', async () => {
      const pages = Buffer.from('%PDF-1.7\n' + '<< /Type /Page >>\n'.repeat(21))
      const res = await POST(fileReq('parentA', { bytes: new Uint8Array(pages), type: 'application/pdf' }))
      expect(res.status).toBe(413)
      expect(await errorCode(res)).toBe('PDF_TOO_MANY_PAGES')
    })

    it('requires the file field and a non-empty file', async () => {
      expect(await errorCode(await POST(fileReq('parentA', { field: 'image' })))).toBe('INVALID_BODY')
      expect(await errorCode(await POST(fileReq('parentA', { bytes: new Uint8Array(0) })))).toBe('INVALID_BODY')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each([
      ['HEIC', HEIC, 'image/heic'],
      ['GIF', GIF, 'image/gif'],
      ['SVG declared as PDF', SVG, 'application/pdf'],
    ])('rejects %s with 415 by magic bytes, without using quota', async (_label, bytes, type) => {
      const res = await POST(fileReq('parentA', { bytes, type }))
      expect(res.status).toBe(415)
      expect(await errorCode(res)).toBe('UNSUPPORTED_FILE_TYPE')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(mockRateCalls).toHaveLength(0)
    })
  })

  describe('rate limits and the daily spend cap', () => {
    it('limits one person to 10 imports an hour (429 with Retry-After)', async () => {
      for (let i = 0; i < 10; i++) expect((await POST(textReq('parentA'))).status).toBe(200)
      const res = await POST(textReq('parentA'))
      expect(res.status).toBe(429)
      expect(res.headers.get('Retry-After')).toBe('1800')
      expect(await errorCode(res)).toBe('RATE_LIMITED')
      expect(fetchMock).toHaveBeenCalledTimes(10)
    })

    it('limits a household to 20 imports an hour across members', async () => {
      process.env.EVENT_IMPORT_DAILY_LIMIT = '100'
      for (let i = 0; i < 10; i++) expect((await POST(textReq('parentA'))).status).toBe(200)
      for (let i = 0; i < 10; i++) expect((await POST(textReq('teenA'))).status).toBe(200)
      db.find('user', 'child-a')!.role = 'parent'
      const res = await POST(textReq('childA'))
      expect(res.status).toBe(429)
      expect(await errorCode(res)).toBe('RATE_LIMITED')
      expect(fetchMock).toHaveBeenCalledTimes(20)
    })

    it('enforces EVENT_IMPORT_DAILY_LIMIT per household per UTC day; another household is unaffected', async () => {
      process.env.EVENT_IMPORT_DAILY_LIMIT = '2'
      expect((await POST(textReq('parentA'))).status).toBe(200)
      expect((await POST(textReq('teenA'))).status).toBe(200)
      const res = await POST(textReq('parentA'))
      expect(res.status).toBe(429)
      expect(await errorCode(res)).toBe('IMPORT_DAILY_LIMIT')
      expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
      expect((await POST(textReq('parentB'))).status).toBe(200)
      const day = new Date().toISOString().slice(0, 10)
      const dailyKeys = mockRateCalls.filter((c) => c.key.startsWith('event-import:day:')).map((c) => c.key)
      expect(new Set(dailyKeys)).toEqual(new Set([`event-import:day:family-A:${day}`, `event-import:day:family-B:${day}`]))
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('a daily limit of 0 blocks every import without calling the provider', async () => {
      process.env.EVENT_IMPORT_DAILY_LIMIT = '0'
      const res = await POST(textReq('parentA'))
      expect(res.status).toBe(429)
      expect(await errorCode(res)).toBe('IMPORT_DAILY_LIMIT')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('provider failures and unreadable input', () => {
    it.each([401, 429, 500, 529])('maps an upstream %s to 502 IMPORT_PROVIDER_UNAVAILABLE without echoing the body', async (status) => {
      fetchMock.mockResolvedValue({
        ok: false,
        status,
        body: { cancel: async () => undefined },
        json: async () => ({ error: { message: `upstream detail ${KEY}` } }),
        text: async () => `upstream detail ${KEY}`,
      })
      const res = await POST(textReq('parentA'))
      expect(res.status).toBe(502)
      const body = await res.json()
      expect(body.error.code).toBe('IMPORT_PROVIDER_UNAVAILABLE')
      expect(body.error.retryable).toBe(true)
      expect(JSON.stringify(body)).not.toContain('upstream detail')
      expect(logs.join('\n')).not.toContain('upstream detail')
    })

    it('maps a network failure or timeout to 502', async () => {
      fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'))
      const res = await POST(textReq('parentA'))
      expect(res.status).toBe(502)
      expect(await errorCode(res)).toBe('IMPORT_PROVIDER_UNAVAILABLE')
    })

    it.each([
      ['non-JSON text', 'Sure! Picture day is on Friday.'],
      ['the wrong top-level shape', { items: [] }],
      ['events that is not an array', { status: 'ok', events: 'Picture day' }],
    ])('maps %s to 502 IMPORT_UNREADABLE', async (_label, output) => {
      fetchMock.mockResolvedValue(providerJson(output))
      const res = await POST(textReq('parentA'))
      expect(res.status).toBe(502)
      expect(await errorCode(res)).toBe('IMPORT_UNREADABLE')
      expect(db.writes).toHaveLength(0)
    })

    it('answers 200 unreadable for a refusal, an unreadable status or no usable dates', async () => {
      for (const reply of [
        providerJson('', { stop_reason: 'refusal', content: [] }),
        providerJson({ status: 'unreadable', events: [] }),
        providerJson({ status: 'ok', events: [{ ...GOOD.events[0], date: 'someday' }] }),
      ]) {
        fetchMock.mockResolvedValueOnce(reply)
        const res = await POST(fileReq('parentA'))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.suggestions).toEqual([])
        expect(body.unreadable).toBe(true)
      }
    })

    it('drops garbage events and cleans markup rather than failing', async () => {
      fetchMock.mockResolvedValue(
        providerJson({
          status: 'ok',
          events: [
            { ...GOOD.events[1], title: '<img src=x onerror=alert(1)>Picture day', location: '<b>Gym</b>' },
            { ...GOOD.events[1], title: '   ' },
            { title: 7, date: IN_4 },
          ],
        })
      )
      const body = await (await POST(textReq('parentA'))).json()
      expect(body.suggestions).toEqual([
        { title: 'img src=x onerror=alert(1) Picture day', start: IN_4, end: null, allDay: true, location: 'b Gym /b', notes: null, confidence: 0.8 },
      ])
      expect(body.dropped).toBe(2)
      expect(JSON.stringify(body)).not.toMatch(/[<>]/)
    })
  })

  it('logs only content-minimal metadata: no text, file bytes, key or titles', async () => {
    await POST(textReq('parentA'))
    await POST(fileReq('parentA'))
    fetchMock.mockResolvedValue(providerJson('not json: Bake sale'))
    await POST(textReq('parentA'))
    const text = logs.join('\n')
    expect(text).toContain('event.import')
    expect(text).not.toContain('Picture day')
    expect(text).not.toContain('Bake sale')
    expect(text).not.toContain('Gym')
    expect(text).not.toContain(Buffer.from(JPEG).toString('base64'))
    expect(text).not.toContain(KEY)
  })

  it('two households: an import never returns or reads the other household', async () => {
    const res = await POST(textReq('parentB'))
    expect(res.status).toBe(200)
    expect(JSON.stringify(await res.json())).not.toContain(FOREIGN)
    expect(mockGate).toHaveBeenCalledWith('family-B', 'calendar')
    const keys = mockRateCalls.map((c) => c.key)
    expect(keys.every((k) => !k.includes('family-A') && !k.includes('parent-a'))).toBe(true)
    expect(db.writes).toHaveLength(0)
  })
})

describe('POST /api/calendar/import-suggestions/undo', () => {
  function seedEvent(id: string, family: 'A' | 'B', createdBy: string, ageMs = 60_000, extra: Record<string, unknown> = {}) {
    db.rows('event').push({
      id,
      family_id: `family-${family}`,
      title: `Imported ${id}`,
      description: null,
      start_time: new Date(),
      end_time: new Date(),
      location: null,
      event_type: 'other',
      recurrence: null,
      created_by: createdBy,
      project_id: null,
      is_task: false,
      created_at: new Date(Date.now() - ageMs),
      source_subscription_id: null,
      source_connection_id: null,
      ...extra,
    })
  }
  const undoReq = (as: UserKey | null, body: unknown) =>
    req({ as, method: 'POST', path: '/api/calendar/import-suggestions/undo', body })
  const ids = () => db.rows('event').map((r) => r.id as string)

  it('deletes exactly the caller’s just-added events and is safe to repeat', async () => {
    seedEvent('imp-1', 'A', USER_IDS.parentA)
    seedEvent('imp-2', 'A', USER_IDS.parentA)
    seedEvent('keep', 'A', USER_IDS.parentA)
    const res = await UNDO(undoReq('parentA', { eventIds: ['imp-1', 'imp-2', 'imp-1'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ removedCount: 2 })
    expect(ids()).toEqual(expect.arrayContaining(['keep', 'event-a', 'event-b']))
    expect(ids()).not.toEqual(expect.arrayContaining(['imp-1']))
    const again = await UNDO(undoReq('parentA', { eventIds: ['imp-1', 'imp-2'] }))
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ removedCount: 0 })
  })

  it('works without the provider key (undo never calls the provider)', async () => {
    delete process.env.EVENT_IMPORT_ANTHROPIC_API_KEY
    seedEvent('imp-1', 'A', USER_IDS.teenA)
    const res = await UNDO(undoReq('teenA', { eventIds: ['imp-1'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ removedCount: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses another member’s event (403) and deletes nothing', async () => {
    seedEvent('mine', 'A', USER_IDS.teenA)
    seedEvent('theirs', 'A', USER_IDS.parentA)
    const res = await UNDO(undoReq('teenA', { eventIds: ['mine', 'theirs'] }))
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('UNDO_NOT_ALLOWED')
    expect(ids()).toEqual(expect.arrayContaining(['mine', 'theirs']))
  })

  it('refuses events from a subscribed or connected calendar', async () => {
    seedEvent('ics', 'A', USER_IDS.parentA, 60_000, { source_subscription_id: 'sub-1' })
    expect((await UNDO(undoReq('parentA', { eventIds: ['ics'] }))).status).toBe(403)
  })

  it('refuses after 10 minutes (409)', async () => {
    seedEvent('old', 'A', USER_IDS.parentA, 11 * 60_000)
    const res = await UNDO(undoReq('parentA', { eventIds: ['old'] }))
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('UNDO_WINDOW_EXPIRED')
    expect(ids()).toContain('old')
  })

  it('two households: another household’s id is skipped like a missing one', async () => {
    seedEvent('foreign', 'B', USER_IDS.parentB)
    const res = await UNDO(undoReq('parentA', { eventIds: ['foreign', 'event-b', 'missing'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ removedCount: 0 })
    expect(ids()).toEqual(expect.arrayContaining(['foreign', 'event-b']))
  })

  it('refuses a child, a bad body and a paired device', async () => {
    seedEvent('c', 'A', USER_IDS.childA)
    expect((await UNDO(undoReq('childA', { eventIds: ['c'] }))).status).toBe(403)
    expect((await UNDO(undoReq('parentA', { eventIds: [] }))).status).toBe(400)
    expect((await UNDO(undoReq('parentA', { eventIds: ['x'], family_id: 'family-B' }))).status).toBe(400)
    expect((await UNDO(undoReq(null, { eventIds: ['c'] }))).status).toBe(401)
    enableSharedDevice()
    try {
      const fx = seedDevices()
      const csrf = 'c'.repeat(64)
      const res = await UNDO(
        deviceReq({
          method: 'POST',
          path: '/api/calendar/import-suggestions/undo',
          cookies: { ...fx.d1.cookies, csrf_token: csrf },
          headers: { 'x-csrf-token': csrf },
          body: { eventIds: ['c'] },
        })
      )
      expect(res.status).toBe(403)
    } finally {
      disableSharedDevice()
    }
    expect(ids()).toContain('c')
  })
})
