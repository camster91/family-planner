// Canonical ingredient resolution source cases authored UNRUN; no DB writes run.
import { resolveIngredientLines, RecipeInputError } from "../recipes";
function catalogDb(rows: Array<{ id: string; name: string; family_id: string }>) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    ingredient: {
      findMany: jest.fn(async (input: any) => rows.filter(row => row.family_id === input.where.family_id &&
        (!input.where.id?.gt || row.id > input.where.id.gt) &&
        (!input.where.id?.in || input.where.id.in.includes(row.id)))
        .sort((a, b) => a.id.localeCompare(b.id)).slice(0, input.take ?? rows.length)),
      upsert: jest.fn(async () => ({ id: "created-local" })),
    },
  };
}
const row = (index: number) => ({ id: `ingredient-${String(index).padStart(5, '0')}`, family_id: 'family-a', name: `Other ${index}` });
it('finds late Unicode/whitespace matches across bounded pages without creating duplicates', async () => {
  const rows = Array.from({ length: 1200 }, (_, index) => row(index));
  rows[510].name = '  CAFE\u0301   beans ';
  rows[1010].name = 'RICE';
  rows.push({ id: 'foreign', family_id: 'family-b', name: 'Rice' });
  const tx = catalogDb(rows);
  const result = await resolveIngredientLines(tx as any, 'family-a', [{ name: 'café beans', amount: 2 }, { name: ' rice ', amount: 1 }]);
  expect(result.map(line => line.ingredient_id)).toEqual([rows[510].id, rows[1010].id]);
  expect(tx.ingredient.findMany).toHaveBeenCalledTimes(3);
  for (const [input] of tx.ingredient.findMany.mock.calls) {
    expect(input.take).toBe(500); expect(input.where.family_id).toBe('family-a');
  }
  expect(tx.ingredient.upsert).not.toHaveBeenCalled();
});
it('stops once requested matches are found and still exhausts the catalog before creating a missing name', async () => {
  const rows = Array.from({ length: 1200 }, (_, index) => row(index));
  rows[1].name = 'Rice';
  const existing = catalogDb(rows);
  await resolveIngredientLines(existing as any, 'family-a', [{ name: 'RICE', amount: 1 }]);
  expect(existing.ingredient.findMany).toHaveBeenCalledTimes(1);
  const missing = catalogDb(rows);
  expect((await resolveIngredientLines(missing as any, 'family-a', [{ name: 'Missing spice', amount: 1 }]))[0].ingredient_id).toBe('created-local');
  expect(missing.ingredient.findMany).toHaveBeenCalledTimes(3);
  expect(missing.ingredient.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { family_id_name: { family_id: 'family-a', name: 'Missing spice' } }, update: {} }));
});
it('preserves duplicate-line rejection after canonical name reuse', async () => {
  const tx = catalogDb([{ ...row(1), name: 'Rice' }]);
  await expect(resolveIngredientLines(tx as any, 'family-a', [{ name: 'Rice', amount: 1 }, { name: ' RICE ', amount: 2 }])).rejects.toBeInstanceOf(RecipeInputError);
  expect(tx.ingredient.upsert).not.toHaveBeenCalled();
});
