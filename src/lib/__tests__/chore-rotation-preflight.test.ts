// Source cases authored UNRUN. No database/API operation was executed.
jest.mock('@/lib/household-lock', () => ({ lockHousehold: jest.fn() }));
jest.mock('@/lib/chore-member-subject', () => ({ canonicalChoreAssigneeInTx: jest.fn() }));
import { applyRotationEditInTx } from '../chore-rotation';
import { canonicalChoreAssigneeInTx } from '../chore-member-subject';
const resolve = jest.mocked(canonicalChoreAssigneeInTx);
const now = new Date('2026-10-25T12:00:00.000Z');
function txFor(rows = 24) {
  return {
    user: { findMany: jest.fn(async () => [{ id: 'user-a' }, { id: 'user-b' }]) },
    chore: {
      findFirst: jest.fn(async () => ({ id: 'root-a', rotation_member_ids: ['user-a', 'user-b'] })),
      findMany: jest.fn(async () => Array.from({ length: rows }, (_, i) => ({ id: `chore-${i}`, assigned_to: i % 2 ? 'user-b' : 'user-a', assigned_member_id: `member-${i % 2}`, rotation_index: i % 2 }))),
      update: jest.fn(async () => ({})), updateMany: jest.fn(async () => ({ count: rows })),
    },
  };
}
beforeEach(() => { resolve.mockReset(); resolve.mockImplementation(async (_tx, _family, userId) => ({ assigned_to: userId, assigned_member_id: `member-for-${userId}` })); });
it('resolves each canonical participant once while retaining every planned turn', async () => {
  const tx = txFor();
  expect(await applyRotationEditInTx(tx as any, 'root-a', 'family-a', ['user-b', 'user-a'], now)).toBe(true);
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(resolve.mock.calls.map(call => call[2])).toEqual(['user-a', 'user-b']);
  const writes = tx.chore.update.mock.calls as unknown as Array<[any]>;
  expect(writes).toHaveLength(25);
  for (let i = 0; i < 24; i++) expect(writes[i + 1][0].data).toMatchObject({ rotation_index: i % 2, assigned_to: i % 2 ? 'user-a' : 'user-b', assigned_member_id: `member-for-${i % 2 ? 'user-a' : 'user-b'}` });
});
it('holds all rotation writes when any required canonical identity is unavailable', async () => {
  const tx = txFor();
  resolve.mockImplementation(async (_tx, _family, userId) => { if (userId === 'user-b') throw new Error('Fixture identity refusal'); return { assigned_to: userId, assigned_member_id: 'member-a' }; });
  await expect(applyRotationEditInTx(tx as any, 'root-a', 'family-a', ['user-b', 'user-a'], now)).rejects.toThrow('Fixture identity refusal');
  expect(tx.chore.update).not.toHaveBeenCalled(); expect(tx.chore.updateMany).not.toHaveBeenCalled();
});
it('does not migrate legacy account-only rows merely because rotation was edited', async () => {
  const tx = txFor(2);
  tx.chore.findMany.mockResolvedValue([{ id: 'one', assigned_to: 'user-a', assigned_member_id: null as any, rotation_index: 0 }, { id: 'two', assigned_to: 'user-b', assigned_member_id: null as any, rotation_index: 1 }]);
  await applyRotationEditInTx(tx as any, 'root-a', 'family-a', ['user-b', 'user-a'], now);
  expect(resolve).not.toHaveBeenCalled();
  expect((tx.chore.update.mock.calls as unknown as Array<[any]>)[1][0].data).not.toHaveProperty('assigned_member_id');
});

it('reads the complete future plan across a date/ID page boundary before effects', async () => {
  const tx = txFor();
  const rows = Array.from({ length: 501 }, (_, i) => ({ id: `chore-${String(i).padStart(4, '0')}`, assigned_to: i % 2 ? 'user-b' : 'user-a', assigned_member_id: `member-${i % 2}`, rotation_index: i % 2, due_date: new Date('2026-10-26T00:00:00.000Z') }));
  tx.chore.findMany.mockResolvedValueOnce(rows.slice(0, 500)).mockResolvedValueOnce(rows.slice(500));
  await applyRotationEditInTx(tx as any, 'root-a', 'family-a', ['user-b', 'user-a'], now);
  const reads = tx.chore.findMany.mock.calls as unknown as Array<[any]>;
  expect(reads).toHaveLength(2);
  expect(reads[0][0]).toMatchObject({ where: { family_id: 'family-a', recurrence_id: 'root-a', status: 'pending' }, take: 500 });
  expect(reads[1][0].where.OR).toEqual([{ due_date: { gt: rows[499].due_date } }, { due_date: rows[499].due_date, id: { gt: rows[499].id } }]);
  const writes = tx.chore.update.mock.calls as unknown as Array<[any]>;
  expect(writes).toHaveLength(502);
  expect(writes[501][0]).toMatchObject({ where: { id: rows[500].id }, data: { rotation_index: 0, assigned_to: 'user-b' } });
  expect(resolve).toHaveBeenCalledTimes(2);
});
