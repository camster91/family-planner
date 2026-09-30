// Route inventory F-6 (#289): a chore's status changes on one code path.
//
//   complete → `completeChore` (src/lib/chore-complete.ts), shared by
//              POST /api/chores/complete and the tablet's POST /api/device/chores/:id/complete;
//   reopen   → `reopenCompletedChoreInTx` (src/lib/chore-reopen.ts), shared by
//              POST /api/chores/uncomplete, the verify reject and the tablet's Undo.
//
// PATCH /api/chores was listed as a second status path. It is not: its schema
// drops `status` (and every verify field), so it edits the chore's details
// and never touches status. These tests pin both halves and the exact
// response bodies, so the external contracts stay as they are.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/notifications-server', () => require('@/__tests__/helpers/two-household').notificationsMock)
jest.mock('@/lib/gamification-server', () => ({
  awardChoreXP: jest.fn(async () => ({ levelUp: false, newLevel: 1 })),
}))
jest.mock('@/lib/chore-complete', () => {
  const actual = jest.requireActual('@/lib/chore-complete')
  return { ...actual, completeChore: jest.fn(actual.completeChore) }
})
jest.mock('@/lib/chore-reopen', () => {
  const actual = jest.requireActual('@/lib/chore-reopen')
  return { ...actual, reopenCompletedChoreInTx: jest.fn(actual.reopenCompletedChoreInTx) }
})

import fs from 'fs'
import path from 'path'
import * as chores from '../route'
import { POST as complete } from '../complete/route'
import { POST as uncomplete } from '../uncomplete/route'
import { completeChore } from '@/lib/chore-complete'
import { reopenCompletedChoreInTx } from '@/lib/chore-reopen'
import { db, req, bodyOf, writesTo, type UserKey } from '@/__tests__/helpers/two-household'

const completeSpy = completeChore as jest.Mock
const reopenSpy = reopenCompletedChoreInTx as jest.Mock

const post = (fn: typeof complete, as: UserKey, body: unknown) => fn(req({ as, method: 'POST', body }))

beforeEach(() => {
  db.reset()
  completeSpy.mockClear()
  reopenSpy.mockClear()
})

describe('POST /api/chores/complete', () => {
  it('completes through completeChore and keeps its response bodies', async () => {
    const first = await post(complete, 'childA', { choreId: 'chore-a' })
    expect(first.status).toBe(200)
    expect(await bodyOf(first)).toEqual({ success: true, choreId: 'chore-a' })
    expect(completeSpy).toHaveBeenCalledTimes(1)
    expect(completeSpy.mock.calls[0][1]).toMatchObject({ id: 'chore-a', family_id: 'family-A' })
    expect(completeSpy.mock.calls[0][2]).toEqual({ id: 'child-a', name: 'Child A' })
    expect(db.find('chore', 'chore-a')!.status).toBe('completed')

    // A repeat is the helper's no-op, reported the same way as before.
    const again = await post(complete, 'childA', { choreId: 'chore-a' })
    expect(await bodyOf(again)).toEqual({ success: true, alreadyCompleted: true })
    expect(completeSpy).toHaveBeenCalledTimes(2)
  })
})

describe('POST /api/chores/uncomplete', () => {
  it('reopens through reopenCompletedChoreInTx and keeps its response bodies', async () => {
    await post(complete, 'childA', { choreId: 'chore-a' })
    const res = await post(uncomplete, 'childA', { choreId: 'chore-a' })
    expect(await bodyOf(res)).toEqual({ success: true, choreId: 'chore-a', status: 'pending' })
    expect(reopenSpy).toHaveBeenCalledTimes(1)
    expect(db.find('chore', 'chore-a')!.status).toBe('pending')

    const again = await post(uncomplete, 'childA', { choreId: 'chore-a' })
    expect(await bodyOf(again)).toEqual({ success: true, alreadyOpen: true })
  })
})

describe('PATCH /api/chores never changes status', () => {
  it.each<[string, Record<string, unknown>]>([
    ['complete', { status: 'completed', completed_at: '2026-09-29T10:00:00.000Z' }],
    ['verify', { status: 'verified', photo_verified: true, verified_at: '2026-09-29T10:00:00.000Z' }],
  ])('a %s attempt edits only the details and calls no status helper', async (_label, statusFields) => {
    const res = await chores.PATCH(
      req({ as: 'parentA', method: 'PATCH', body: { choreId: 'chore-a', title: 'Dishes, then dry', ...statusFields } })
    )
    expect(res.status).toBe(200)
    const body = await bodyOf(res)
    expect(body.chore).toMatchObject({ id: 'chore-a', title: 'Dishes, then dry', status: 'pending' })
    expect(db.find('chore', 'chore-a')!.status).toBe('pending')
    const data = writesTo('chore').map((w) => w.args.data)
    expect(data).toEqual([{ title: 'Dishes, then dry' }])
    expect(completeSpy).not.toHaveBeenCalled()
    expect(reopenSpy).not.toHaveBeenCalled()
  })

  it('reopening through PATCH is not possible either: a completed chore stays completed', async () => {
    await post(complete, 'childA', { choreId: 'chore-a' })
    completeSpy.mockClear()
    const res = await chores.PATCH(
      req({ as: 'childA', method: 'PATCH', body: { choreId: 'chore-a', status: 'pending', completed_at: null } })
    )
    expect(res.status).toBe(200)
    expect(db.find('chore', 'chore-a')!.status).toBe('completed')
    expect(reopenSpy).not.toHaveBeenCalled()
  })
})

describe('source: no chore route writes a completion or reopen itself', () => {
  const API = path.join(__dirname, '..', '..')
  const read = (rel: string) => fs.readFileSync(path.join(API, rel), 'utf8')

  it.each([
    ['chores/route.ts', []],
    ['chores/complete/route.ts', ['completeChore']],
    ['chores/uncomplete/route.ts', ['reopenCompletedChoreInTx']],
    ['chores/verify/route.ts', ['reopenCompletedChoreInTx']],
    ['device/chores/[id]/complete/route.ts', ['completeChore']],
    ['device/chores/[id]/uncomplete/route.ts', ['reopenCompletedChoreInTx']],
  ])('%s', (file, helpers) => {
    const src = read(file)
    for (const helper of helpers) expect(src).toContain(`${helper}(`)
    // The completed/pending transitions live in the helpers only.
    expect(src).not.toMatch(/status:\s*'completed'\s*,\s*\n?\s*completed_at/)
    expect(src).not.toMatch(/data:\s*\{[^}]*status:\s*'pending'/)
  })
})
