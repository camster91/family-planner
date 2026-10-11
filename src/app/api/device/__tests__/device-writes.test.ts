// Shared-tablet writes (#274, SHARED_DEVICE.md §9.2, §12.3, §14.2 items 6–7)
// and board setup under elevation (§6.4), on the two-household harness:
// family-A is H1 (tablets D1, D1b), family-B is H2 (tablet D2). Every H2 text
// carries FOREIGN.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import { FOREIGN, fakePrisma, writesTo } from '@/__tests__/helpers/two-household'
import {
  D1,
  D1B,
  FAMILY_A,
  FAMILY_B,
  advance,
  clearsDeviceCookies,
  db,
  deviceReq,
  disableSharedDevice,
  enableSharedDevice,
  errorCode,
  resetClock,
  seedDevices,
  setNow,
  setPassword,
  setPin,
} from '@/__tests__/helpers/device'
import { idempotencyRuntime } from '@/lib/idempotency'
import * as elevation from '../elevation/route'
import * as parentRevoke from '../../family/devices/[id]/revoke/route'
import * as tick from '../lists/items/[id]/route'
import * as add from '../lists/[id]/items/route'
import * as complete from '../chores/[id]/complete/route'
import * as undo from '../chores/[id]/uncomplete/route'
import * as settings from '../elevated/board-settings/route'
import * as places from '../elevated/board-settings/places/route'
import * as completionEngine from '@/lib/chore-complete'
import * as memberSubjects from '@/lib/chore-member-subject'
import { HouseholdMemberIdentityConflict } from '@/lib/household-member-lifecycle'

const T0 = new Date('2026-09-26T12:00:00Z')
const TODAY = new Date('2026-09-26T00:00:00Z')
const PIN = '482913'
let seq = 0
const key = () => `k-274-${String(++seq).padStart(4, '0')}-abcdefghijkl`

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function family(id: string) {
  return db.find('family', id)!
}

function allowWrites(familyId = FAMILY_A, on = true) {
  family(familyId).device_writes_enabled = on
}

function addChore(id: string, familyId: string, due: Date, extra: Record<string, unknown> = {}) {
  const f = familyId === FAMILY_A ? 'a' : 'b'
  db.rows('chore').push({
    id,
    family_id: familyId,
    title: familyId === FAMILY_A ? `Home ${id}` : `${FOREIGN} ${id}`,
    description: null,
    points: 10,
    assigned_to: `child-${f}`,
    due_date: due,
    status: 'pending',
    frequency: 'once',
    difficulty: 'easy',
    created_by: `parent-${f}`,
    photo_url: null,
    recurrence_id: null,
    completed_at: null,
    created_at: T0,
    icon: null,
    routine: null,
    routine_order: null,
    ...extra,
  })
}

function audits(type = 'device.member_action') {
  return db.rows('deviceAuditEvent').filter((e) => e.type === type)
}

