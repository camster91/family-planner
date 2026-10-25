// Pure source cases authored UNRUN.
import { readRecipeOwner, sameRecipeOwner, RECIPE_OWNER_PROTOCOL } from '../recipe-owner-contract';
const owner = { protocol: RECIPE_OWNER_PROTOCOL, actorId: 'parent-a', familyId: 'family-a', role: 'parent', generation: 0 };
it('requires a complete bounded owner marker and compares every authority dimension', () => {
  const parsed = readRecipeOwner(JSON.stringify(owner));
  expect(parsed).toEqual(owner); expect(sameRecipeOwner(parsed, parsed)).toBe(true);
  for (const value of [null, '', '{', 'x'.repeat(1025), JSON.stringify({ ...owner, generation: -1 }), JSON.stringify({ ...owner, extra: true })])
    expect(readRecipeOwner(value)).toBeNull();
  for (const change of [{ actorId: 'parent-b' }, { familyId: 'family-b' }, { role: 'teen' }, { generation: 1 }])
    expect(sameRecipeOwner(parsed, readRecipeOwner(JSON.stringify({ ...owner, ...change })))).toBe(false);
});
