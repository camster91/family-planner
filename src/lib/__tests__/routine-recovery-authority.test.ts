// Authored source cases, UNRUN: recovery reads must renew before echoing packets.
jest.mock('../routine-schedule-runtime', () => ({
  routineScheduleAuthority:jest.fn(async () => ({pointsEnabled:false})),
  routineScheduleFailure:jest.fn(() => null),
}));
import { reviewRoutineSchedule } from '../routine-schedule-api';
import { reviewIndependentRoutineStep } from '../routine-independent-runtime';
import { routineScheduleAuthority,routineScheduleFailure } from '../routine-schedule-runtime';
const actor = {userId:'parent-a',familyId:'family-a',tokenVersion:0};
const original = { action:'pause',expected_user_id:actor.userId,expected_family_id:actor.familyId,
  issued_at:'2026-10-01T12:00:00.000Z',view_day:'2026-10-01',view_zone:'UTC',scope:'future-after-today' };
const now = new Date('2026-10-26T12:00:00.000Z');
const packet = (kind:'schedule'|'independent') => ({kind,key:'original_packet_key_001',body:JSON.stringify(kind === 'schedule'
  ? {...original,protocol:'herewoven.routine-schedule.v1',stack_id:'stack-a',expected_version:1}
  : {...original,protocol:'herewoven.routine-independent.v1',root_id:'root-a',expected_revision:1})});
function fixture() {
  const tx = {idempotencyRecord:{findUnique:jest.fn(async () => null),update:jest.fn()},
    routineStack:{findFirst:jest.fn(async () => null)},$queryRaw:jest.fn(async () => []),chore:{update:jest.fn()}};
  return {tx,db:{$transaction:jest.fn(async (work:(tx:unknown) => unknown) => work(tx))}};
}
async function review(kind:'schedule'|'independent',db:unknown) {
  return kind === 'schedule'
    ? reviewRoutineSchedule(db as never,actor,packet(kind) as never,'a'.repeat(64),false,now)
    : reviewIndependentRoutineStep(db as never,actor,packet(kind) as never,'a'.repeat(64),false,now);
}
beforeEach(() => {
  jest.mocked(routineScheduleAuthority).mockReset().mockResolvedValue({pointsEnabled:false});
  jest.mocked(routineScheduleFailure).mockReset().mockReturnValue(null);
});
it.each(['schedule','independent'] as const)('withholds %s recovery packets on late authority refusal', async kind => {
  const lost = new Error('Fixture access changed');
  jest.mocked(routineScheduleAuthority).mockResolvedValueOnce({pointsEnabled:false}).mockRejectedValueOnce(lost);
  jest.mocked(routineScheduleFailure).mockImplementation(error => error === lost
    ? {status:403,body:{error:{code:'ROUTINE_PARENT_REQUIRED'}}} : null);
  const {tx,db} = fixture();
  expect(await review(kind,db)).toEqual({status:403,body:{error:{code:'ROUTINE_PARENT_REQUIRED'}}});
  expect(jest.mocked(routineScheduleAuthority).mock.calls.map(call => call[1])).toEqual([actor,actor]);
  expect(tx.idempotencyRecord.update).not.toHaveBeenCalled();
  expect(tx.chore.update).not.toHaveBeenCalled();
});
it.each(['schedule','independent'] as const)('preserves exact %s packets when an authorized expired review succeeds', async kind => {
  const {tx,db} = fixture();
  const result = await review(kind,db);
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({entry:packet(kind),state:'expired',canRetry:false});
  expect(routineScheduleAuthority).toHaveBeenCalledTimes(2);
  expect(tx.idempotencyRecord.update).not.toHaveBeenCalled();
  expect(tx.chore.update).not.toHaveBeenCalled();
});