describe('shared-tablet writes (#274)', () => {
  let fx: ReturnType<typeof seedDevices>

  beforeAll(() => {
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    enableSharedDevice()
    setNow(T0)
    idempotencyRuntime.now = () => new Date()
    idempotencyRuntime.random = () => 0.99
    fx = seedDevices()
    addChore('chore-today-a', FAMILY_A, TODAY)
    addChore('chore-old-a', FAMILY_A, new Date('2026-09-20T00:00:00Z'))
    addChore('chore-today-b', FAMILY_B, TODAY)
  })
  afterAll(() => {
    disableSharedDevice()
    resetClock()
  })

  function tickReq(body: unknown, opts: { cookies?: Record<string, string>; k?: string | null } = {}) {
    const headers: Record<string, string> = {}
    if (opts.k !== null) headers['Idempotency-Key'] = opts.k ?? key()
    return deviceReq({ method: 'PATCH', cookies: opts.cookies ?? fx.d1.cookies, headers, body })
  }
  function postReq(body: unknown, opts: { cookies?: Record<string, string>; k?: string | null } = {}) {
    const headers: Record<string, string> = {}
    if (opts.k !== null) headers['Idempotency-Key'] = opts.k ?? key()
    return deviceReq({ method: 'POST', cookies: opts.cookies ?? fx.d1.cookies, headers, body })
  }

  describe('the gate every write passes', () => {
    it('household opt-in defaults off: 403 DEVICE_WRITES_OFF and nothing changes', async () => {
      for (const res of [
        await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }), params('item-a')),
        await add.POST(postReq({ content: 'Eggs', actingMemberId: 'child-a' }), params('list-a')),
        await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a')),
        await undo.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a')),
      ]) {
        expect(res.status).toBe(403)
        expect(await errorCode(res)).toBe('DEVICE_WRITES_OFF')
        expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      }
      expect(db.find('listItem', 'item-a')!.checked).toBe(false)
      expect(db.find('chore', 'chore-today-a')!.status).toBe('pending')
      expect(audits()).toHaveLength(0)
    })

    it("one household's opt-in does not open another household's tablet", async () => {
      allowWrites(FAMILY_B)
      const res = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }), params('item-a'))
      expect(await errorCode(res)).toBe('DEVICE_WRITES_OFF')
    })

    it('kill switch off: 404 and the device cookies expire, with nothing written', async () => {
      allowWrites()
      disableSharedDevice()
      for (const res of [
        await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }), params('item-a')),
        await add.POST(postReq({ content: 'Eggs', actingMemberId: 'child-a' }), params('list-a')),
        await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a')),
        await undo.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a')),
      ]) {
        expect(res.status).toBe(404)
        expect(clearsDeviceCookies(res)).toBe(true)
      }
      expect(db.writes).toEqual([])
    })

    it('a person session is not a device (401) even with the opt-in on', async () => {
      allowWrites()
      const res = await tick.PATCH(
        deviceReq({ method: 'PATCH', as: 'parentA', headers: { 'Idempotency-Key': key() }, body: { checked: true, actingMemberId: 'parent-a' } }),
        params('item-a')
      )
      expect(res.status).toBe(401)
      expect(db.find('listItem', 'item-a')!.checked).toBe(false)
    })

    it('a revoked tablet is refused (401 DEVICE_REVOKED) and its sibling keeps working', async () => {
      allowWrites()
      setPassword('parentA', 'parent-a-password')
      const revoked = await parentRevoke.POST(
        deviceReq({ method: 'POST', as: 'parentA', body: { reason: 'lost' } }),
        params(D1)
      )
      expect(revoked.status).toBe(200)
      const res = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }), params('item-a'))
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('DEVICE_REVOKED')
      expect(db.find('listItem', 'item-a')!.checked).toBe(false)
      const sibling = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }, { cookies: fx.d1b.cookies }), params('item-a'))
      expect(sibling.status).toBe(200)
    })

    it('requires an Idempotency-Key (400), and a well-formed one', async () => {
      allowWrites()
      const missing = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }, { k: null }), params('item-a'))
      expect(missing.status).toBe(400)
      expect(await errorCode(missing)).toBe('IDEMPOTENCY_KEY_REQUIRED')
      const bad = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }, { k: 'bad key' }), params('item-a'))
      expect(await errorCode(bad)).toBe('IDEMPOTENCY_KEY_INVALID')
      expect(db.find('listItem', 'item-a')!.checked).toBe(false)
    })

    it('a foreign or unknown actingMemberId is the same 400 and nothing changes (O-5)', async () => {
      allowWrites()
      for (const actingMemberId of ['parent-b', 'child-b', 'nobody', 'loner', undefined, 7]) {
        for (const res of [
          await tick.PATCH(tickReq({ checked: true, actingMemberId }), params('item-a')),
          await complete.POST(postReq({ actingMemberId }), params('chore-today-a')),
          await add.POST(postReq({ content: 'Eggs', actingMemberId }), params('list-a')),
        ]) {
          expect(res.status).toBe(400)
          expect(await errorCode(res)).toBe('ACTING_MEMBER_INVALID')
        }
      }
      expect(db.find('listItem', 'item-a')!.checked).toBe(false)
      expect(db.find('chore', 'chore-today-a')!.status).toBe('pending')
      expect(writesTo('listItem')).toHaveLength(0)
      expect(audits()).toHaveLength(0)
    })

    it('rate limited per tablet (429 with Retry-After)', async () => {
      allowWrites()
      db.rows('rateLimitEntry').push({
        id: 'rl-write',
        key: `device-write:${D1}`,
        count: 300,
        windowStart: new Date(),
        resetAt: new Date(Date.now() + 10 * 60 * 1000),
      })
      const res = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }), params('item-a'))
      expect(res.status).toBe(429)
      expect(res.headers.get('Retry-After')).toBeTruthy()
      expect(db.find('listItem', 'item-a')!.checked).toBe(false)
      // Per tablet: D1b is not limited by D1's count.
      const sibling = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }, { cookies: fx.d1b.cookies }), params('item-a'))
      expect(sibling.status).toBe(200)
    })
  })

  describe('PATCH /api/device/lists/items/:id (grocery tick/untick)', () => {
    beforeEach(() => allowWrites())

    it('ticks as the picked member, answers only { id, checked }, and audits the device and member', async () => {
      const res = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }), params('item-a'))
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      expect(await res.json()).toEqual({ item: { id: 'item-a', checked: true } })
      expect(db.find('listItem', 'item-a')).toMatchObject({ checked: true, checked_by: 'child-a' })
      expect(audits()).toEqual([
        expect.objectContaining({
          family_id: FAMILY_A,
          device_id: D1,
          actor_user_id: 'child-a',
          metadata: { action: 'list_item_check', targetType: 'list_item', targetId: 'item-a' },
        }),
      ])

      const back = await tick.PATCH(tickReq({ checked: false, actingMemberId: 'teen-a' }), params('item-a'))
      expect(back.status).toBe(200)
      expect(db.find('listItem', 'item-a')).toMatchObject({ checked: false, checked_by: null })
      expect(audits().map((a) => a.metadata.action)).toEqual(['list_item_check', 'list_item_uncheck'])
    })

    it('replays a retry with the same key instead of applying it twice', async () => {
      const k = key()
      const first = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }, { k }), params('item-a'))
      const checkedAt = db.find('listItem', 'item-a')!.checked_at
      const again = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }, { k }), params('item-a'))
      expect(again.status).toBe(200)
      expect(again.headers.get('Idempotency-Replayed')).toBe('true')
      expect(again.headers.get('Cache-Control')).toBe('private, no-store')
      expect(await again.json()).toEqual(await first.json())
      expect(db.find('listItem', 'item-a')!.checked_at).toBe(checkedAt)
      expect(audits()).toHaveLength(1)
      const record = db.rows('idempotencyRecord')[0]
      expect(record).toMatchObject({ scope: `device:${D1}`, family_id: FAMILY_A, user_id: null, action: 'device.list-item.set-checked' })

      // The same key for a different request is refused.
      const reused = await tick.PATCH(tickReq({ checked: false, actingMemberId: 'child-a' }, { k }), params('item-a'))
      expect(reused.status).toBe(422)
      // Keys are per tablet: D1b's own use of the same key is its own request.
      const other = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }, { k, cookies: fx.d1b.cookies }), params('item-a'))
      expect(other.status).toBe(200)
      expect(other.headers.get('Idempotency-Replayed')).toBeNull()
    })

    it("a foreign item is the same 404 as a missing one, and H2's row does not change", async () => {
      const foreign = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }), params('item-b'))
      const missing = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }), params('item-zzz'))
      expect(foreign.status).toBe(404)
      expect(await foreign.json()).toEqual(await missing.json())
      expect(db.find('listItem', 'item-b')!.checked).toBe(false)
      expect(JSON.stringify(await foreign.json())).not.toContain(FOREIGN)
      expect(audits()).toHaveLength(0)
    })

    it('only grocery/shopping lists (what the tablet shows); a to-do list item is 404', async () => {
      db.find('list', 'list-a')!.type = 'todo'
      const res = await tick.PATCH(tickReq({ checked: true, actingMemberId: 'child-a' }), params('item-a'))
      expect(res.status).toBe(404)
      expect(db.find('listItem', 'item-a')!.checked).toBe(false)
    })

    it('accepts only `checked` and `actingMemberId`', async () => {
      for (const body of [
        { checked: 'yes', actingMemberId: 'child-a' },
        { actingMemberId: 'child-a' },
        { checked: true, content: 'Renamed', actingMemberId: 'child-a' },
      ]) {
        const res = await tick.PATCH(tickReq(body), params('item-a'))
        expect(res.status).toBe(400)
      }
      expect(db.find('listItem', 'item-a')).toMatchObject({ checked: false, content: 'Home milk' })
    })
  })

  describe('POST /api/device/lists/:id/items (grocery quick add)', () => {
    beforeEach(() => allowWrites())

    it('adds to a household grocery list as the picked member, with a minimal answer and an audit row', async () => {
      const res = await add.POST(postReq({ content: '  Eggs  ', actingMemberId: 'teen-a' }), params('list-a'))
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body).toEqual({ item: { id: expect.any(String), content: 'Eggs', quantity: 1, listId: 'list-a' } })
      expect(db.find('listItem', body.item.id)).toMatchObject({ list_id: 'list-a', content: 'Eggs', added_by: 'teen-a', notes: null })
      expect(audits()[0]).toMatchObject({
        actor_user_id: 'teen-a',
        device_id: D1,
        metadata: { action: 'list_item_add', targetType: 'list_item', targetId: body.item.id },
      })
    })

    it('replays with the same key: one row only', async () => {
      const k = key()
      await add.POST(postReq({ content: 'Eggs', actingMemberId: 'teen-a' }, { k }), params('list-a'))
      const again = await add.POST(postReq({ content: 'Eggs', actingMemberId: 'teen-a' }, { k }), params('list-a'))
      expect(again.status).toBe(201)
      expect(again.headers.get('Idempotency-Replayed')).toBe('true')
      expect(db.rows('listItem').filter((i) => i.content === 'Eggs')).toHaveLength(1)
    })

    it('converges after a lock takeover: a committed run whose answer was never stored is found, not added again', async () => {
      const k = key()
      // The first run commits the row, then storing its response fails (the process "dies").
      const store = jest
        .spyOn(fakePrisma.idempotencyRecord, 'update')
        .mockRejectedValueOnce(new Error('connection lost'))
      const first = await add.POST(postReq({ content: 'Eggs', actingMemberId: 'teen-a' }, { k }), params('list-a'))
      store.mockRestore()
      expect(first.status).toBe(201)
      const firstBody = await first.json()
      const record = db.rows('idempotencyRecord').find((r) => r.key === k)!
      expect(record.response_status ?? null).toBeNull()
      expect(db.find('listItem', firstBody.item.id)!.source_request_id).toBe(record.id)
      // Simulate the first run dying before its audit row too.
      db.rows('deviceAuditEvent').splice(0)

      // Before the lock timeout a retry is told to wait.
      const early = await add.POST(postReq({ content: 'Eggs', actingMemberId: 'teen-a' }, { k }), params('list-a'))
      expect(early.status).toBe(409)

      // After it, the retry takes the record over and returns the same item.
      idempotencyRuntime.now = () => new Date(Date.now() + 60 * 1000)
      const retry = await add.POST(postReq({ content: 'Eggs', actingMemberId: 'teen-a' }, { k }), params('list-a'))
      expect(retry.status).toBe(201)
      expect(await retry.json()).toEqual(firstBody)
      expect(db.rows('listItem').filter((i) => i.content === 'Eggs')).toHaveLength(1)
      expect(audits().filter((a) => a.metadata.targetId === firstBody.item.id)).toHaveLength(1)
      // A further retry is a plain replay and audits nothing more.
      const replay = await add.POST(postReq({ content: 'Eggs', actingMemberId: 'teen-a' }, { k }), params('list-a'))
      expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
      expect(audits()).toHaveLength(1)
    })

    it('a foreign list is the same 404 as a missing one; content 1–200 characters', async () => {
      const foreign = await add.POST(postReq({ content: 'Eggs', actingMemberId: 'teen-a' }), params('list-b'))
      const missing = await add.POST(postReq({ content: 'Eggs', actingMemberId: 'teen-a' }), params('list-zzz'))
      expect(foreign.status).toBe(404)
      expect(await foreign.json()).toEqual(await missing.json())
      for (const content of ['', '   ', 'x'.repeat(201), 42]) {
        const res = await add.POST(postReq({ content, actingMemberId: 'teen-a' }), params('list-a'))
        expect(res.status).toBe(400)
      }
      expect(db.rows('listItem').filter((i) => i.list_id === 'list-b')).toHaveLength(1)
      expect(writesTo('listItem')).toHaveLength(0)
    })
  })

  describe('POST /api/device/chores/:id/complete', () => {
    beforeEach(() => allowWrites())

    it('completion engine identity conflict is no-store without an audit', async () => {
      const chore=db.find('chore','chore-today-a')!;
      chore.assigned_member_id='hm_fixture_child'; chore.frequency='weekly'; chore.recurrence_id=null;
      const before=structuredClone(chore);
      const spy=jest.spyOn(completionEngine,'completeChore').mockRejectedValue(new HouseholdMemberIdentityConflict());
      try {
        const response=await complete.POST(postReq({actingMemberId:'child-a'}),params(chore.id));
        expect(response.status).toBe(409);
        expect(await errorCode(response)).toBe('IDENTITY_CONFLICT');
        expect(response.headers.get('Cache-Control')).toContain('no-store');
      } finally { spy.mockRestore(); }
      expect(db.find('chore',chore.id)).toEqual(before);
      expect(audits()).toHaveLength(0);
    });
    it('completes a chore due today (waiting for a parent check), names the picked member, never XP', async () => {
      const xpBefore = db.find('user', 'child-a')!.xp
      const res = await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ chore: { id: 'chore-today-a', status: 'completed' }, alreadyCompleted: false })
      expect(JSON.stringify(body)).not.toMatch(/xp|points/i)
      expect(db.find('chore', 'chore-today-a')).toMatchObject({ status: 'completed', photo_url: null })
      expect(db.find('user', 'child-a')!.xp).toBe(xpBefore)
      expect(db.rows('activity').at(-1)).toMatchObject({ user_id: 'child-a', type: 'chore_completed', family_id: FAMILY_A })
      expect(audits()[0]).toMatchObject({
        device_id: D1,
        actor_user_id: 'child-a',
        metadata: { action: 'chore_complete', targetType: 'chore', targetId: 'chore-today-a' },
      })
    })

    it('a chore not due today is 409 CHORE_NOT_DUE_TODAY and stays open', async () => {
      const res = await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-old-a'))
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('CHORE_NOT_DUE_TODAY')
      expect(db.find('chore', 'chore-old-a')!.status).toBe('pending')
      // Due two days ahead (the seeded one) is not today anywhere either.
      const soon = await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-a'))
      expect(await errorCode(soon)).toBe('CHORE_NOT_DUE_TODAY')
    })

    it("a foreign chore is the same 404 as a missing one, and H2's chore stays open", async () => {
      const foreign = await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-b'))
      const missing = await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-zzz'))
      expect(foreign.status).toBe(404)
      expect(await foreign.json()).toEqual(await missing.json())
      expect(db.find('chore', 'chore-today-b')!.status).toBe('pending')
    })

    it('a verified chore stays verified (no reset, no second XP), and a replay is not re-applied', async () => {
      db.find('chore', 'chore-today-a')!.status = 'verified'
      const res = await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      expect(await res.json()).toEqual({ chore: { id: 'chore-today-a', status: 'verified' }, alreadyCompleted: true })
      expect(db.find('chore', 'chore-today-a')!.status).toBe('verified')
      expect(audits()).toHaveLength(0)

      db.find('chore', 'chore-today-a')!.status = 'pending'
      const k = key()
      await complete.POST(postReq({ actingMemberId: 'child-a' }, { k }), params('chore-today-a'))
      const again = await complete.POST(postReq({ actingMemberId: 'child-a' }, { k }), params('chore-today-a'))
      expect(again.headers.get('Idempotency-Replayed')).toBe('true')
      expect(db.rows('activity').filter((a) => a.type === 'chore_completed' && a.user_id === 'child-a')).toHaveLength(1)
      expect(audits()).toHaveLength(1)
    })
  })

  describe('POST /api/device/chores/:id/uncomplete (the tablet Undo)', () => {
    beforeEach(() => allowWrites())

    it("undoes this tablet's own completion within two minutes, audited", async () => {
      await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      advance(60 * 1000)
      const res = await undo.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ chore: { id: 'chore-today-a', status: 'pending' }, alreadyOpen: false })
      expect(db.find('chore', 'chore-today-a')).toMatchObject({ status: 'pending', completed_at: null })
      expect(audits().map((a) => a.metadata.action)).toEqual(['chore_complete', 'chore_undo'])
    })

    it('refuses after the window, from another tablet, or for a completion the tablet did not make', async () => {
      await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      const sibling = await undo.POST(postReq({ actingMemberId: 'child-a' }, { cookies: fx.d1b.cookies }), params('chore-today-a'))
      expect(sibling.status).toBe(403)
      expect(await errorCode(sibling)).toBe('UNDO_NOT_ALLOWED')

      advance(2 * 60 * 1000 + 1000)
      const late = await undo.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      expect(await errorCode(late)).toBe('UNDO_NOT_ALLOWED')
      expect(db.find('chore', 'chore-today-a')!.status).toBe('completed')

      // Completed by a person, not by this tablet.
      addChore('chore-person-a', FAMILY_A, TODAY, { status: 'completed', completed_at: T0 })
      const notMine = await undo.POST(postReq({ actingMemberId: 'child-a' }), params('chore-person-a'))
      expect(await errorCode(notMine)).toBe('UNDO_NOT_ALLOWED')
    })

    it('a second Undo with a fresh key is alreadyOpen and writes no audit row', async () => {
      await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      const first = await undo.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      expect(await first.json()).toMatchObject({ alreadyOpen: false })
      const second = await undo.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      expect(second.status).toBe(200)
      expect(await second.json()).toEqual({ chore: { id: 'chore-today-a', status: 'pending' }, alreadyOpen: true })
      expect(audits().map((a) => a.metadata.action)).toEqual(['chore_complete', 'chore_undo'])
      expect(db.find('chore', 'chore-today-a')!.status).toBe('pending')
    })

    it('canonical Undo returns a no-store identity conflict without reopening or writing an audit', async () => {
      await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      db.find('chore', 'chore-today-a')!.assigned_member_id = 'hm_fixture_child'
      const spy = jest.spyOn(memberSubjects, 'canonicalChoreAssigneeInTx').mockRejectedValue(new HouseholdMemberIdentityConflict())
      try {
        const response = await undo.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
        expect(response.status).toBe(409)
        expect(await errorCode(response)).toBe('IDENTITY_CONFLICT')
        expect(response.headers.get('Cache-Control')).toContain('no-store')
      } finally { spy.mockRestore() }
      expect(db.find('chore', 'chore-today-a')!.status).toBe('completed')
      expect(audits().map(a => a.metadata.action)).toEqual(['chore_complete'])
    })
    it("a parent's verify landing between the read and the transaction is 409 and nothing changes", async () => {
      await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      const original = fakePrisma.chore.findUnique
      let calls = 0
      const spy = jest.spyOn(fakePrisma.chore, 'findUnique').mockImplementation(async (args: any) => {
        const row = await original(args)
        // The first read inside the reopen transaction: a parent verifies right now.
        if (++calls === 1) db.find('chore', 'chore-today-a')!.status = 'verified'
        return row
      })
      try {
        const res = await undo.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
        expect(res.status).toBe(409)
        expect(await errorCode(res)).toBe('CHORE_ALREADY_VERIFIED')
      } finally {
        spy.mockRestore()
      }
      expect(db.find('chore', 'chore-today-a')!.status).toBe('verified')
      expect(audits().map((a) => a.metadata.action)).toEqual(['chore_complete'])
    })

    it('a chore a parent checked meanwhile stays done (409); a foreign chore is 404', async () => {
      await complete.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      db.find('chore', 'chore-today-a')!.status = 'verified'
      const res = await undo.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-a'))
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('CHORE_ALREADY_VERIFIED')
      const foreign = await undo.POST(postReq({ actingMemberId: 'child-a' }), params('chore-today-b'))
      expect(foreign.status).toBe(404)
    })
  })
})

