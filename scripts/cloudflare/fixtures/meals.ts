import {
  confirmD1CreatedMeal,
  createD1Meal,
  createD1MealWithReceipt,
  deleteD1Meal,
  readD1MealState,
  readD1Meals,
  updateD1Meal,
} from '../../../src/lib/cloudflare/meals'
import { encodeMealCursor } from '../../../src/lib/meal-paging'
import type { D1Store } from '../../../src/lib/cloudflare/database'
import { mutateD1MealPrep, readD1BatchRecipeHistory, readD1MealPrep } from '../../../src/lib/cloudflare/meal-bulk'
import { IDEMPOTENCY_TTL_MS } from '../../../src/lib/idempotency-key'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const actor = { userId: 'meal-parent', familyId: 'meal-family-a', role: 'parent', generation: 0 }

/** Disposable D1 coverage for ordinary meals and the separate bulk/prep
 * lifecycle. The caller owns the isolated database and fixture household. */
export async function testMeals(db: D1Store) {
  const start = new Date('2026-10-20T00:00:00.000Z')
  const end = new Date('2026-10-27T00:00:00.000Z')
  await db.prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES
    ('meal-family-a','Meal A','meal-a','{"meals":true}'),
    ('meal-family-b','Meal B','meal-b','{"meals":true}')`).run()
  await db.prepare(`INSERT INTO "User"(id,email,name,family_id,role,email_verified) VALUES
    ('meal-parent','meal-parent@example.test','Meal Parent','meal-family-a','parent',1),
    ('meal-teen','meal-teen@example.test','Meal Teen','meal-family-a','teen',1),
    ('meal-other','meal-other@example.test','Other Parent','meal-family-b','parent',1)`).run()
  await db.prepare(`INSERT INTO "Recipe"(id,family_id,title,prep_time,cook_time,servings,created_by) VALUES
    ('meal-recipe-a','meal-family-a','Family Soup',10,20,4,'meal-parent'),
    ('meal-recipe-b','meal-family-b','Foreign Soup',1,1,2,'meal-other')`).run()
  await db.prepare(`INSERT INTO "Ingredient"(id,family_id,name,unit) VALUES ('meal-ingredient-a','meal-family-a','Carrot','piece')`).run()
  await db.prepare(`INSERT INTO "RecipeIngredient"(id,recipe_id,ingredient_id,amount,unit,note) VALUES ('meal-recipe-ingredient-a','meal-recipe-a','meal-ingredient-a',2,'piece','diced')`).run()
  await db.prepare(`INSERT INTO "FamilyMeal"(id,family_id,date,meal_type,recipe_name,recipe_id,cook_id,created_by,created_at,updated_at) VALUES
    ('meal-a','meal-family-a',?1,'dinner','Soup','meal-recipe-a','meal-parent','meal-parent',?1,?1),
    ('meal-a-duplicate','meal-family-a',?1,'dinner','Salad',NULL,'meal-teen','meal-parent',?2,?2),
    ('meal-b','meal-family-b',?1,'dinner','Other','meal-recipe-b','meal-other','meal-other',?1,?1)`).bind(start.getTime(), start.getTime() + 1).run()

  const rows = await readD1Meals(actor, { start, end }, db)
  check(rows.length === 2, 'range reader keeps both meals in one slot and isolates family')
  check(rows[0].recipe?.title === 'Family Soup' && rows[0].cook?.name === 'Meal Parent', 'recipe and cook summaries are household scoped')
  const page = await readD1Meals(actor, { start, end, limit: 1 }, db)
  check(page.length === 2, 'paged reader fetches one row plus continuation witness')
  const cursor = encodeMealCursor({ familyId: actor.familyId, start, end }, page[0])
  const next = await readD1Meals(actor, { start, end, limit: 1, cursor: { date: page[0].date, createdAt: page[0].created_at, id: page[0].id } }, db)
  check(next.length === 1 && next[0].id !== page[0].id, 'keyset cursor advances without duplicates')
  check(cursor.length > 0, 'cursor remains an opaque bounded token')

  const created = await createD1Meal(actor, {
    date: '2026-10-23', meal_type: 'lunch', recipe_name: 'Quick lunch', notes: null,
    cook_id: 'meal-teen', recipe_id: 'meal-recipe-a', servings: 3,
  }, 'meal-create-fixture-key', db)
  check(created.status === 201 && (created.body as any).meal.recipe_id === 'meal-recipe-a', 'ordinary create links same-family recipe')
  const replay = await createD1Meal(actor, {
    date: '2026-10-23', meal_type: 'lunch', recipe_name: 'Quick lunch', notes: null,
    cook_id: 'meal-teen', recipe_id: 'meal-recipe-a', servings: 3,
  }, 'meal-create-fixture-key', db)
  check(replay.replayed === true && replay.status === 201, 'ordinary keyed create replays exactly once')
  const createdId = (created.body as any).meal.id as string

  const foreignRecipe = await createD1Meal(actor, { date: '2026-10-23', meal_type: 'snack', recipe_id: 'meal-recipe-b' }, null, db)
  check(foreignRecipe.status === 400, 'foreign recipe is refused without disclosure')
  const foreignUpdate = await updateD1Meal(actor, { id: 'meal-a', recipe_id: 'meal-recipe-b' }, null, db)
  check(foreignUpdate.status === 400, 'foreign recipe update is refused')
  const updated = await updateD1Meal(actor, { id: 'meal-a', notes: 'Updated note', servings: 5 }, 'meal-update-fixture-key', db)
  check(updated.status === 200 && (updated.body as any).meal.notes === 'Updated note', 'ordinary update commits with optimistic target check')
  const deleted = await deleteD1Meal(actor, createdId, null, undefined, db)
  check(deleted.status === 200, 'ordinary delete commits')
  check((await readD1MealState(actor, createdId, undefined, db)).state === 'missing', 'deleted ordinary meal is not readable')

  const issuedAt = new Date().toISOString()
  const keyedInput = {
    protocol: 'herewoven.meal-create.v1', expected_user_id: actor.userId,
    expected_family_id: actor.familyId, issued_at: issuedAt,
    date: '2026-10-24', meal_type: 'dinner', recipe_name: 'Keyed dinner',
  } as const
  const keyed = await createD1MealWithReceipt(actor, keyedInput, 'meal-receipt-fixture-key', db)
  check(keyed.status === 201 && (keyed.body as any).mealId, 'dedicated create receipt commits')
  const keyedId = (keyed.body as any).mealId as string
  const confirmed = await confirmD1CreatedMeal(actor, keyed, db)
  check(confirmed.status === 201, 'dedicated create confirms current meal')
  const foreignReceipt = await createD1MealWithReceipt(actor, { ...keyedInput, recipe_id: 'meal-recipe-b' }, 'meal-receipt-foreign-recipe', db)
  check(foreignReceipt.status === 400 && JSON.stringify(foreignReceipt.body) === JSON.stringify({ error: { code: 'RECIPE_UNAVAILABLE' } }), 'receipt foreign recipe keeps canonical error shape')
  const expiredReceipt = await createD1MealWithReceipt(actor, { ...keyedInput, issued_at: new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString() }, 'meal-receipt-expired', db)
  check(expiredReceipt.status === 409 && JSON.stringify(expiredReceipt.body) === JSON.stringify({ error: { code: 'MEAL_INTENT_EXPIRED' } }), 'receipt expiry keeps canonical error shape')
  check((await deleteD1Meal(actor, keyedId, null, undefined, db)).status === 200, 'receipt target can be deleted normally')
  const replayAfterDelete = await confirmD1CreatedMeal(actor, await createD1MealWithReceipt(actor, keyedInput, 'meal-receipt-fixture-key', db), db)
  check(replayAfterDelete.status === 409 && (replayAfterDelete.body as any).error.code === 'MEAL_NO_LONGER_AVAILABLE', 'receipt replay never recreates deleted meal')

  check((await readD1MealState({ ...actor, familyId: 'meal-family-b', userId: 'meal-other' }, 'meal-a', undefined, db)).response?.status === 403, 'exact detail read refuses foreign household')
  const prepInput = {
    expected_user_id: actor.userId,
    expected_family_id: actor.familyId,
    prepared_on: '2026-10-20',
    next_prep_on: '2026-10-27',
    dishes: [{ name: 'Batch soup', total_servings: 4, reserve_storage: 'fridge' as const, recipe_id: 'meal-recipe-a', meals: [] }],
  }
  const prep = await mutateD1MealPrep(actor, prepInput, 'meal-prep-create-fixture', db)
  check(prep.status === 201 && (prep.body as any).batchIds.length === 1, 'bulk prep session create')
  const prepReplay = await mutateD1MealPrep(actor, prepInput, 'meal-prep-create-fixture', db)
  check(prepReplay.replayed === true, 'bulk prep create replay')
  const sessionId = (prep.body as any).sessionId as string
  const batchId = (prep.body as any).batchIds[0] as string
  const prepared = await mutateD1MealPrep(actor, { expected_user_id: actor.userId, expected_family_id: actor.familyId, action: 'prepared', session_id: sessionId }, 'meal-prep-prepared-fixture', db)
  check(prepared.status === 200, 'bulk prepared transition')
  const history = await readD1BatchRecipeHistory(actor, batchId, db)
  check(history.status === 200 && (history.body as any).state === 'recorded' && (history.body as any).snapshot.recipe.ingredients[0].ingredient.name === 'Carrot', 'bulk recipe snapshot history')
  const allocation = await mutateD1MealPrep(actor, { expected_user_id: actor.userId, expected_family_id: actor.familyId, action: 'allocate', batch_id: batchId, meals: [{ date: '2026-10-21', meal_type: 'dinner', servings: 2 }] }, 'meal-prep-allocate-fixture', db)
  check(allocation.status === 201 && (allocation.body as any).mealIds.length === 1, 'bulk portion allocation')
  const mealId = (allocation.body as any).mealIds[0] as string
  const eaten = await mutateD1MealPrep(actor, { expected_user_id: actor.userId, expected_family_id: actor.familyId, action: 'eaten', batch_id: batchId, meal_id: mealId, servings: 1 }, 'meal-prep-eaten-fixture', db)
  check(eaten.status === 201 && (eaten.body as any).consumptionId, 'bulk eaten transition')
  const consumptionId = (eaten.body as any).consumptionId as string
  const undone = await mutateD1MealPrep(actor, { expected_user_id: actor.userId, expected_family_id: actor.familyId, action: 'undo-eaten', consumption_id: consumptionId }, 'meal-prep-undo-fixture', db)
  check(undone.status === 200, 'bulk eaten undo')
  const nextPrep = await mutateD1MealPrep(actor, { expected_user_id: actor.userId, expected_family_id: actor.familyId, action: 'next-prep', session_id: sessionId, expected_next_prep_on: '2026-10-27', next_prep_on: '2026-11-03' }, 'meal-prep-next-fixture', db)
  check(nextPrep.status === 200, 'bulk next prep update')
  const prepRead = await readD1MealPrep(actor, { sessionId }, db)
  check(prepRead.status === 200 && (prepRead.body as any).sessions[0].batches[0].meals.length === 1, 'bulk prep reader')
  return { range: true, paging: true, ownership: true, recipeLinks: true, idempotency: true, deletionConfirmation: true, bulkPrep: true }
}
