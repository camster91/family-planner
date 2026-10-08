// Real-Postgres checks for visible sync and the calm display (#271) where the
// fake DB cannot prove the behaviour: the additive Family columns from
// scripts/migrate.js (defaults, the TEXT[] photo ids through the pg driver
// adapter), and a version that is stable for unchanged data, moves for a
// ticked chore or a deleted grocery row, ignores another household, and never
// reads photos for the device audience.
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...
// against a disposable database that `node scripts/migrate.js` has prepared.

export {}

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('board snapshot against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let lib: typeof import('@/app/dashboard/today/board-snapshot')

  const FAM = 'bsint-family'
  const FAM2 = 'bsint-family-2'
  const USER = 'bsint-user'
  const USER2 = 'bsint-user-2'
  const NOW = new Date()
  const TOMORROW = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + 1))

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [USER, USER2] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    lib = await import('@/app/dashboard/today/board-snapshot')
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Bs Int', invite_code: 'bsint-invite' },
        { id: FAM2, name: 'Bs Int 2', invite_code: 'bsint-invite-2' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: USER, email: 'u@bsint.test', name: 'U', role: 'parent', family_id: FAM },
        { id: USER2, email: 'u2@bsint.test', name: 'U2', role: 'parent', family_id: FAM2 },
      ],
    })
    await prisma.chore.createMany({
      data: [
        { id: 'bsint-chore', family_id: FAM, title: 'Dishes', assigned_to: USER, created_by: USER, due_date: TOMORROW },
        { id: 'bsint-chore-2', family_id: FAM2, title: 'Dishes 2', assigned_to: USER2, created_by: USER2, due_date: TOMORROW },
      ],
    })
    await prisma.list.create({
      data: { id: 'bsint-list', family_id: FAM, name: 'Groceries', type: 'grocery', created_by: USER },
    })
    await prisma.list.createMany({ data: [
      { id: 'bsint-empty-list', family_id: FAM, name: 'Empty groceries', type: 'shopping', created_by: USER },
      { id: 'bsint-foreign-list', family_id: FAM2, name: 'Foreign groceries', type: 'grocery', created_by: USER2 },
      { id: 'bsint-private-list', family_id: FAM, name: 'Private tasks', type: 'todo', created_by: USER },
    ] })
    await prisma.listItem.create({ data: { id: 'bsint-item', list_id: 'bsint-list', content: 'Milk', added_by: USER } })
    await prisma.upload.create({
      data: {
        id: 'bsint-upload',
        family_id: FAM,
        uploaded_by: USER,
        filename: 'bb5171ab0000aaaa.jpg',
        content_type: 'image/jpeg',
        size_bytes: 10,
      },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('device list choices include empty grocery lists and exclude another household and non-grocery lists', async () => {
    const board = await lib.loadTodayBoard(prisma, { familyId: FAM, audience: 'device', now: NOW })
    expect(board.groceryLists?.map(list => list.id).sort()).toEqual(['bsint-empty-list', 'bsint-list'])
    for (const list of board.groceryLists ?? []) expect(Object.keys(list).sort()).toEqual(['id', 'name'])
    const person = await lib.loadTodayBoard(prisma, { familyId: FAM, role: 'parent', now: NOW })
    expect(person.groceryLists).toBeUndefined()
  })

  it('migrate.js defaults: 5 idle minutes, night hours off, no photos', async () => {
    const family = await prisma.family.findUniqueOrThrow({
      where: { id: FAM },
      select: { ambient_idle_minutes: true, night_start: true, night_end: true, ambient_photo_ids: true },
    })
    expect(family).toEqual({ ambient_idle_minutes: 5, night_start: null, night_end: null, ambient_photo_ids: [] })
    const board = await lib.loadTodayBoard(prisma, { familyId: FAM, role: 'parent', now: NOW })
    expect(board.display).toEqual({ idleMinutes: 5, night: null, photos: [] })
  })

  it('stores night hours and photo ids; photos reach members only', async () => {
    await prisma.family.update({
      where: { id: FAM },
      data: { night_start: '21:30', night_end: '06:30', ambient_photo_ids: ['bsint-upload', 'gone'] },
    })
    const person = await lib.loadTodayBoard(prisma, { familyId: FAM, role: 'child', now: NOW })
    expect(person.display).toEqual({
      idleMinutes: 5,
      night: { start: '21:30', end: '06:30' },
      photos: [{ id: 'bsint-upload', url: '/api/files/chores/bb5171ab0000aaaa.jpg' }],
    })
    const device = await lib.loadTodayBoard(prisma, { familyId: FAM, audience: 'device', now: NOW })
    expect(device.display).toEqual({ idleMinutes: 5, night: { start: '21:30', end: '06:30' } })
    expect(JSON.stringify(device)).not.toContain('bsint-upload')
  })

  it('the version is stable, moves on a ticked chore or a deleted row, and ignores the other household', async () => {
    const v = (familyId = FAM) => lib.loadTodayBoard(prisma, { familyId, role: 'parent', now: NOW }).then((b) => b.version)
    const first = await v()
    expect(await v()).toBe(first)

    await prisma.chore.update({ where: { id: 'bsint-chore-2' }, data: { status: 'completed' } })
    expect(await v()).toBe(first)

    await prisma.chore.update({ where: { id: 'bsint-chore' }, data: { status: 'completed' } })
    const ticked = await v()
    expect(ticked).not.toBe(first)

    await prisma.listItem.delete({ where: { id: 'bsint-item' } })
    expect(await v()).not.toBe(ticked)
  })
})