describe('board setup on the tablet under elevation (#274)', () => {
  let fx: ReturnType<typeof seedDevices>
  const ORIGINAL_WEATHER = process.env.WEATHER_ENABLED

  beforeAll(() => {
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    enableSharedDevice()
    setNow(T0)
    process.env.WEATHER_ENABLED = '1'
    fx = seedDevices()
    setPin('parentA', PIN)
    setPin('parentB', '739251')
    Object.assign(family(FAMILY_A), {
      weather_enabled: true,
      weather_latitude: 43.65,
      weather_longitude: -79.38,
      weather_label: 'Home town',
      weather_unit: 'celsius',
      ambient_photo_ids: ['up-secret'],
    })
  })
  afterAll(() => {
    disableSharedDevice()
    resetClock()
    if (ORIGINAL_WEATHER === undefined) delete process.env.WEATHER_ENABLED
    else process.env.WEATHER_ENABLED = ORIGINAL_WEATHER
  })

  async function token(cookies = fx.d1.cookies, userId = 'parent-a', secret = PIN): Promise<string> {
    const res = await elevation.POST(deviceReq({ method: 'POST', cookies, body: { userId, method: 'pin', secret } }))
    expect(res.status).toBe(200)
    return (await res.json()).elevationToken
  }
  const elevatedReq = (t: string | null, opts: { method?: string; body?: unknown; cookies?: Record<string, string>; query?: Record<string, string> } = {}) =>
    deviceReq({
      method: opts.method ?? 'GET',
      cookies: opts.cookies ?? fx.d1.cookies,
      headers: t ? { 'x-device-elevation': t } : {},
      body: opts.body,
      query: opts.query,
    })

  it('refuses without elevation (403 ELEVATION_REQUIRED) and after idle (403 ELEVATION_EXPIRED)', async () => {
    for (const res of [
      await settings.GET(elevatedReq(null)),
      await settings.PATCH(elevatedReq(null, { method: 'PATCH', body: { deviceWrites: { enabled: true } } })),
      await places.GET(elevatedReq(null, { query: { q: 'Toronto' } })),
    ]) {
      expect(res.status).toBe(403)
      expect(await errorCode(res)).toBe('ELEVATION_REQUIRED')
    }
    const t = await token()
    advance(5 * 60 * 1000)
    const expired = await settings.PATCH(elevatedReq(t, { method: 'PATCH', body: { deviceWrites: { enabled: true } } }))
    expect(expired.status).toBe(403)
    expect(await errorCode(expired)).toBe('ELEVATION_EXPIRED')
    expect(family(FAMILY_A).device_writes_enabled).toBeFalsy()
    expect(audits('device.elevated_action')).toHaveLength(0)
  })

  it("GET: the household's settings without photos or coordinates", async () => {
    const t = await token()
    const res = await settings.GET(elevatedReq(t))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await res.json()
    expect(body.weather).toEqual({ available: true, enabled: true, place: { label: 'Home town' }, unit: 'celsius' })
    expect(body.display).toEqual({ idleMinutes: 5, idleChoices: [0, 1, 2, 5, 10, 15, 30], night: null })
    expect(body.deviceWrites).toEqual({ available: true, enabled: false })
    const text = JSON.stringify(body)
    for (const banned of ['43.65', '-79.38', 'up-secret', 'photoIds', 'uploads', FOREIGN, '@example.test']) {
      expect(text).not.toContain(banned)
    }
  })

  it('PATCH: turns tablet writes on, sets a colour, calm display and weather unit; audits section names only', async () => {
    const t = await token()
    const res = await settings.PATCH(
      elevatedReq(t, {
        method: 'PATCH',
        body: {
          deviceWrites: { enabled: true },
          memberColors: { 'child-a': 'orange' },
          display: { idleMinutes: 10, night: { start: '21:30', end: '06:30' } },
          weather: { unit: 'fahrenheit' },
        },
      })
    )
    expect(res.status).toBe(200)
    expect(family(FAMILY_A)).toMatchObject({
      device_writes_enabled: true,
      ambient_idle_minutes: 10,
      night_start: '21:30',
      night_end: '06:30',
      weather_unit: 'fahrenheit',
    })
    expect(db.find('user', 'child-a')!.board_color).toBe('orange')
    expect(family(FAMILY_B).device_writes_enabled).toBeFalsy()
    expect(audits('device.elevated_action')).toEqual([
      expect.objectContaining({
        family_id: FAMILY_A,
        device_id: D1,
        actor_user_id: 'parent-a',
        metadata: {
          action: 'update_board_settings',
          targetType: 'family',
          targetId: FAMILY_A,
          sections: ['weather', 'memberColors', 'display', 'deviceWrites'],
        },
      }),
    ])
  })

  it('refuses photos on the tablet (O-15), foreign members, and writes nothing', async () => {
    const t = await token()
    const photos = await settings.PATCH(elevatedReq(t, { method: 'PATCH', body: { display: { photoIds: [] } } }))
    expect(photos.status).toBe(400)
    const foreign = await settings.PATCH(elevatedReq(t, { method: 'PATCH', body: { memberColors: { 'child-b': 'orange' } } }))
    expect(foreign.status).toBe(400)
    expect(db.find('user', 'child-b')!.board_color).toBeUndefined()
    expect(family(FAMILY_A).ambient_photo_ids).toEqual(['up-secret'])
    expect(audits('device.elevated_action')).toHaveLength(0)
  })

  it("an elevation token is bound to its tablet: D1's token on D1b is refused", async () => {
    const t = await token()
    const res = await settings.GET(elevatedReq(t, { cookies: fx.d1b.cookies }))
    expect(res.status).toBe(403)
  })

  it('D2 elevated by P2 changes only H2', async () => {
    const t = await token(fx.d2.cookies, 'parent-b', '739251')
    const res = await settings.PATCH(elevatedReq(t, { method: 'PATCH', cookies: fx.d2.cookies, body: { deviceWrites: { enabled: true } } }))
    expect(res.status).toBe(200)
    expect(JSON.stringify(await res.json())).not.toContain('Home town')
    expect(family(FAMILY_B).device_writes_enabled).toBe(true)
    expect(family(FAMILY_A).device_writes_enabled).toBeFalsy()
    void D1B
  })

  it('place search: the fixed provider only, rate limited per tablet', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ name: 'Toronto', admin1: 'Ontario', country: 'Canada', latitude: 43.6532, longitude: -79.3832 }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    try {
      const t = await token()
      const res = await places.GET(elevatedReq(t, { query: { q: 'Toronto' } }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.places[0]).toMatchObject({ latitude: 43.65, longitude: -79.38 })
      expect(String(fetchSpy.mock.calls[0][0])).toMatch(/^https:\/\/geocoding-api\.open-meteo\.com\//)
      expect(db.rows('rateLimitEntry').some((r) => r.key === `weather-places:device:${D1}`)).toBe(true)
      const short = await places.GET(elevatedReq(t, { query: { q: 'T' } }))
      expect(short.status).toBe(400)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
