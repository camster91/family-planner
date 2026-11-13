// To-do owner and due date against disposable Postgres: scoped to one household, parents and teens only.
import { assertFixtureTargetAllowed } from '@/lib/fixtures/guard'
import { LIST_TASKS_READY_ENV } from '@/lib/list-tasks'
export {}
const dbSuite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip
jest.setTimeout(60000)
dbSuite('to-dos (Postgres)', () => {
  let db: NonNullable<typeof import('@/lib/prisma').prisma>
  let tasks: typeof import('@/lib/list-tasks-db')
  const A = 'task-pg-family-a', B = 'task-pg-family-b'
  const P = 'task-pg-parent', T = 'task-pg-teen', C = 'task-pg-child', F = 'task-pg-foreign'
  const KID = 'task-pg-kid', ARCHIVED = 'task-pg-archived', FKID = 'task-pg-foreign-kid'
  const actor = (id: string, role: string, familyId = A) => ({ familyId, addedBy: id, role, generation: 0 })
  const parent = actor(P, 'parent'), teen = actor(T, 'teen'), child = actor(C, 'child'), foreign = actor(F, 'parent', B)
  const set = (who: ReturnType<typeof actor>, input: Parameters<typeof tasks.setListItemTask>[2]) => tasks.setListItemTask(db, who, input)
  const stored = () => db.listItemTask.findMany({ where: { family_id: { in: [A, B] } }, orderBy: { item_id: 'asc' }, select: { item_id: true, family_id: true, user_id: true, member_id: true, due_day: true } })
  const clean = async () => {
    await db.family.deleteMany({ where: { id: { in: [A, B] } } })
    await db.user.deleteMany({ where: { id: { in: [P, T, C, F] } } })
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env)
    db = (await import('@/lib/prisma')).prisma!
    tasks = await import('@/lib/list-tasks-db')
    await clean()
    await db.family.createMany({ data: [{ id: A, name: 'Task A', invite_code: A }, { id: B, name: 'Task B', invite_code: B }] })
    await db.user.createMany({ data: [
      { id: P, email: 'task-pg-parent@example.test', name: 'Parent', role: 'parent', family_id: A, created_at: new Date(1000) },
      { id: T, email: 'task-pg-teen@example.test', name: 'Teen', role: 'teen', family_id: A, created_at: new Date(2000) },
      { id: C, email: 'task-pg-child@example.test', name: 'Child', role: 'child', family_id: A, created_at: new Date(3000) },
      { id: F, email: 'task-pg-foreign@example.test', name: 'PRIVATE FOREIGN NAME', role: 'parent', family_id: B, created_at: new Date(4000) },
    ] })
    await db.householdMember.createMany({ data: [
      { id: KID, family_id: A, name: 'Kid', role: 'child' },
      { id: ARCHIVED, family_id: A, name: 'Archived', role: 'child', archived_at: new Date(5000) },
      { id: FKID, family_id: B, name: 'PRIVATE FOREIGN KID', role: 'child' },
    ] })
    await db.list.createMany({ data: [
      { id: 'task-pg-todo', family_id: A, name: 'Jobs', type: 'todo', created_by: P },
      { id: 'task-pg-grocery', family_id: A, name: 'Groceries', type: 'grocery', created_by: P },
      { id: 'task-pg-foreign-list', family_id: B, name: 'PRIVATE B LIST', type: 'todo', created_by: F },
    ] })
    await db.listItem.createMany({ data: [
      { id: 'task-pg-i1', list_id: 'task-pg-todo', content: 'Rake leaves', added_by: P },
      { id: 'task-pg-i2', list_id: 'task-pg-todo', content: 'Book dentist', added_by: P },
      { id: 'task-pg-milk', list_id: 'task-pg-grocery', content: 'Milk', added_by: P },
      { id: 'task-pg-fi', list_id: 'task-pg-foreign-list', content: 'PRIVATE B ITEM', added_by: F },
    ] })
  })
  beforeEach(async () => {
    process.env[LIST_TASKS_READY_ENV] = '1'
    await db.listItemTask.deleteMany({ where: { family_id: { in: [A, B] } } })
  })
  afterAll(async () => {
    delete process.env[LIST_TASKS_READY_ENV]
    if (!db) return
    await clean()
    await db.$disconnect()
  })

  it('capability off: refuses before any write and reads nothing', async () => {
    await db.listItemTask.create({ data: { item_id: 'task-pg-i1', family_id: A, due_day: '2026-01-09' } })
    process.env[LIST_TASKS_READY_ENV] = '0'
    expect(await set(parent, { itemId: 'task-pg-i2', due: '2026-01-09' })).toMatchObject({ status: 409, body: { code: 'LIST_TASKS_UNSUPPORTED' } })
    expect((await tasks.readListItemTasks(db, A, ['task-pg-i1'])).size).toBe(0)
    expect(await stored()).toHaveLength(1)
  })

  it('sets, changes and clears an owner and a due day; an empty task leaves no row', async () => {
    expect(await set(parent, { itemId: 'task-pg-i1', owner: { kind: 'account', id: T }, due: '2026-01-09' }))
      .toMatchObject({ status: 200, body: { task: { owner: { kind: 'account', id: T, name: 'Teen' }, due: '2026-01-09' } } })
    expect(await set(teen, { itemId: 'task-pg-i1', owner: { kind: 'profile', id: KID } }))
      .toMatchObject({ status: 200, body: { task: { owner: { kind: 'profile', id: KID, name: 'Kid' }, due: '2026-01-09' } } })
    expect(await stored()).toEqual([{ item_id: 'task-pg-i1', family_id: A, user_id: null, member_id: KID, due_day: '2026-01-09' }])
    expect(await set(parent, { itemId: 'task-pg-i1', due: null })).toMatchObject({ status: 200, body: { task: { owner: { id: KID }, due: null } } })
    expect(await set(parent, { itemId: 'task-pg-i1', owner: null })).toMatchObject({ status: 200, body: { task: { owner: null, due: null } } })
    expect(await stored()).toHaveLength(0)
    await set(parent, { itemId: 'task-pg-i2', due: '2026-02-01' })
    const read = await tasks.readListItemTasks(db, A, ['task-pg-i1', 'task-pg-i2', 'task-pg-fi'])
    expect([...read.entries()]).toEqual([['task-pg-i2', { owner: null, due: '2026-02-01' }]])
  })

  it.each([
    ['a person from another household', { owner: { kind: 'account' as const, id: F } }],
    ['a profile from another household', { owner: { kind: 'profile' as const, id: FKID } }],
    ['an archived profile', { owner: { kind: 'profile' as const, id: ARCHIVED } }],
    ['an unknown person', { owner: { kind: 'account' as const, id: 'nobody' } }],
    ['a date that does not exist', { due: '2026-02-30' }],
  ])('refuses %s and writes nothing', async (_label, change) => {
    expect(await set(parent, { itemId: 'task-pg-i1', ...change })).toMatchObject({ status: 400, body: { code: 'LIST_TASK_INVALID' } })
    expect(await stored()).toHaveLength(0)
  })

  it('refuses a child, a grocery item, another household\'s item and a stale session', async () => {
    expect((await set(child, { itemId: 'task-pg-i1', due: '2026-01-09' })).status).toBe(403)
    expect(await set(parent, { itemId: 'task-pg-milk', due: '2026-01-09' })).toMatchObject({ status: 409, body: { code: 'LIST_TASK_GROCERY' } })
    expect((await set(parent, { itemId: 'task-pg-fi', due: '2026-01-09' })).status).toBe(404)
    expect((await set(foreign, { itemId: 'task-pg-i1', due: '2026-01-09' })).status).toBe(404)
    expect((await set({ ...parent, generation: 5 }, { itemId: 'task-pg-i1', due: '2026-01-09' })).status).toBe(401)
    expect(await stored()).toHaveLength(0)
  })

  it('an owner who leaves stops showing; deleting the item or the account removes the row; the database guards the household', async () => {
    await set(parent, { itemId: 'task-pg-i1', owner: { kind: 'account', id: T }, due: '2026-01-09' })
    await db.user.update({ where: { id: T }, data: { family_id: null } })
    expect((await tasks.readListItemTasks(db, A, ['task-pg-i1'])).get('task-pg-i1')).toEqual({ owner: null, due: '2026-01-09' })
    await db.user.update({ where: { id: T }, data: { family_id: A } })
    await expect(db.listItemTask.create({ data: { item_id: 'task-pg-i2', family_id: A, user_id: F } })).rejects.toThrow()
    await expect(db.listItemTask.create({ data: { item_id: 'task-pg-fi', family_id: A, due_day: '2026-01-09' } })).rejects.toThrow()
    await expect(db.listItemTask.create({ data: { item_id: 'task-pg-i2', family_id: A, user_id: P, member_id: KID } })).rejects.toThrow()
    await expect(db.listItemTask.create({ data: { item_id: 'task-pg-i2', family_id: A } })).rejects.toThrow()
    await expect(db.listItemTask.update({ where: { item_id: 'task-pg-i1' }, data: { user_id: F } })).rejects.toThrow()
    const extra = await db.listItem.create({ data: { list_id: 'task-pg-todo', content: 'Temp', added_by: P } })
    await db.listItemTask.create({ data: { item_id: extra.id, family_id: A, due_day: '2026-03-01' } })
    await db.listItem.delete({ where: { id: extra.id } })
    expect((await stored()).map((row) => row.item_id)).toEqual(['task-pg-i1'])
  })
})
