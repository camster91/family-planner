// Authored source cases, UNRUN. Fake rows do not prove PostgreSQL constraints/locking.
jest.mock('../household-lock', () => ({ lockHousehold:jest.fn() }));
import { db,fakePrisma,FAMILY_A,FAMILY_B } from '@/__tests__/helpers/two-household';
import { eligibleChoreAssigneeInTx,readChoreAssigneesInTx } from '../chore-member-subject';
import { HouseholdMemberIdentityConflict } from '../household-member-lifecycle';
beforeEach(() => db.reset());
it('matches scalar eligibility for legacy, inactive, missing and contradictory account mappings', async () => {
  const userIds = ['canonical','archived','erased','foreign-ref','dual','reverse','missing-member'];
  for (const id of userIds) db.rows('user').push({ id,family_id:FAMILY_A });
  for (const id of ['canonical','archived','erased','dual-a','dual-b','reverse'])
    db.rows('householdMember').push({ id:`member-${id}`,family_id:FAMILY_A,
      archived_at:id === 'archived' ? new Date() : null, erasure_user_id:id === 'erased' ? 'former' : null });
  for (const id of ['canonical','archived','erased','reverse','missing-member'])
    db.rows('householdMemberLegacyMapping').push({ user_id:id,member_id:`member-${id}`,family_id:FAMILY_A });
  db.rows('householdMemberLegacyMapping').push({user_id:'foreign-ref',member_id:'foreign-member',family_id:FAMILY_B},
    {user_id:'dual',member_id:'member-dual-a',family_id:FAMILY_A});
  db.rows('householdMemberAccountLink').push({user_id:'dual',member_id:'member-dual-b',family_id:FAMILY_A},
    {user_id:'different-account',member_id:'member-reverse',family_id:FAMILY_A});
  const requested = ['parent-a',...userIds,'absent-account','parent-b'];
  const result = await readChoreAssigneesInTx(fakePrisma,FAMILY_A,requested);
  expect(result.get('parent-a')).toEqual({kind:'eligible',assignee:{assigned_to:'parent-a'}});
  expect(result.get('canonical')).toEqual({kind:'eligible',assignee:{assigned_to:'canonical',assigned_member_id:'member-canonical'}});
  for (const id of ['archived','erased','absent-account','parent-b']) expect(result.get(id)).toEqual({kind:'inactive'});
  for (const id of ['foreign-ref','dual','reverse','missing-member']) expect(result.get(id)).toEqual({kind:'conflict'});
  for (const id of requested) {
    try {
      const assignee = await eligibleChoreAssigneeInTx(fakePrisma,FAMILY_A,id);
      expect(result.get(id)).toEqual(assignee ? {kind:'eligible',assignee} : {kind:'inactive'});
    } catch (error) {
      expect(error).toBeInstanceOf(HouseholdMemberIdentityConflict);
      expect(result.get(id)).toEqual({kind:'conflict'});
    }
  }
  expect(await eligibleChoreAssigneeInTx(fakePrisma,FAMILY_A,'archived',{historical:true})).toEqual({assigned_to:'archived',assigned_member_id:'member-archived'});
  await expect(eligibleChoreAssigneeInTx(fakePrisma,FAMILY_A,'parent-a',{requireCanonical:true})).rejects.toBeInstanceOf(HouseholdMemberIdentityConflict);
});
it('reads 205 requested account choices in bounded batches without dropping or conflating them', async () => {
  const ids = Array.from({length:205},(_,index) => `account-${index}`);
  ids.forEach(id => db.rows('user').push({id,family_id:FAMILY_A}));
  const findMany = jest.fn(fakePrisma.user.findMany);
  const tx = { user:{findMany}, householdMember:fakePrisma.householdMember,
    householdMemberLegacyMapping:fakePrisma.householdMemberLegacyMapping,
    householdMemberAccountLink:fakePrisma.householdMemberAccountLink };
  const result = await readChoreAssigneesInTx(tx as never,FAMILY_A,[...ids,ids[0]]);
  expect(result.size).toBe(205);
  expect(findMany).toHaveBeenCalledTimes(3);
  for (const [args] of findMany.mock.calls as unknown as Array<[{where:{id:{in:string[]};family_id:string}}]>) {
    expect(args.where.id.in.length).toBeLessThanOrEqual(100);
    expect(args.where.family_id).toBe(FAMILY_A);
  }
  for (const id of ids) expect(result.get(id)).toEqual({kind:'eligible',assignee:{assigned_to:id}});
});
