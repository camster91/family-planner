// Authored UNRUN: mocked target admission, not PostgreSQL or rendered privacy proof.
jest.mock('../household-lock', () => ({lockUser:jest.fn(),lockHousehold:jest.fn()}));
import { readEventNotificationFocus } from '../event-notification-focus';
const owner = {userId:'parent-a',familyId:'family-a',role:'parent',tokenVersion:2};
const row = {id:'event-a',title:'Family picnic',start_time:new Date('2026-12-04T16:00:00.000Z'),end_time:new Date('2026-12-04T17:30:00.000Z')};
function fixture() {
  const tx = {$queryRaw:jest.fn().mockResolvedValueOnce([{family_id:owner.familyId,role:owner.role,token_version:2}])
    .mockResolvedValueOnce([{features:{}}]).mockResolvedValueOnce([{id:row.id}]),
    event:{findFirst:jest.fn(async () => row)}};
  return {tx,db:{$transaction:jest.fn(async (work:(tx:unknown) => unknown) => work(tx))}};
}
it('reads one exact concrete event with minimal fields outside the visible calendar range', async () => {
  const {tx,db} = fixture();
  expect(await readEventNotificationFocus(db as never,owner,row.id)).toEqual({id:row.id,title:row.title,start:row.start_time.toISOString(),end:row.end_time.toISOString()});
  expect(tx.event.findFirst).toHaveBeenCalledWith({where:{id:'event-a',family_id:'family-a',recurrence:null},select:{id:true,title:true,start_time:true,end_time:true}});
});
it('refuses child roles before entering the private transaction', async () => {
  const {db} = fixture();
  expect(await readEventNotificationFocus(db as never,{...owner,role:'child'},row.id)).toBeNull();
  expect(db.$transaction).not.toHaveBeenCalled();
});
it('refuses revoked session generation before querying the target', async () => {
  const {tx,db} = fixture();
  tx.$queryRaw.mockReset().mockResolvedValue([{family_id:owner.familyId,role:owner.role,token_version:3}]);
  expect(await readEventNotificationFocus(db as never,owner,row.id)).toBeNull();
  expect(tx.event.findFirst).not.toHaveBeenCalled();
});
it('holds a missing, foreign or unsupported target without disclosing event fields', async () => {
  const {tx,db} = fixture();
  tx.$queryRaw.mockReset().mockResolvedValueOnce([{family_id:owner.familyId,role:owner.role,token_version:2}])
    .mockResolvedValueOnce([{features:{}}]).mockResolvedValueOnce([]);
  expect(await readEventNotificationFocus(db as never,owner,'unavailable-event')).toBeNull();
  expect(tx.event.findFirst).not.toHaveBeenCalled();
});
it('holds invalid event intervals and ambiguous target input', async () => {
  const {tx,db} = fixture();
  tx.event.findFirst.mockResolvedValueOnce({...row,end_time:row.start_time});
  expect(await readEventNotificationFocus(db as never,owner,row.id)).toBeNull();
  expect(await readEventNotificationFocus(db as never,owner,['event-a','event-b'])).toBeNull();
  expect(db.$transaction).toHaveBeenCalledTimes(1);
});
