import { readD1TodayBoard } from '../../../src/lib/cloudflare/today-board'
import type { D1Store } from '../../../src/lib/cloudflare/database'

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

/** Native local D1 board/read fixture. Every row is fabricated and household-scoped. */
export async function testBoardReads(db: D1Store) {
  const previousStorage = process.env.HEREWOVEN_STORAGE
  const previousWeather = process.env.WEATHER_ENABLED
  const previousProfile = process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED
  const previousProfileRollback = process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY
  process.env.HEREWOVEN_STORAGE = 'd1'
  process.env.WEATHER_ENABLED = '0'
  delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED
  delete process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY
  const now = new Date('2026-10-28T12:00:00.000Z')
  const today = Date.parse('2026-10-28T00:00:00.000Z')
  try {
    await db.batch([
      db.prepare(`INSERT INTO "Family" (id,name,invite_code,features,ambient_photo_ids,weather_enabled) VALUES
        ('board-family-a','Board A','board-code-a',?1,'["board-photo-a"]',0),
        ('board-family-b','Board B','board-code-b',?1,'[]',0),
        ('board-family-c','Board C','board-code-c',?2,'[]',0)`).bind(
          JSON.stringify({ chores: true, calendar: true, lists: true, meals: true, inventory: true }),
          JSON.stringify({ chores: true, calendar: true, lists: false, meals: false, inventory: false }),
        ),
      db.prepare(`INSERT INTO "User" (id,email,name,role,family_id,created_at) VALUES
        ('board-parent','board-parent@example.test','Board Parent','parent','board-family-a',?1),
        ('board-child','board-child@example.test','Board Child','child','board-family-a',?1),
        ('board-foreign','board-foreign@example.test','Private Foreign','parent','board-family-b',?1),
        ('board-gated-parent','board-gated-parent@example.test','Gated Parent','parent','board-family-c',?1)`).bind(today - 1000),
      db.prepare(`INSERT INTO "Upload" (id,family_id,filename,content_type,size_bytes) VALUES ('board-photo-a','board-family-a','abcdef0123456789.jpg','image/jpeg',10)`),
      db.prepare(`INSERT INTO "Event" (id,family_id,title,start_time,end_time,is_task,created_by) VALUES ('board-event-a','board-family-a','Family event',?1,?2,0,'board-parent'),('board-event-b','board-family-b','PRIVATE FOREIGN',?1,?2,0,'board-foreign')`).bind(now.getTime() + 3600000, now.getTime() + 7200000),
      db.prepare(`INSERT INTO "Chore" (id,family_id,title,assigned_to,created_by,due_date,status) VALUES ('board-chore-a','board-family-a','Board chore','board-child','board-parent',?1,'pending'),('board-chore-b','board-family-b','PRIVATE FOREIGN','board-foreign','board-foreign',?1,'pending')`).bind(today),
      db.prepare(`INSERT INTO "List" (id,family_id,name,type,created_by) VALUES ('board-list-a','board-family-a','Groceries','grocery','board-parent')`),
      db.prepare(`INSERT INTO "ListItem" (id,list_id,content,quantity,added_by) VALUES ('board-item-a','board-list-a','Milk',1,'board-parent')`),
      db.prepare(`INSERT INTO "Recipe" (id,family_id,title,prep_time,servings,created_by) VALUES ('board-recipe-a','board-family-a','Soup',20,2,'board-parent')`),
      db.prepare(`INSERT INTO "Ingredient" (id,family_id,name) VALUES ('board-ingredient-a','board-family-a','Milk'),('board-ingredient-b','board-family-a','Carrot')`),
      db.prepare(`INSERT INTO "RecipeIngredient" (id,recipe_id,ingredient_id,amount) VALUES ('board-ri-a','board-recipe-a','board-ingredient-a',1),('board-ri-b','board-recipe-a','board-ingredient-b',1)`),
      db.prepare(`INSERT INTO "FamilyMeal" (id,family_id,date,meal_type,recipe_name,recipe_id,cook_id,created_by) VALUES ('board-meal-a','board-family-a',?1,'dinner','Soup','board-recipe-a','board-parent','board-parent')`).bind(today),
      db.prepare(`INSERT INTO "InventoryItem" (id,family_id,name,ingredient_id,amount,location,expires_on,date_kind,status) VALUES ('board-inventory-a','board-family-a','Milk','board-ingredient-a',1,'fridge',?1,'best_before','active')`).bind(today + 86400000),
      db.prepare(`INSERT INTO "List" (id,family_id,name,type,created_by) VALUES ('board-list-c','board-family-c','Hidden groceries','grocery','board-gated-parent')`),
      db.prepare(`INSERT INTO "ListItem" (id,list_id,content,quantity,added_by) VALUES ('board-item-c','board-list-c','Must stay hidden',1,'board-gated-parent')`),
      db.prepare(`INSERT INTO "Event" (id,family_id,title,start_time,end_time,is_task,created_by) VALUES ('board-event-c','board-family-c','Gated event',?1,?2,0,'board-gated-parent')`).bind(now.getTime() + 3600000, now.getTime() + 7200000),
      db.prepare(`INSERT INTO "HouseholdMember" (id,family_id,name,role,age,board_color) VALUES ('board-profile-a','board-family-a','Little Board Member','child',3,'#7cc')`),
      db.prepare(`INSERT INTO "Chore" (id,family_id,title,assigned_to,assigned_member_id,created_by,due_date,status,frequency) VALUES ('board-profile-chore-a','board-family-a','Put away toys',NULL,'board-profile-a','board-parent',?1,'pending','once')`).bind(today),
    ])
    const person = await readD1TodayBoard({ familyId: 'board-family-a', role: 'parent', audience: 'person', memberProtocol: 1, now, withWeather: false }, db)
    check(person.data.events.length === 1 && person.data.events[0].id === 'board-event-a', 'person event isolation')
    check(person.data.chores.length === 1 && person.data.chores[0].id === 'board-chore-a', 'person chore isolation')
    check(person.data.dinners?.[0]?.missingIngredients === 1, 'dinner inventory projection')
    check(person.data.shopping?.total === 1 && person.data.shopping.items[0].content === 'Milk', 'shopping projection')
    check(person.data.display?.photos?.length === 1, 'person ambient photos')
    check(person.data.protocolError?.code === 'MEMBER_PROTOCOL_UNAVAILABLE', 'profile protocol compatibility refusal')
    check(!person.data.chores.some(chore => chore.id === 'board-profile-chore-a'), 'profile chore hidden from protocol 1')
    const device = await readD1TodayBoard({ familyId: 'board-family-a', audience: 'device', memberProtocol: 1, now, withWeather: false }, db)
    check(device.data.links.calendar === null && device.data.display?.photos === undefined, 'device privacy projection')
    check(device.data.dinners?.[0]?.missingIngredients === undefined, 'device dinner privacy')
    check(!JSON.stringify(device.data).includes('Private Foreign'), 'foreign household isolation')
    process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = '1'
    process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = '1'
    const profileBoard = await readD1TodayBoard({ familyId: 'board-family-a', role: 'parent', audience: 'person', memberProtocol: 2, now, withWeather: false }, db)
    check(profileBoard.data.members.some(member => member.id === 'profile:board-profile-a' && member.subject?.kind === 'profile'), 'profile member subject')
    check(profileBoard.data.chores.some(chore => chore.id === 'board-profile-chore-a' && chore.subject?.kind === 'profile'), 'profile chore protocol 2')
    check(!profileBoard.data.protocolError, 'profile protocol 2 accepted')
    const gated = await readD1TodayBoard({ familyId: 'board-family-c', role: 'parent', audience: 'person', memberProtocol: 2, now, withWeather: false }, db)
    check(gated.data.links.meals === null && gated.data.links.lists === null && gated.data.links.inventory === null, 'feature gate links')
    check(gated.data.dinners === null && gated.data.shopping === null && gated.data.useSoon === null, 'feature gate payload')
    check(gated.data.events.length === 1 && gated.data.events[0].id === 'board-event-c', 'core calendar remains visible')
    await db.batch([
      db.prepare(`UPDATE "Family" SET weather_enabled=1,weather_label='Fixture Weather',weather_unit='celsius',weather_latitude=43.70,weather_longitude=-79.40 WHERE id='board-family-a'`),
      db.prepare(`INSERT INTO "WeatherCache" (family_id,latitude,longitude,status,payload,fetched_at,updated_at) VALUES ('board-family-a',43.7,-79.4,'ok',?1,?2,?2)`).bind(JSON.stringify({ current: { temperatureC: 12.4, code: 1, isDay: true }, daily: [{ day: '2026-10-28', highC: 15, lowC: 7, code: 1, precipitationChance: 20 }], utcOffsetSeconds: -14400, timezone: 'America/Toronto' }), now.getTime() - 5 * 60 * 1000),
    ])
    process.env.WEATHER_ENABLED = '1'
    const weatherBoard = await readD1TodayBoard({ familyId: 'board-family-a', role: 'parent', audience: 'person', memberProtocol: 2, now, withWeather: true }, db)
    check(weatherBoard.data.weather?.label === 'Fixture Weather' && weatherBoard.data.weather.current.temperature === 12, 'fresh cached weather safe path')
    return { personIsolation: true, devicePrivacy: true, dinnerInventory: true, shopping: true, ambientPhotoGate: true, profileProtocol: true, featureGates: true, weatherCache: true }
  } finally {
    if (previousStorage === undefined) delete process.env.HEREWOVEN_STORAGE
    else process.env.HEREWOVEN_STORAGE = previousStorage
    if (previousWeather === undefined) delete process.env.WEATHER_ENABLED
    else process.env.WEATHER_ENABLED = previousWeather
    if (previousProfile === undefined) delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED
    else process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = previousProfile
    if (previousProfileRollback === undefined) delete process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY
    else process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = previousProfileRollback
  }
}
