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

// Authored UNRUN: legacy pointers do not acquire inferred insertion identity.
it('requires stored recipe birth identity without inventing one for legacy receipts', async () => {
  const { readRecipeCreateReceiptIdentity } = await import('../recipe-create-receipt-identity');
  const identity = { recipeId: 'recipe-a', recipeGeneration: '33f917f8-028d-4d85-b05b-27d67cc1de84' };
  expect(readRecipeCreateReceiptIdentity(identity)).toEqual(identity);
  for (const value of [null, [], { recipeId: 'recipe-a' }, { ...identity, recipeGeneration: 'bad' }, { ...identity, recipeId: '../recipe-a' }])
    expect(readRecipeCreateReceiptIdentity(value)).toBeNull();
});
