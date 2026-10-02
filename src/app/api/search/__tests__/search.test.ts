// GET /api/search (route inventory F-3, #101 D-2): two households, roles,
// per-feature exclusion, validation, limits and the shared-device refusal.
// The fake Prisma evaluates every `where`, so a query that forgot the
// household would return family B's FOREIGN rows here.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import { GET } from '../route'
import { SEARCH_MAX_RESULTS, SEARCH_PER_TYPE } from '@/lib/household-search'
import { db, req, expectNoForeignData, FAMILY_A, FAMILY_B, FOREIGN, type UserKey } from '@/__tests__/helpers/two-household'
import { deviceReq, enableSharedDevice, disableSharedDevice, seedDevices } from '@/__tests__/helpers/device'

const ALL_ON = { meals: true, notes: true, inventory: true }

function setFeatures(familyId: string, features: Record<string, boolean> | null) {
  db.rows('family').find((f) => f.id === familyId)!.features = features
}

function search(as: UserKey | null, q?: string) {
  return GET(req({ as, path: '/api/search', query: q === undefined ? {} : { q } }))
}

async function results(as: UserKey, q: string) {
  const res = await search(as, q)
  expect(res.status).toBe(200)
  const body = await expectNoForeignData(res)
  return body.results as Array<{ type: string; id: string; title: string; subtitle?: string; href: string; date?: string }>
}

const types = (rows: Array<{ type: string }>) => Array.from(new Set(rows.map((r) => r.type)))

