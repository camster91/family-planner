/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecipeCuration } from "../RecipeCuration";
import { RecipeCollections } from "../RecipeCollections";
const owner = { protocol: "herewoven.recipe-owner.v1", actorId: "parent-a", familyId: "family-a", role: "parent", generation: 0 };
const response = (body: unknown, context = owner) => ({ ok: true, headers: new Headers({ "X-Herewoven-Recipe-Owner": JSON.stringify(context) }), json: async () => body });
test("an uncertain favorite write retains the choice and requires explicit refresh and review before another write", async () => {
  let revision = 0;
  let writes = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      writes++;
      if (writes === 1) {
        revision = 1;
        throw new Error("Fixture lost response");
      }
      const input = JSON.parse(String(init.body));
      return response({
        id: "fx_recipe",
        revision: 2,
        favorite: input.favorite,
        collectionIds: input.collectionIds,
      });
    }
    return String(url).endsWith("/collections")
      ? response({ collections: [] })
      : response({
          id: "fx_recipe",
          revision,
          favorite: false,
          collectionIds: [],
        });
  }) as unknown as typeof fetch;
  render(<RecipeCuration id="fx_recipe" title="Fixture soup" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Organize recipe: Fixture soup" }),
  );
  const checkbox = await screen.findByRole("checkbox", {
    name: "Household favorite",
  });
  await waitFor(() => expect(checkbox).toBeEnabled());
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
  await screen.findByRole("alert");
  expect(checkbox).toBeChecked();
  expect(writes).toBe(1);
  expect(screen.getByRole("button", { name: "Save choices" })).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh current settings" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save choices" })).toBeEnabled(),
  );
  expect(checkbox).toBeChecked();
  expect(writes).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
  await waitFor(() => expect(writes).toBe(2));
  const second = (global.fetch as jest.Mock).mock.calls.filter(
    ([, init]) => init?.method === "PATCH",
  )[1][1];
  expect(JSON.parse(second.body)).toEqual({
    revision: 1,
    favorite: true,
    collectionIds: [],
  });
});

// Original-read owner pairing cases authored UNRUN.
test('masks the sheet when parallel recipe and catalog reads belong to different owners', async () => {
  global.fetch = jest.fn(async (url: string) => String(url).endsWith('/collections')
    ? response({ collections: [{ id: 'private-other', name: 'Private collection' }] }, { ...owner, familyId: 'family-b' })
    : response({ id: 'fx_recipe', revision: 0, favorite: false, collectionIds: [] })) as unknown as typeof fetch;
  const held = jest.fn();
  render(<RecipeCuration id='fx_recipe' title='Fixture soup' onOwnerHold={held} />);
  fireEvent.click(screen.getByRole('button', { name: 'Organize recipe: Fixture soup' }));
  await screen.findByRole('button', { name: 'Reload page' });
  expect(screen.queryByText('Private collection')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save choices' })).toBeNull();
  expect(held).toHaveBeenCalledTimes(1);
});
test('refuses an older server without owner markers instead of enabling writes', async () => {
  global.fetch = jest.fn(async (url: string) => ({ ok: true, json: async () => String(url).endsWith('/collections') ? { collections: [] } : { id: 'fx_recipe', revision: 0, favorite: false, collectionIds: [] } })) as unknown as typeof fetch;
  render(<RecipeCuration id='fx_recipe' title='Fixture soup' />);
  fireEvent.click(screen.getByRole('button', { name: 'Organize recipe: Fixture soup' }));
  await screen.findByRole('button', { name: 'Reload page' });
  expect((global.fetch as jest.Mock).mock.calls.every(([, init]) => init?.method !== 'PATCH')).toBe(true);
  expect(screen.queryByRole('checkbox')).toBeNull();
});
test('sends the frozen owner on writes and cannot rebind an uncertain draft on refresh', async () => {
  let writes = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') { writes++; throw new Error('Fixture uncertain response'); }
    const nextOwner = writes ? { ...owner, actorId: 'parent-b' } : owner;
    return String(url).endsWith('/collections') ? response({ collections: [] }, nextOwner)
      : response({ id: 'fx_recipe', revision: writes, favorite: false, collectionIds: [] }, nextOwner);
  }) as unknown as typeof fetch;
  render(<RecipeCuration id='fx_recipe' title='Fixture soup' />);
  fireEvent.click(screen.getByRole('button', { name: 'Organize recipe: Fixture soup' }));
  const checkbox = await screen.findByRole('checkbox', { name: 'Household favorite' });
  await waitFor(() => expect(checkbox).toBeEnabled()); fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Save choices' }));
  await screen.findByRole('alert');
  const write = (global.fetch as jest.Mock).mock.calls.find(([, init]) => init?.method === 'PATCH')[1];
  expect(JSON.parse(write.headers['X-Herewoven-Recipe-Owner'])).toEqual(owner);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current settings' }));
  await screen.findByRole('button', { name: 'Reload page' });
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(writes).toBe(1);
});

// Collection-owner fixtures authored UNRUN during the no-QA pass.
test('collection management refuses a catalog without an owner marker', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, headers: new Headers(), json: async () => ({
    collections: [{ id: 'private-catalog', name: 'Private collection', revision: 0 }],
  }) })) as unknown as typeof fetch;
  render(<RecipeCollections value='' canEdit onSelect={jest.fn()} />);
  await screen.findByRole('button', { name: 'Reload page' });
  expect(screen.queryByText('Private collection')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Manage collections' })).toBeNull();
  expect((global.fetch as jest.Mock).mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
});
test('collection recovery keeps the first owner and masks a changed household after an uncertain write', async () => {
  let writes = 0;
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { writes++; throw new Error('Fixture lost response'); }
    return response({ collections: [{ id: 'collection-a', name: 'Household recipes', revision: 0 }] },
      writes ? { ...owner, familyId: 'family-b' } : owner);
  }) as unknown as typeof fetch;
  render(<RecipeCollections value='' canEdit onSelect={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Manage collections' }));
  const field = await screen.findByRole('textbox', { name: 'Collection name' });
  await waitFor(() => expect(field).toBeEnabled());
  fireEvent.change(field, { target: { value: 'Private draft name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create collection' }));
  await screen.findByRole('alert');
  expect(writes).toBe(1);
  const write = (global.fetch as jest.Mock).mock.calls.find(([, init]) => init?.method === 'POST')[1];
  expect(JSON.parse(write.headers['X-Herewoven-Recipe-Owner'])).toEqual(owner);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current settings' }));
  await screen.findByRole('button', { name: 'Reload page' });
  expect(screen.queryByDisplayValue('Private draft name')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create collection' })).toBeNull();
  const refresh = (global.fetch as jest.Mock).mock.calls.at(-1)[1];
  expect(JSON.parse(refresh.headers['X-Herewoven-Recipe-Owner'])).toEqual(owner);
  expect(writes).toBe(1);
});
