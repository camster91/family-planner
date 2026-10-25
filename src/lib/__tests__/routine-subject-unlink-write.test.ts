/** Authored/unrun. Dormant adapter source; no PostgreSQL rollback proof. */
import type { Prisma } from '@prisma/client'
import { prepareRoutineSubjectUnlinkBatch } from '../routine-subject-unlink'
import { prepareRoutineSubjectUnlinkInTx } from '../routine-subject-unlink-read'
import { rewriteRoutineSubjectsForUnlinkInTx, RoutineSubjectUnlinkWriteConflict } from '../routine-subject-unlink-write'
jest.mock('../routine-subject-unlink-read', () => ({
  ...jest.requireActual('../routine-subject-unlink-read'),
  prepareRoutineSubjectUnlinkInTx: jest.fn(),
}))
const scope = { familyId: 'family-a', userId: 'account-a', memberId: 'profile-a' }
const definition = {
  protocol: 'herewoven.routine-step-series.v1', revision: 4, stack_id: 'stack-a', state: 'paused',
  effective_on: '2026-10-25', anchor: 'After lunch',
  schedule: { frequency: 'weekly', starts_on: '2026-10-25', weekly_days: [1, 3], monthly_day: null },
  content: { title: 'Synthetic step', description: null, points: 7, difficulty: 'easy', icon: null, duration_minutes: 5,
    subject: { kind: 'account', user_id: scope.userId, member_id: scope.memberId } },
}
const plan = prepareRoutineSubjectUnlinkBatch({ complete: true, roots: ['root-a', 'root-b'].map(id => ({
  id, familyId: scope.familyId, recurrenceId: id, definition,
})) }, scope)
const size = { id: 'stack-a', family_id: scope.familyId, version: 6, label_bytes: 12, config_bytes: 0 }
const stack = { id: 'stack-a', family_id: scope.familyId, version: 6, label: 'Shared stack', schedule_config: null }
function transaction() {
  const read = jest.fn().mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([size]).mockResolvedValueOnce([stack])
  const write = jest.fn().mockResolvedValue(1)
  return { read, write, tx: { $queryRaw: read, $executeRaw: write } as unknown as Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'> }
}
beforeEach(() => { jest.mocked(prepareRoutineSubjectUnlinkInTx).mockReset().mockResolvedValue(plan) })
it('preserves occurrence/history/credit fields and invalidates a shared stack once for two roots', async () => {
  const { tx, read, write } = transaction()
  expect(await rewriteRoutineSubjectsForUnlinkInTx(tx, scope)).toEqual({
    kind: 'applied', inspectedRoots: 2, unchangedRoots: 0, rewrittenRoots: 2, invalidatedStacks: 1,
  })
  expect(prepareRoutineSubjectUnlinkInTx).toHaveBeenCalledWith(tx, scope)
  expect(read).toHaveBeenCalledTimes(3)
  expect(write).toHaveBeenCalledTimes(3)
  const [rootSql, value, id, family, revision] = write.mock.calls[0]
  expect(rootSql.join('?')).toContain('SET "routine_series_config" = ?::jsonb')
  expect(rootSql.join('?')).not.toMatch(/assigned_to|assigned_member_id|completed_|xp_|points|AccountLink|LegacyMapping/)
  expect([id, family, revision]).toEqual(['root-a', scope.familyId, '4'])
  expect(JSON.parse(value)).toMatchObject({ revision: 5, state: 'paused', content: { points: 7, subject: { kind: 'profile', member_id: scope.memberId } } })
  const [stackSql, version, fingerprint, stackId, stackFamily, previous] = write.mock.calls[2]
  expect(stackSql.join('?')).toContain('AND "version" = ?')
  expect([version, stackId, stackFamily, previous]).toEqual([7, 'stack-a', scope.familyId, 6])
  expect(fingerprint).toMatch(/^[a-f0-9]{64}$/)
})
it('propagates a held root inventory before any stack read or write', async () => {
  jest.mocked(prepareRoutineSubjectUnlinkInTx).mockResolvedValueOnce({ kind: 'held', reason: 'incomplete-inventory' })
  const { tx, read, write } = transaction()
  expect(await rewriteRoutineSubjectsForUnlinkInTx(tx, scope)).toEqual({ kind: 'held', reason: 'incomplete-inventory' })
  expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled()
})
it.each([
  { row: { ...size, family_id: 'family-b' }, reason: 'stack-inventory-changed' },
  { row: { ...size, version: 2147483647 }, reason: 'stack-version-exhausted' },
  { row: { ...size, config_bytes: 65537 }, reason: 'stack-budget' },
])('holds bad stack metadata before any JSON transfer or write: $reason', async ({ row, reason }) => {
  const { tx, read, write } = transaction()
  read.mockReset().mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([row])
  expect(await rewriteRoutineSubjectsForUnlinkInTx(tx, scope)).toEqual({ kind: 'held', reason })
  expect(read).toHaveBeenCalledTimes(2); expect(write).not.toHaveBeenCalled()
})
it('holds an unsupported future stack instead of partially rewriting supported roots', async () => {
  const { tx, read, write } = transaction()
  read.mockReset().mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([size])
    .mockResolvedValueOnce([{ ...stack, schedule_config: { protocol: 'future-unknown' } }])
  expect(await rewriteRoutineSubjectsForUnlinkInTx(tx, scope)).toEqual({ kind: 'held', reason: 'stack-definition-held' })
  expect(write).not.toHaveBeenCalled()
})
it.each([0, 2])('throws on a failed root compare (%s), requiring the enclosing identity transaction to roll back', async count => {
  const { tx, write } = transaction(); write.mockResolvedValueOnce(count)
  await expect(rewriteRoutineSubjectsForUnlinkInTx(tx, scope)).rejects.toBeInstanceOf(RoutineSubjectUnlinkWriteConflict)
  expect(write).toHaveBeenCalledTimes(1)
})
it('throws after a failed stack compare rather than returning a held result after root effects', async () => {
  const { tx, write } = transaction(); write.mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0)
  await expect(rewriteRoutineSubjectsForUnlinkInTx(tx, scope)).rejects.toBeInstanceOf(RoutineSubjectUnlinkWriteConflict)
  expect(write).toHaveBeenCalledTimes(3)
  // A fake does not prove database rollback; the future caller must abort its tx.
})