describe('GET /api/search', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    setFeatures(FAMILY_A, ALL_ON)
    setFeatures(FAMILY_B, ALL_ON)
  })

  it('401 without a session and 400 without a household, reading nothing', async () => {
    expect((await search(null, 'home')).status).toBe(401)
    const loner = await search('loner', 'home')
    expect(loner.status).toBe(400)
    expect(db.writes).toHaveLength(0)
  })

  it('a parent finds every canonical type in their own household, with links', async () => {
    const rows = await results('parentA', 'home')
    expect(types(rows)).toEqual(['event', 'chore', 'list', 'list_item', 'recipe', 'note', 'inventory'])
    const byType = Object.fromEntries(rows.map((r) => [r.type, r]))
    expect(byType.event).toMatchObject({ id: 'event-a', title: 'Home dentist', subtitle: 'Home clinic' })
    expect(byType.event.href).toMatch(/^\/dashboard\/calendar\?year=\d{4}&month=\d{1,2}$/)
    expect(byType.event.date).toEqual(expect.any(String))
    expect(byType.chore).toMatchObject({ id: 'chore-a', title: 'Home dishes', subtitle: 'For Child A · To do', href: '/dashboard/chores' })
    expect(byType.list).toMatchObject({ id: 'list-a', title: 'Home groceries', subtitle: 'Shopping list', href: '/dashboard/lists/list-a' })
    expect(byType.list_item).toMatchObject({ id: 'item-a', title: 'Home milk', subtitle: 'On Home groceries', href: '/dashboard/lists/list-a' })
    expect(byType.recipe).toMatchObject({ id: 'recipe-a', title: 'Home lasagne', href: '/dashboard/meals/recipes/recipe-a' })
    expect(byType.note).toMatchObject({ id: 'note-a', title: 'Home wifi', href: '/dashboard/notes' })
    expect(byType.inventory).toMatchObject({ id: 'inv-a', title: 'Home Tomato', subtitle: 'In the fridge', href: '/dashboard/inventory' })
    for (const r of rows) {
      expect(Object.keys(r).every((k) => ['type', 'id', 'title', 'subtitle', 'href', 'date'].includes(k))).toBe(true)
    }
    expect(db.writes).toHaveLength(0)
  })

  it('finds members by name, case-insensitively, with a role word and never an email', async () => {
    const rows = await results('parentA', 'TEEN')
    expect(rows).toEqual([{ type: 'member', id: 'teen-a', title: 'Teen A', subtitle: 'Teen', href: '/dashboard/family' }])
    expect(JSON.stringify(rows)).not.toContain('@example.test')
  })

  it("never returns another household's rows (two-household isolation)", async () => {
    // Every family-B row carries FOREIGN; family A has none.
    expect(await results('parentA', 'foreign')).toEqual([])
    expect(await results('teenA', 'foreign')).toEqual([])
    const b = await search('parentB', 'home')
    expect(b.status).toBe(200)
    expect((await b.json()).results).toEqual([])
    // Family B finds only its own rows.
    const own = await search('parentB', FOREIGN)
    const ownRows = (await own.json()).results as Array<{ id: string }>
    expect(ownRows.length).toBeGreaterThan(0)
    expect(ownRows.every((r) => !r.id.endsWith('-a') && r.id !== 'parent-a')).toBe(true)
  })

  it('matches a note body without ever returning the body', async () => {
    const rows = await results('parentA', 'password')
    expect(rows).toEqual([{ type: 'note', id: 'note-a', title: 'Home wifi', subtitle: 'Note', href: '/dashboard/notes' }])
    expect(JSON.stringify(rows)).not.toContain('Home password')
  })

  it('leaves out used-up and thrown-away food', async () => {
    db.rows('inventoryItem').push(
      { id: 'inv-used', family_id: FAMILY_A, name: 'Home Old Bread', status: 'consumed', location: 'pantry', created_at: new Date(), updated_at: new Date() },
      { id: 'inv-binned', family_id: FAMILY_A, name: 'Home Old Milk', status: 'discarded', location: 'fridge', created_at: new Date(), updated_at: new Date() }
    )
    const rows = await results('parentA', 'home old')
    expect(rows).toEqual([])
  })

  it('childA gets only lists, list items and food: the pages a child may open', async () => {
    const rows = await results('childA', 'home')
    expect(types(rows)).toEqual(['list', 'list_item', 'inventory'])
    for (const r of rows) expect(r.href).toMatch(/^\/dashboard\/(lists|inventory)(\/|$)/)
    // No members, events, chores, recipes or notes, even by a direct call.
    expect(await results('childA', 'parent')).toEqual([])
    expect(await results('childA', 'dentist')).toEqual([])
    expect(await results('childA', 'lasagne')).toEqual([])
    expect(await results('childA', 'wifi')).toEqual([])
  })

  it('teenA also gets events and recipes (O-37: a teen may open the calendar and meals), never members, chores or notes', async () => {
    const rows = await results('teenA', 'home')
    expect(types(rows)).toEqual(['event', 'list', 'list_item', 'recipe', 'inventory'])
    for (const r of rows) expect(r.href).toMatch(/^\/dashboard\/(lists|inventory|calendar|meals\/recipes)(\/|\?|$)/)
    expect(await results('teenA', 'parent')).toEqual([])
    expect(await results('teenA', 'wifi')).toEqual([])
  })

  it('never returns budget, messages, medical, locations, handoff or allowance data', async () => {
    // Seeded family-A rows: "Home groceries" budget category, "Home shop"
    // transaction, "Home hello" message, "Home cough", "Home syrup",
    // "Home peanuts", "1 Home Street", "Home sitter", "Home weekly".
    for (const q of ['shop', 'hello', 'cough', 'syrup', 'peanuts', 'street', 'sitter', 'weekly', 'garage', 'ice cream', 'bike']) {
      expect(await results('parentA', q)).toEqual([])
    }
  })

  it('leaves out a type while its feature is off', async () => {
    setFeatures(FAMILY_A, { meals: false, notes: false, inventory: false })
    expect(types(await results('parentA', 'home'))).toEqual(['event', 'chore', 'list', 'list_item'])
    expect(types(await results('teenA', 'home'))).toEqual(['event', 'list', 'list_item'])
    expect(types(await results('childA', 'home'))).toEqual(['list', 'list_item'])
    // Lists is core, but a stored `lists: false` is still honoured.
    setFeatures(FAMILY_A, { ...ALL_ON, lists: false })
    expect(types(await results('parentA', 'home'))).toEqual(['event', 'chore', 'recipe', 'note', 'inventory'])
    // Inventory is off by default for a household with no stored flags.
    setFeatures(FAMILY_A, null)
    expect(types(await results('parentA', 'home'))).not.toContain('inventory')
  })

  it('validates the query: 2 to 100 characters after trimming', async () => {
    for (const q of [undefined, '', ' ', 'a', '  a  ']) {
      const res = await search('parentA', q)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('QUERY_TOO_SHORT')
    }
    const long = await search('parentA', 'x'.repeat(101))
    expect(long.status).toBe(400)
    expect((await long.json()).code).toBe('QUERY_TOO_LONG')
    expect((await search('parentA', 'x'.repeat(100))).status).toBe(200)
    // Surrounding and repeated spaces do not count.
    expect((await search('parentA', `  ${'x'.repeat(100)}  `)).status).toBe(200)
    expect(types(await results('parentA', '  home    dishes '))).toEqual(['chore'])
  })

  it(`returns at most ${SEARCH_PER_TYPE} per type and ${SEARCH_MAX_RESULTS} in all, in a stable order`, async () => {
    const t = new Date('2026-09-01T00:00:00Z')
    for (let i = 0; i < 8; i++) {
      db.rows('list').push({ id: `list-z${i}`, family_id: FAMILY_A, name: 'Home extra', type: 'todo', description: null, created_by: 'parent-a', created_at: t, updated_at: t })
    }
    const first = await results('parentA', 'home')
    const second = await results('parentA', 'home')
    expect(second).toEqual(first)
    expect(first.length).toBeLessThanOrEqual(SEARCH_MAX_RESULTS)
    const lists = first.filter((r) => r.type === 'list')
    expect(lists).toHaveLength(SEARCH_PER_TYPE)
    // Name, then id: equal names keep one order.
    expect(lists.map((r) => r.id)).toEqual(['list-z0', 'list-z1', 'list-z2', 'list-z3', 'list-z4'])
  })

  it('refuses a paired shared device with 403 before person auth, even with a parent session beside it', async () => {
    enableSharedDevice()
    try {
      const fx = seedDevices()
      for (const as of [null, 'parentA'] as const) {
        const res = await GET(deviceReq({ as, path: '/api/search', query: { q: 'home' }, cookies: fx.d1.cookies }))
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.error.code).toBe('DEVICE_WRITE_NOT_ALLOWED')
        expect(JSON.stringify(body)).not.toContain('Home')
      }
    } finally {
      disableSharedDevice()
    }
  })
})
