// Authored UNRUN: current household labels never come from event relation snapshots.
import { projectEventCreators } from '../event-people';
it('bounds related-person lookups and projects only current household names', async () => {
  const rows = Array.from({length:205},(_,index) => ({id:`event-${index}`,created_by:index % 2 ? 'current' : 'moved'}));
  const findMany = jest.fn(async () => [
    {id:'current',family_id:'family-a',name:'Current parent',privateExtra:'discard'},
    {id:'moved',family_id:'family-b',name:'Foreign private name'},
    {id:'unrequested',family_id:'family-a',name:'Unrelated private name'},
  ]);
  const result = await projectEventCreators({user:{findMany}} as never,'family-a',rows);
  expect(result).toHaveLength(205);
  expect(findMany).toHaveBeenCalledTimes(3);
  expect(result[0]).toEqual({...rows[0],creator:null});
  expect(result[1]).toEqual({...rows[1],creator:{id:'current',name:'Current parent'}});
  expect(JSON.stringify(result)).not.toContain('Foreign private name');
  expect(JSON.stringify(result)).not.toContain('Unrelated private name');
  expect(JSON.stringify(result)).not.toContain('privateExtra');
});
