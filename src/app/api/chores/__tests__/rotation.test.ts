// Take turns (O-39) through the chore API: POST /api/chores/create and
// PATCH /api/chores accept `rotation` (2-8 distinct members of the caller's
// household, repeating chores only, parent-only), and GET /api/chores?id=
// returns the series' order. Two households: an id from the other household
// is refused like a missing one.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/rate-limit-db', () => require('@/__tests__/helpers/two-household').rateLimitMock)
jest.mock('@/lib/notifications-server', () => require('@/__tests__/helpers/two-household').notificationsMock)

import { POST as createChore } from '../create/route'
import { GET, PATCH } from '../route'
import { bodyOf, db, req } from '@/__tests__/helpers/two-household'

const S = 'parent-a'
const A = 'teen-a'
const J = 'child-a'

const body = (over: Record<string, unknown> = {}) => ({
  title: 'Dishes',
  points: 10,
  due_date: '2099-10-05',
  difficulty: 'easy',
  frequency: 'weekly',
  rotation: [J, A, S],
  ...over,
})

const create = (over: Record<string, unknown> = {}, as: 'parentA' | 'teenA' | 'childA' = 'parentA') =>
  createChore(req({ as, method: 'POST', path: '/api/chores/create', body: body(over) }))
const patch = (b: Record<string, unknown>, as: 'parentA' | 'teenA' | 'childA' = 'parentA') =>
  PATCH(req({ as, method: 'PATCH', path: '/api/chores', body: b }))
const getOne = (id: string, as: 'parentA' | 'parentB' = 'parentA') =>
  GET(req({ as, path: '/api/chores', query: { id } }))

const seriesOf = (templateId: string) =>
  db
    .rows('chore')
    .filter((c) => c.recurrence_id === templateId)
    .sort((a, b) => a.due_date.getTime() - b.due_date.getTime())

