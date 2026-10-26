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

// Authored UNRUN: original owner stays in canonical input and therefore receipt hashing.
it('preserves optional create-command ownership and refuses it without the create protocol', async () => {
  const { createRecipeSchema } = await import('../recipe-input-contract');
  const input = { title: 'Family soup', creation_protocol: 'herewoven.recipe-create.v1', creation_owner: owner, creation_issued_at: Date.now() };
  expect(createRecipeSchema.parse(input).creation_owner).toEqual(owner);
  expect(createRecipeSchema.safeParse({ title: 'Family soup', creation_owner: owner }).success).toBe(false);
  expect(createRecipeSchema.safeParse({ title: 'Legacy soup' }).success).toBe(true);
});

// Authored UNRUN: original timing is never supplied/renewed by a retry or read.
it('holds missing/future timing and refuses the exact one-day boundary', async () => {
  const { recipeCreateCommandTimeRefusal: refuse, RECIPE_CREATE_COMMAND_MAX_AGE_MS: age } = await import('../recipe-create-command-window');
  const command = { creation_owner: owner, creation_issued_at: 1000 };
  expect(refuse(command, 1000)).toBeNull();
  expect(refuse(command, 1000 + age - 1)).toBeNull();
  expect(refuse(command, 1000 + age)?.body.error.code).toBe('RECIPE_COMMAND_EXPIRED');
  expect(refuse(command, 999)?.body.error.code).toBe('RECIPE_COMMAND_TIME_UNCONFIRMED');
  expect(refuse({ creation_owner: owner }, 1000)?.body.error.code).toBe('RECIPE_COMMAND_TIME_UNCONFIRMED');
  expect(command.creation_issued_at).toBe(1000);
  expect(refuse({}, 1000)).toBeNull();
});

// Authored UNRUN: owner-bound edits retain strict version metadata, never a fallback body.
it('pairs edit protocol with original owner while retaining legacy edit requests', async () => {
  const { updateRecipeSchema, RECIPE_EDIT_PROTOCOL } = await import('../recipe-input-contract');
  const command = { title:'Updated soup', edit_protocol:RECIPE_EDIT_PROTOCOL, edit_owner:owner };
  expect(updateRecipeSchema.parse(command)).toEqual(command);
  expect(updateRecipeSchema.safeParse({ title:'Legacy edit' }).success).toBe(true);
  for (const input of [
    { title:'Missing protocol', edit_owner:owner },
    { title:'Missing owner', edit_protocol:RECIPE_EDIT_PROTOCOL },
    { ...command, edit_protocol:'herewoven.recipe-edit.v2' },
    { ...command, edit_owner:{ ...owner, generation:-1 } },
  ]) expect(updateRecipeSchema.safeParse(input).success).toBe(false);
});
