// Source cases authored for deferred QA; no execution claimed.
jest.mock('../routine-schedule-runtime', () => ({
  routineScheduleAuthority: jest.fn(async () => ({ pointsEnabled:false })),
  routineScheduleFailure: jest.fn(() => null),
}));
jest.mock('../profile-chore-gates', () => ({
  isProfileChoreEnabled: jest.fn(() => true),
  isProfileChoreRecurrenceSupported: jest.fn(() => false),
}));
import { readRoutineScheduleCatalog } from '../routine-schedule-catalog';
import { isProfileChoreEnabled } from '../profile-chore-gates';
import { routineScheduleAuthority,routineScheduleFailure } from '../routine-schedule-runtime';
const actor = { userId:'parent-a',familyId:'family-a',tokenVersion:0,memberProtocol:2 as const };
const profile = { id:'profile-a',name:'Small child',family_id:'family-a',role:'child',age:3,
  archived_at:null,erasure_user_id:null,legacy_mapping:null,account_link:null };
function catalogDb(profiles: unknown[]) {
  const tx = { $queryRaw:jest.fn(async () => []), user:{ findMany:jest.fn(async () => []) },
    householdMember:{ findMany:jest.fn(async () => profiles), findFirst:jest.fn(() => { throw new Error('Unexpected per-profile query') }) } };
  return { tx, db:{ $transaction:jest.fn(async (work: (tx: unknown) => unknown) => work(tx)) } };
}
beforeEach(() => {
  jest.mocked(isProfileChoreEnabled).mockReturnValue(true);
  jest.mocked(routineScheduleAuthority).mockReset().mockResolvedValue({pointsEnabled:false});
  jest.mocked(routineScheduleFailure).mockReset().mockReturnValue(null);
});
it('projects 200 eligible profile choices without rereading them or exposing eligibility fields', async () => {
  const { tx,db } = catalogDb(Array.from({ length:200 }, (_, index) => ({ ...profile,id:`profile-${index}` })));
  const result = await readRoutineScheduleCatalog(db as never,actor,null);
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ assignments:expect.any(Array) });
  const assignments = (result.body as { assignments:unknown[] }).assignments;
  expect(assignments).toHaveLength(200);
  expect(assignments[0]).toEqual({ subject:{kind:'profile',member_id:'profile-0'},name:'Small child',role:'child',canRepeat:false });
  expect(tx.householdMember.findMany).toHaveBeenCalledTimes(1);
  expect(tx.householdMember.findFirst).not.toHaveBeenCalled();
  expect(JSON.stringify(result.body)).not.toContain('erasure_user_id');
  expect(JSON.stringify(result.body)).not.toContain('account_link');
});
it('retains canonical profile exclusion rules even if a loaded snapshot is ineligible', async () => {
  const invalid = [
    { family_id:'family-b' }, { archived_at:new Date() }, { erasure_user_id:'former-user' },
    { legacy_mapping:{user_id:'mapped-user'} }, { account_link:{user_id:'linked-user'} },
    { role:'unknown' }, { role:'teen',age:3 },
  ].map((patch,index) => ({ ...profile,...patch,id:`invalid-${index}` }));
  const { tx,db } = catalogDb([profile,...invalid]);
  const result = await readRoutineScheduleCatalog(db as never,actor,null);
  expect(result.status).toBe(200);
  expect((result.body as { assignments:unknown[] }).assignments).toEqual([
    { subject:{kind:'profile',member_id:'profile-a'},name:'Small child',role:'child',canRepeat:false },
  ]);
  expect(tx.householdMember.findFirst).not.toHaveBeenCalled();
});
it('keeps profile storage out of the catalog when rollout is disabled', async () => {
  jest.mocked(isProfileChoreEnabled).mockReturnValue(false);
  const { tx,db } = catalogDb([profile]);
  const result = await readRoutineScheduleCatalog(db as never,actor,null);
  expect(result.status).toBe(200);
  expect((result.body as { assignments:unknown[] }).assignments).toEqual([]);
  expect(tx.householdMember.findMany).not.toHaveBeenCalled();
  expect(tx.householdMember.findFirst).not.toHaveBeenCalled();
});

it('returns a late authority refusal without the already-loaded private choices', async () => {
  const lost = new Error('Fixture authority changed');
  jest.mocked(routineScheduleAuthority).mockResolvedValueOnce({pointsEnabled:false}).mockRejectedValueOnce(lost);
  jest.mocked(routineScheduleFailure).mockImplementation(error => error === lost
    ? {status:403,body:{error:{code:'ROUTINE_PARENT_REQUIRED'}}} : null);
  const { db } = catalogDb([profile]);
  const result = await readRoutineScheduleCatalog(db as never,actor,null);
  expect(result).toEqual({status:403,body:{error:{code:'ROUTINE_PARENT_REQUIRED'}}});
  expect(JSON.stringify(result.body)).not.toContain('Small child');
  expect(jest.mocked(routineScheduleAuthority).mock.calls.map(call => call[1])).toEqual([actor,actor]);
});
it('uses renewed feature capabilities rather than the initial flag in its response', async () => {
  jest.mocked(routineScheduleAuthority).mockResolvedValueOnce({pointsEnabled:true}).mockResolvedValueOnce({pointsEnabled:false});
  const { db } = catalogDb([]);
  const result = await readRoutineScheduleCatalog(db as never,actor,null);
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({pointsEnabled:false});
});
it('keeps the original principal when a caller object changes during a catalog wait', async () => {
  const mutable = {...actor};
  const { tx,db } = catalogDb([profile]);
  tx.user.findMany.mockImplementationOnce(async () => {
    mutable.familyId = 'family-b'; mutable.tokenVersion = 9;
    return [];
  });
  const result = await readRoutineScheduleCatalog(db as never,mutable,null);
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({familyId:'family-a',userId:'parent-a'});
  expect(jest.mocked(routineScheduleAuthority).mock.calls.map(call => call[1])).toEqual([actor,actor]);
  expect(tx.householdMember.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({family_id:'family-a'})}));
});