beforeEach(() => {
  db.reset()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('POST /api/chores/create with rotation', () => {
  it('the first person takes the first one, then the order carries on', async () => {
    const res = await create()
    expect(res.status).toBe(200)
    const { chore } = await bodyOf(res)
    expect(chore).toMatchObject({ assigned_to: J, rotation_member_ids: [J, A, S], rotation_index: 0 })
    expect(seriesOf(chore.id).map((c) => c.assigned_to)).toEqual([J, A, S, J])
  })

  it('ignores assigned_to when taking turns', async () => {
    const { chore } = await bodyOf(await create({ assigned_to: S }))
    expect(chore.assigned_to).toBe(J)
  })

  it('a member of another household is refused', async () => {
    const res = await create({ rotation: [J, 'child-b'] })
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toMatch(/in your family/)
    expect(db.rows('chore').some((c) => c.title === 'Dishes')).toBe(false)
  })

  it('an unknown id is refused the same way', async () => {
    expect((await create({ rotation: [J, 'nobody'] })).status).toBe(400)
  })

  it.each([
    ['one person', { rotation: [J] }],
    ['nine people', { rotation: Array.from({ length: 9 }, (_, i) => `u${i}`) }],
    ['the same person twice', { rotation: [J, J] }],
    ['a one-off chore', { frequency: 'once' }],
  ])('refuses %s', async (_label, over) => {
    const res = await create(over)
    expect(res.status).toBe(400)
  })

  it('without rotation, assigned_to is still required', async () => {
    expect((await create({ rotation: undefined })).status).toBe(400)
    expect((await create({ rotation: undefined, assigned_to: J })).status).toBe(200)
  })

  it('is parent-only, like any chore create', async () => {
    expect((await create({}, 'teenA')).status).toBe(403)
    expect((await create({}, 'childA')).status).toBe(403)
  })
})

describe('PATCH /api/chores rotation', () => {
  async function weeklyFor(assignee: string) {
    const { chore } = await bodyOf(await create({ rotation: undefined, assigned_to: assignee }))
    return chore.id as string
  }

  it('sets the order for the series, from a generated copy too', async () => {
    const id = await weeklyFor(S)
    const copy = seriesOf(id)[1]
    const res = await patch({ choreId: copy.id, rotation: [A, J] })
    expect(res.status).toBe(200)
    expect(db.find('chore', id)!.rotation_member_ids).toEqual([A, J])
    // Rows due after today and not started (here the whole series, which
    // starts in 2099) are re-planned from the first person.
    expect(seriesOf(id).map((c) => c.assigned_to)).toEqual([A, J, A, J])
  })

  it('null stops taking turns and leaves chores where they are', async () => {
    const { chore } = await bodyOf(await create())
    const before = seriesOf(chore.id).map((c) => c.assigned_to)
    expect((await patch({ choreId: chore.id, rotation: null })).status).toBe(200)
    expect(db.find('chore', chore.id)!.rotation_member_ids).toEqual([])
    expect(seriesOf(chore.id).map((c) => c.assigned_to)).toEqual(before)
  })

  it('a member of another household is refused and nothing changes', async () => {
    const id = await weeklyFor(S)
    const res = await patch({ choreId: id, rotation: [S, 'parent-b'] })
    expect(res.status).toBe(400)
    expect(db.find('chore', id)!.rotation_member_ids ?? []).toEqual([])
  })

  it('a one-off chore cannot take turns', async () => {
    const res = await patch({ choreId: 'chore-a', rotation: [S, J] })
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toMatch(/repeats/)
  })

  it('a one-off made weekly in the same edit can take turns', async () => {
    const res = await patch({ choreId: 'chore-a', frequency: 'weekly', rotation: [S, J] })
    expect(res.status).toBe(200)
    expect(db.find('chore', 'chore-a')!.rotation_member_ids).toEqual([S, J])
  })

  it('is parent-only, even for the chore’s own assignee', async () => {
    const { chore } = await bodyOf(await create())
    // The template is J's (child-a): the assignee may edit, but not the turns.
    const res = await patch({ choreId: chore.id, rotation: [J, S] }, 'childA')
    expect(res.status).toBe(403)
    expect(db.find('chore', chore.id)!.rotation_member_ids).toEqual([J, A, S])
  })

  it('another household cannot touch the series', async () => {
    const { chore } = await bodyOf(await create())
    const res = await PATCH(
      req({ as: 'parentB', method: 'PATCH', path: '/api/chores', body: { choreId: chore.id, rotation: null } })
    )
    expect([403, 404]).toContain(res.status)
    expect(db.find('chore', chore.id)!.rotation_member_ids).toEqual([J, A, S])
  })

  it('a hand reassign of one copy leaves the order alone', async () => {
    const { chore } = await bodyOf(await create())
    const copy = seriesOf(chore.id)[1]
    expect((await patch({ choreId: copy.id, assigned_to: S })).status).toBe(200)
    expect(db.find('chore', chore.id)!.rotation_member_ids).toEqual([J, A, S])
    expect(db.find('chore', copy.id)).toMatchObject({ assigned_to: S, rotation_index: 1 })
  })
})

describe('GET /api/chores?id= rotation', () => {
  it('returns the series order on the template and on a copy', async () => {
    const { chore } = await bodyOf(await create())
    expect((await bodyOf(await getOne(chore.id))).rotation).toEqual([J, A, S])
    const copy = seriesOf(chore.id)[2]
    const out = await bodyOf(await getOne(copy.id))
    expect(out.rotation).toEqual([J, A, S])
    expect(out.template).toMatchObject({ id: chore.id, frequency: 'weekly' })
  })

  it('null for a chore that does not take turns', async () => {
    expect((await bodyOf(await getOne('chore-a'))).rotation).toBeNull()
  })

  it('another household reads the chore as missing', async () => {
    const { chore } = await bodyOf(await create())
    expect((await getOne(chore.id, 'parentB')).status).toBe(404)
  })
})
