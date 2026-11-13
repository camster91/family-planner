import { readD1ListItemTasks, setD1ListItemTask } from '../../../src/lib/cloudflare/list-tasks'
import { LIST_TASKS_READY_ENV } from '../../../src/lib/list-tasks'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
/** To-do owner and due date: real workerd/D1, two households, capability on and off. */
export async function testListTasks(db: D1Store) {
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code) VALUES ('task-a','Fixture','task-a'),('task-b','Other','task-b')`).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id,role,created_at) VALUES
    ('task-parent','task-parent@example.test','Parent','task-a','parent',1),
    ('task-teen','task-teen@example.test','Teen','task-a','teen',2),
    ('task-child','task-child@example.test','Child','task-a','child',3),
    ('task-foreign','task-foreign@example.test','PRIVATE FOREIGN NAME','task-b','parent',4)`).run()
  await db.prepare(`INSERT INTO "HouseholdMember" (id,family_id,name,role,created_at) VALUES
    ('task-kid','task-a','Kid','child',5),('task-archived','task-a','Archived','child',6),('task-foreign-kid','task-b','PRIVATE FOREIGN KID','child',7)`).run()
  await db.prepare(`UPDATE "HouseholdMember" SET archived_at=10 WHERE id='task-archived'`).run()
  await db.prepare(`INSERT INTO "List" (id,family_id,name,type,created_by) VALUES
    ('task-todo','task-a','Jobs','todo','task-parent'),('task-grocery','task-a','Groceries','grocery','task-parent'),
    ('task-foreign-list','task-b','PRIVATE B LIST','todo','task-foreign')`).run()
  await db.prepare(`INSERT INTO "ListItem" (id,list_id,content,added_by) VALUES
    ('task-i1','task-todo','Rake leaves','task-parent'),('task-i2','task-todo','Book dentist','task-parent'),
    ('task-milk','task-grocery','Milk','task-parent'),('task-fi','task-foreign-list','PRIVATE B ITEM','task-foreign')`).run()
  const actor = (userId: string, role: string, familyId = 'task-a') => ({ userId, familyId, role, generation: 0 })
  const parent = actor('task-parent', 'parent'), teen = actor('task-teen', 'teen'), child = actor('task-child', 'child'), foreign = actor('task-foreign', 'parent', 'task-b')
  const set = (who: ReturnType<typeof actor>, input: Parameters<typeof setD1ListItemTask>[1]) => setD1ListItemTask(who, input, db)
  type Row = { item_id: string; family_id: string; user_id: string | null; member_id: string | null; due_day: string | null }
  const stored = async () => (await db.prepare(`SELECT item_id,family_id,user_id,member_id,due_day FROM "ListItemTask" ORDER BY item_id`).all<Row>()).results
  const refused = async (sql: string) => { try { await db.prepare(sql).run(); return false } catch { return true } }
  type Body = { code?: string; task?: { owner: { kind: string; id: string; name: string } | null; due: string | null } }
  const body = (result: { body: unknown }) => result.body as Body

  // Off: refused before any write; nothing is read.
  process.env[LIST_TASKS_READY_ENV] = '0'
  const off = await set(parent, { itemId: 'task-i1', due: '2026-01-09' })
  check(off.status === 409 && body(off).code === 'LIST_TASKS_UNSUPPORTED' && (await stored()).length === 0 && (await readD1ListItemTasks('task-a', ['task-i1'], db)).size === 0, 'off refuses and reads nothing')
  process.env[LIST_TASKS_READY_ENV] = '1'

  // Set, change and clear.
  const first = await set(parent, { itemId: 'task-i1', owner: { kind: 'account', id: 'task-teen' }, due: '2026-01-09' })
  check(first.status === 200 && body(first).task?.owner?.name === 'Teen' && body(first).task?.due === '2026-01-09', 'parent sets owner and due day')
  const second = await set(teen, { itemId: 'task-i1', owner: { kind: 'profile', id: 'task-kid' } })
  const afterSecond = await stored()
  check(second.status === 200 && body(second).task?.owner?.name === 'Kid' && body(second).task?.due === '2026-01-09'
    && afterSecond.length === 1 && afterSecond[0].member_id === 'task-kid' && afterSecond[0].user_id === null && afterSecond[0].family_id === 'task-a', 'teen changes the owner to a profile; the due day stays')
  check((await set(parent, { itemId: 'task-i1', due: null })).status === 200 && (await stored())[0].due_day === null, 'due day cleared')
  check((await set(parent, { itemId: 'task-i1', owner: null })).status === 200 && (await stored()).length === 0, 'an empty task leaves no row')

  // Refusals write nothing.
  for (const [label, change] of [
    ['foreign account', { owner: { kind: 'account' as const, id: 'task-foreign' } }],
    ['foreign profile', { owner: { kind: 'profile' as const, id: 'task-foreign-kid' } }],
    ['archived profile', { owner: { kind: 'profile' as const, id: 'task-archived' } }],
    ['unknown person', { owner: { kind: 'account' as const, id: 'nobody' } }],
    ['unreal date', { due: '2026-02-30' }],
  ] as const) {
    const result = await set(parent, { itemId: 'task-i1', ...change })
    check(result.status === 400 && body(result).code === 'LIST_TASK_INVALID', `refuses ${label}`)
  }
  const kid = await set(child, { itemId: 'task-i1', due: '2026-01-09' })
  const grocery = await set(parent, { itemId: 'task-milk', due: '2026-01-09' })
  const theirs = await set(parent, { itemId: 'task-fi', due: '2026-01-09' })
  const outsider = await set(foreign, { itemId: 'task-i1', due: '2026-01-09' })
  const stale = await set({ ...parent, generation: 5 }, { itemId: 'task-i1', due: '2026-01-09' })
  check(kid.status === 403 && grocery.status === 409 && body(grocery).code === 'LIST_TASK_GROCERY' && theirs.status === 404 && outsider.status === 404 && stale.status === 401
    && (await stored()).length === 0, 'child, grocery item, other household and stale session refused; nothing written')

  // Reads are scoped; an owner who leaves stops showing.
  await set(parent, { itemId: 'task-i1', owner: { kind: 'account', id: 'task-teen' }, due: '2026-01-09' })
  await set(parent, { itemId: 'task-i2', due: '2026-02-01' })
  const read = await readD1ListItemTasks('task-a', ['task-i1', 'task-i2', 'task-fi'], db)
  check(read.size === 2 && read.get('task-i1')?.owner?.name === 'Teen' && read.get('task-i2')?.due === '2026-02-01' && read.get('task-i2')?.owner === null, 'reads the household\'s tasks only')
  check((await readD1ListItemTasks('task-b', ['task-i1', 'task-i2'], db)).size === 0, 'another household reads nothing')
  await db.prepare(`UPDATE "User" SET family_id=NULL WHERE id='task-teen'`).run()
  const gone = (await readD1ListItemTasks('task-a', ['task-i1'], db)).get('task-i1')
  check(gone?.owner === null && gone.due === '2026-01-09', 'an owner who left stops showing; the due day stays')
  await db.prepare(`UPDATE "User" SET family_id='task-a' WHERE id='task-teen'`).run()

  // The database guards the household and the row's shape.
  check(await refused(`INSERT INTO "ListItemTask" (item_id,family_id,user_id) VALUES ('task-milk','task-a','task-foreign')`), 'foreign account refused')
  check(await refused(`INSERT INTO "ListItemTask" (item_id,family_id,due_day) VALUES ('task-fi','task-a','2026-01-09')`), 'another household\'s item refused')
  check(await refused(`INSERT INTO "ListItemTask" (item_id,family_id,user_id,member_id) VALUES ('task-milk','task-a','task-parent','task-kid')`), 'two owners refused')
  check(await refused(`INSERT INTO "ListItemTask" (item_id,family_id) VALUES ('task-milk','task-a')`), 'empty row refused')
  check(await refused(`UPDATE "ListItemTask" SET user_id='task-foreign' WHERE item_id='task-i1'`), 'foreign account on update refused')
  check(await refused(`UPDATE "ListItemTask" SET family_id='task-b' WHERE item_id='task-i1'`), 'household is immutable')
  await db.prepare(`DELETE FROM "ListItem" WHERE id='task-i2'`).run()
  check((await stored()).map(r => r.item_id).join() === 'task-i1', 'deleting the item removes its task')
  delete process.env[LIST_TASKS_READY_ENV]
  return { off: true, setChangeClear: true, refusals: true, roles: true, scoped: true, leaverHidden: true, databaseGuard: true, cascade: true }
}
