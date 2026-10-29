import { loadD1AssistantTodayContext } from '../../../src/lib/cloudflare/assistant-context'
import type { AssistantSourceRow } from '../../../src/lib/assistant-references'
import { buildAssistantReferenceCatalog } from '../../../src/lib/assistant-references'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
export async function testAssistantContext(database: D1Store) {
  const db = database
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code,features) VALUES ('ai-read-a','Fixture','ai-read-a',?1),('ai-read-b','Other','ai-read-b',?1)`)
    .bind(JSON.stringify({ calendar: true, chores: true, meals: true, lists: true, inventory: true })).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id,role) VALUES
    ('ai-read-parent','ai-read-parent@example.test','Parent','ai-read-a','parent'),
    ('ai-read-teen','ai-read-teen@example.test','Teen','ai-read-a','teen'),
    ('ai-read-other','ai-read-other@example.test','PRIVATE FOREIGN PERSON','ai-read-b','parent')`).run()
  const now = new Date('2026-10-28T16:00:00Z'), day = Date.parse('2026-10-28T00:00:00Z')
  await db.prepare(`INSERT INTO "Event" (id,family_id,title,start_time,end_time,created_by) VALUES
    ('ai-read-event','ai-read-a','Family outing',?1,?2,'ai-read-parent'),
    ('ai-read-foreign-event','ai-read-b','PRIVATE FOREIGN EVENT',?1,?2,'ai-read-other')`).bind(now.getTime(), now.getTime() + 3600000).run()
  await db.prepare(`INSERT INTO "Chore" (id,family_id,title,due_date,created_by,assigned_to) VALUES
    ('ai-read-chore-parent','ai-read-a','Parent chore',?1,'ai-read-parent','ai-read-parent'),
    ('ai-read-chore-teen','ai-read-a','Teen chore',?1,'ai-read-parent','ai-read-teen'),
    ('ai-read-foreign-chore','ai-read-b','PRIVATE FOREIGN CHORE',?1,'ai-read-other','ai-read-other')`).bind(day).run()
  await db.prepare(`INSERT INTO "Recipe" (id,family_id,title,prep_time,created_by) VALUES ('ai-read-recipe','ai-read-a','Soup',15,'ai-read-parent')`).run()
  await db.prepare(`INSERT INTO "FamilyMeal" (id,family_id,date,meal_type,recipe_id,cook_id,created_by) VALUES
    ('ai-read-dinner','ai-read-a',?1,'dinner','ai-read-recipe','ai-read-parent','ai-read-parent')`).bind(day).run()
  await db.prepare(`INSERT INTO "List" (id,family_id,name,type,created_by) VALUES ('ai-read-list','ai-read-a','Groceries','grocery','ai-read-parent')`).run()
  await db.prepare(`INSERT INTO "ListItem" (id,list_id,content,quantity,added_by) VALUES ('ai-read-item','ai-read-list','Apples',3,'ai-read-parent')`).run()
  await db.prepare(`INSERT INTO "InventoryItem" (id,family_id,name,expires_on,amount,added_by) VALUES ('ai-read-inventory','ai-read-a','Milk',?1,1,'ai-read-parent')`).bind(day + 86400000).run()
  let sources: AssistantSourceRow[] = []
  const input = { userId: 'ai-read-parent', familyId: 'ai-read-a', role: 'parent', serverNow: now,
    viewerTimeZone: 'America/Toronto', surface: 'person' as const, materializeSeries: false,
    onSources: (rows: AssistantSourceRow[]) => { sources = rows } }
  const binding = database as unknown as NonNullable<Parameters<typeof loadD1AssistantTodayContext>[1]>
  const parent = await loadD1AssistantTodayContext(input, binding)
  check(parent?.today.events[0]?.title === 'Family outing' && parent.today.chores.length === 2, 'events and chores')
  check(parent.today.dinner?.title === 'Soup' && parent.today.dinner.prepMinutes === 15 && parent.today.dinner.cook === 'Parent', 'nested dinner recipe and cook')
  check(parent.today.groceries[0]?.item === 'Apples' && parent.today.groceries[0].quantity === 3 && parent.today.useSoon[0]?.item === 'Milk', 'grocery and inventory')
  check(sources.length === 6 && sources.every(row => !row.id.includes('foreign')), 'complete current reference inputs')
  const catalog = buildAssistantReferenceCatalog(sources, { userId: input.userId, familyId: input.familyId, role: input.role, generation: 0 }, now.toISOString(), 'fabricated-reference-key')
  check(catalog.length === 6 && new Set(catalog.map(row => row.provider.ref)).size === 6, 'opaque reference catalog')
  check(!JSON.stringify(parent).includes('PRIVATE FOREIGN') && !JSON.stringify(parent).includes('ai-read-'), 'no private ids or other household data in provider projection')
  const teen = await loadD1AssistantTodayContext({ ...input, userId: 'ai-read-teen', role: 'teen' }, binding)
  check(teen?.today.chores.length === 1 && teen.today.chores[0].title === 'Teen chore' && teen.today.chores[0].assignee === 'You' && teen.today.dinner?.cook === 'Another household member', 'teen capability projection')
  check(await loadD1AssistantTodayContext({ ...input, role: 'child' }, binding) === null && await loadD1AssistantTodayContext({ ...input, surface: 'paired-device' }, binding) === null, 'child and shared-device refusal')
  check(await loadD1AssistantTodayContext({ ...input, familyId: 'ai-read-b' }, binding) === null, 'household claim cannot rebind')
  check((await loadD1AssistantTodayContext({ ...input, materializeSeries: true }, binding))?.today.chores.length === 2, 'native recurring writer supports the normal Today context path')
  await db.prepare(`UPDATE "Family" SET features=json_set(features,'$.chores',json('false'),'$.meals',json('false'),'$.inventory',json('false')) WHERE id='ai-read-a'`).run()
  const simple = await loadD1AssistantTodayContext({ ...input, materializeSeries: true }, binding)
  check(simple?.today.chores.length === 0 && simple.today.dinner === null && simple.today.useSoon.length === 0 && simple.today.unavailable.includes('dinner'), 'disabled features do not query/project domains')
  return { sixDomainProjection: true, referenceCatalog: 6, teenPrivacy: true, householdIsolation: true, childAndDeviceRefusal: true, nativeMaterializerAvailable: true, featureGates: true }
}
