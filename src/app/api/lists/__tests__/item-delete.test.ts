// DELETE /api/lists/items/[id] and the deprecated DELETE /api/lists/items/delete
// (route inventory F-6, #289): two households, one shared helper, same answers.
// Also: GET /api/lists/items carries a Deprecation header (F-5).

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

const mockGate = jest.fn(async (..._args: unknown[]): Promise<unknown> => null)
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: (...args: unknown[]) => mockGate(...args) }))

jest.mock('@/lib/list-item-delete', () => {
  const actual = jest.requireActual('@/lib/list-item-delete')
  return { deleteHouseholdListItem: jest.fn(actual.deleteHouseholdListItem) }
})

import { DELETE as deleteRest } from '../items/[id]/route'
import { DELETE as deleteLegacy } from '../items/delete/route'
import { GET as getItems } from '../items/route'
import { deleteHouseholdListItem } from '@/lib/list-item-delete'
import { DEPRECATED_SINCE_289 } from '@/lib/deprecation'
import {
  db,
  req,
  params,
  bodyOf,
  writesTo,
  expectNoForeignData,
  nextServerMock,
  type UserKey,
} from '@/__tests__/helpers/two-household'

const rest = (as: UserKey | null, id: string) =>
  deleteRest(req({ as, method: 'DELETE', path: `/api/lists/items/${id}` }), params({ id }))
const legacy = (as: UserKey | null, itemId: string) =>
  deleteLegacy(req({ as, method: 'DELETE', path: '/api/lists/items/delete', query: { itemId } }))

const helper = deleteHouseholdListItem as jest.Mock

beforeEach(() => {
  db.reset()
  helper.mockClear()
  mockGate.mockReset()
  mockGate.mockResolvedValue(null)
})

describe('DELETE /api/lists/items/[id] — two households', () => {
  it('401 without a session, and writes nothing', async () => {
    expect((await rest(null, 'item-a')).status).toBe(401)
    expect(db.writes).toHaveLength(0)
  })

  it("another household's item is the same 404 as a missing one, and nothing is deleted", async () => {
    const foreign = await rest('parentA', 'item-b')
    const missing = await rest('parentA', 'no-such-item')
    expect(foreign.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await bodyOf(foreign)).toEqual(await bodyOf(missing))
    await expectNoForeignData(foreign)
    expect(db.writes).toHaveLength(0)
    expect(db.find('listItem', 'item-b')).toBeTruthy()
  })

  it.each<[UserKey]>([['teenA'], ['childA']])('%s gets 403 (item delete stays parent-only)', async (who) => {
    expect((await rest(who, 'item-a')).status).toBe(403)
    expect(db.writes).toHaveLength(0)
  })

  it('lists off: the feature gate answers and nothing is deleted', async () => {
    mockGate.mockResolvedValue(nextServerMock.NextResponse.json({ error: 'Lists is off' }, { status: 403 }))
    expect((await rest('parentA', 'item-a')).status).toBe(403)
    expect(mockGate).toHaveBeenCalledWith('family-A', 'lists')
    expect(db.writes).toHaveLength(0)
  })

  it("a parent deletes their household's item through the shared helper", async () => {
    const res = await rest('parentA', 'item-a')
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toEqual({ success: true })
    expect(helper).toHaveBeenCalledWith(expect.anything(), 'item-a', 'family-A')
    expect(db.find('listItem', 'item-a')).toBeFalsy()
    expect(db.find('listItem', 'item-b')).toBeTruthy()
    expect(writesTo('listItem').map((w) => w.args.where)).toEqual([{ id: 'item-a' }])
    // A repeat is a plain 404: the row is gone.
    expect((await rest('parentA', 'item-a')).status).toBe(404)
  })

  it('never carries a Deprecation header', async () => {
    const res = await rest('parentA', 'item-a')
    expect(res.headers.get('Deprecation')).toBeNull()
  })
})

describe('DELETE /api/lists/items/delete (deprecated, kept for installed Android builds)', () => {
  it('answers exactly like the REST route, through the same helper', async () => {
    const cases: [UserKey | null, string][] = [
      [null, 'item-a'],
      ['teenA', 'item-a'],
      ['childA', 'item-a'],
      ['parentA', 'item-b'],
      ['parentA', 'no-such-item'],
    ]
    for (const [who, id] of cases) {
      db.reset()
      const a = await rest(who, id)
      db.reset()
      const b = await legacy(who, id)
      expect([who, id, b.status, await bodyOf(b)]).toEqual([who, id, a.status, await bodyOf(a)])
    }
    db.reset()
    helper.mockClear()
    const ok = await legacy('parentA', 'item-a')
    expect(ok.status).toBe(200)
    expect(await bodyOf(ok)).toEqual({ success: true })
    expect(helper).toHaveBeenCalledTimes(1)
    expect(helper).toHaveBeenCalledWith(expect.anything(), 'item-a', 'family-A')
    expect(db.find('listItem', 'item-a')).toBeFalsy()
  })

  it('still needs itemId (400)', async () => {
    const res = await deleteLegacy(req({ as: 'parentA', method: 'DELETE', path: '/api/lists/items/delete' }))
    expect(res.status).toBe(400)
    expect(res.headers.get('Deprecation')).toBe(`@${DEPRECATED_SINCE_289}`)
  })

  it('marks every response deprecated and links the REST route', async () => {
    for (const res of [await legacy(null, 'item-a'), await legacy('parentA', 'item-b'), await legacy('parentA', 'item-a')]) {
      expect(res.headers.get('Deprecation')).toBe(`@${DEPRECATED_SINCE_289}`)
      expect(res.headers.get('Link')).toMatch(/^<\/api\/lists\/items\/item-[ab]>; rel="successor-version"$/)
      expect(res.headers.get('Sunset')).toBeNull()
    }
  })
})

describe('GET /api/lists/items (deprecated read, F-5)', () => {
  it('still returns the household list items, with a Deprecation header and no Sunset', async () => {
    const res = await getItems(req({ as: 'childA', query: { listId: 'list-a' } }))
    expect(res.status).toBe(200)
    const body = await expectNoForeignData(res)
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['item-a'])
    expect(res.headers.get('Deprecation')).toBe(`@${DEPRECATED_SINCE_289}`)
    expect(res.headers.get('Sunset')).toBeNull()
  })

  it('refusals are marked too and leak nothing', async () => {
    for (const res of [
      await getItems(req({ query: { listId: 'list-a' } })),
      await getItems(req({ as: 'parentA', query: { listId: 'list-b' } })),
    ]) {
      expect([401, 403, 404]).toContain(res.status)
      await expectNoForeignData(res)
      expect(res.headers.get('Deprecation')).toBe(`@${DEPRECATED_SINCE_289}`)
    }
  })

  it('the deprecation date is 2026-09-29 UTC', () => {
    expect(new Date(DEPRECATED_SINCE_289 * 1000).toISOString()).toBe('2026-09-29T00:00:00.000Z')
  })
})
