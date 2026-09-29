// Real-Postgres proof for account and household deletion (D-3,
// docs/product/ACCOUNT_DELETION.md): with the foreign keys scripts/migrate.js
// actually creates (several RESTRICT / NO ACTION, several CASCADE),
//
// * a whole-household delete leaves no row of that household in ANY table
//   (every table with a family_id column, found from information_schema, plus
//   the child tables reached through a parent row), leaves the other
//   household byte-for-byte intact, removes its uploaded files from disk, and
//   invalidates its tokens (person session, device refresh token, invitation,
//   calendar feed, sitter share link) while the other household's still work;
// * a member deletion succeeds for a parent who created rows behind RESTRICT
//   foreign keys (the old DELETE /api/users failed there) and hands the
//   household content to the other parent instead of cascading it away.
//
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...
// against a disposable database that `node scripts/migrate.js` has prepared.

import fs from 'fs'
import os from 'os'
import path from 'path'

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(120_000)

describeWithDatabase('account deletion against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let lib: typeof import('@/lib/account-deletion')
  let session: typeof import('@/lib/session')
  let auth: typeof import('@/lib/auth')
  let tokens: typeof import('@/lib/tokens')
  let uploadDir: string

  const P = 'adint'
  const fam = (h: string) => `${P}-fam-${h}`
  const uid = (h: string, who: string) => `${P}-${h}-${who}`
  const HOUSEHOLDS = ['a', 'b']

  async function cleanup() {
    const families = HOUSEHOLDS.map(fam)
    const users = HOUSEHOLDS.flatMap((h) => ['parent', 'parent2', 'teen', 'child'].map((w) => uid(h, w)))
    // Explicit teardown through the same library, so a failed test cannot leave rows behind.
    for (const f of families) {
      const parent = await prisma.user.findFirst({ where: { family_id: f, role: 'parent' }, select: { id: true } })
      if (parent) {
        await prisma.user.updateMany({ where: { family_id: f, role: 'parent', id: { not: parent.id } }, data: { role: 'teen' } })
        await lib.deleteHousehold(f, parent.id, { uploadDir, revokeCalendarGrant: async () => undefined })
      }
    }
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    await prisma.family.deleteMany({ where: { id: { in: families } } })
    await prisma.badgeDefinition.deleteMany({ where: { id: { startsWith: `${P}-` } } })
  }

  /** One household with a row in every household-scoped table. */
  async function seed(h: string) {
    const f = fam(h)
    const parent = uid(h, 'parent')
    const teen = uid(h, 'teen')
    const child = uid(h, 'child')
    const id = (name: string) => `${P}-${h}-${name}`
    const t = new Date('2026-09-20T12:00:00Z')
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const db = prisma as any

    await db.family.create({
      data: { id: f, name: `Household ${h.toUpperCase()}`, invite_code: id('invite-code'), feed_token: id('feed-token') },
    })
    const password = await auth.hashPassword('pw-integration')
    await db.user.createMany({
      data: [
        { id: parent, email: `${parent}@example.test`, name: 'Parent', role: 'parent', family_id: f, password, created_at: t },
        { id: teen, email: `${teen}@example.test`, name: 'Teen', role: 'teen', family_id: f, password },
        { id: child, email: `${child}@example.test`, name: 'Child', role: 'child', family_id: f, password },
      ],
    })
    // Uploads (and the file on disk)
    const filename = h === 'a' ? 'a1a1a1a1a1a1a1a1.jpg' : 'b2b2b2b2b2b2b2b2.jpg'
    fs.writeFileSync(path.join(uploadDir, 'chores', filename), 'x')
    await db.upload.create({ data: { id: id('upload'), family_id: f, uploaded_by: parent, filename, content_type: 'image/jpeg', size_bytes: 1 } })
    // Calendar
    await db.calendarSubscription.create({ data: { id: id('sub'), family_id: f, name: 'School', url_enc: 'v1:x', created_by: parent } })
    await db.calendarConnection.create({ data: { id: id('conn'), family_id: f, user_id: parent, provider: 'google' } })
    await db.event.create({
      data: { id: id('event'), family_id: f, title: 'Dentist', start_time: t, end_time: t, created_by: parent },
    })
    await db.event.create({
      data: { id: id('event-imported'), family_id: f, title: 'Synced', start_time: t, end_time: t, created_by: parent, source_connection_id: id('conn') },
    })
    await db.calendarEventLink.create({ data: { id: id('link'), family_id: f, connection_id: id('conn'), event_id: id('event'), external_id: 'x' } })
    await db.calendarOAuthState.create({
      data: { id: id('oauth'), state_hash: id('state'), family_id: f, user_id: parent, provider: 'google', code_verifier_enc: 'x', expires_at: later },
    })
    await db.familyInvite.create({
      data: { id: id('invite'), family_id: f, email: `${id('invitee')}@example.test`, role: 'child', token_hash: tokens.hashToken(id('invite-token')), expires_at: later, created_by: parent },
    })
    // Chores
    await db.chore.create({
      data: { id: id('chore'), family_id: f, title: 'Dishes', assigned_to: child, due_date: t, created_by: parent, photo_url: `/api/files/chores/${filename}` },
    })
    await db.chore.create({ data: { id: id('chore-parent'), family_id: f, title: 'Bins', assigned_to: teen, due_date: t, created_by: parent } })
    await db.choreAssignment.create({ data: { id: id('assign'), family_id: f, chore_id: id('chore'), assigned_to: child, due_date: t } })
    // Import provenance
    await db.importJob.create({ data: { id: id('job'), family_id: f, source_app: 'chorechamps', started_by: parent } })
    await db.importedRecord.create({
      data: { id: id('imported'), family_id: f, import_job_id: id('job'), source_app: 'chorechamps', source_model: 'x', source_id: '1', target_model: 'Chore', target_id: id('chore') },
    })
    await db.financialArchiveRecord.create({ data: { id: id('fin'), family_id: f, source_app: 'budget', source_model: 'x', source_id: '1', payload: {} } })
    // Meals, recipes, legacy tables
    await db.ingredient.create({ data: { id: id('ingredient'), family_id: f, name: 'Tomato' } })
    await db.recipe.create({ data: { id: id('recipe'), family_id: f, title: 'Soup', created_by: parent } })
    await db.recipeIngredient.create({ data: { id: id('ri'), recipe_id: id('recipe'), ingredient_id: id('ingredient'), amount: 1 } })
    await db.mealPlan.create({ data: { id: id('plan'), family_id: f, name: 'Week', start_date: t, end_date: t, created_by: parent } })
    await db.mealPlanEntry.create({ data: { id: id('plan-entry'), meal_plan_id: id('plan'), recipe_id: id('recipe'), date: t, meal_type: 'dinner' } })
    await db.shoppingList.create({ data: { id: id('shop'), family_id: f, created_by: parent } })
    await db.shoppingItem.create({ data: { id: id('shop-item'), shopping_list_id: id('shop'), ingredient_name: 'Milk' } })
    await db.familyMeal.create({ data: { id: id('meal'), family_id: f, date: t, meal_type: 'dinner', created_by: parent, cook_id: parent, recipe_id: id('recipe') } })
    // Gamification
    await db.habit.create({ data: { id: id('habit'), family_id: f, title: 'Read', created_by: parent } })
    await db.habitLog.create({ data: { id: id('habit-log'), family_id: f, habit_id: id('habit'), user_id: child, logged_date: t } })
    await db.badgeDefinition.create({ data: { id: id('badge'), family_id: f, name: 'Star', description: 'x', icon: 'x', requirement: {} } })
    await db.earnedBadge.create({ data: { id: id('earned'), family_id: f, badge_id: id('badge'), user_id: child } })
    await db.reward.create({ data: { id: id('reward'), family_id: f, name: 'Ice cream', created_by: parent } })
    await db.rewardRedemption.create({ data: { id: id('redeem'), family_id: f, reward_id: id('reward'), requested_by: child, points: 1 } })
    await db.familyGoal.create({ data: { id: id('goal'), family_id: f, title: 'Trip', target_points: 10, created_by: parent } })
    await db.pushSubscription.create({ data: { id: id('push'), family_id: f, user_id: parent, endpoint: `https://push.example.test/${h}`, keys: {} } })
    // Messages, notifications, activity
    await db.message.create({ data: { id: id('msg'), family_id: f, sender_id: parent, content: 'hi', read_by: [child] } })
    await db.notification.create({ data: { id: id('notif'), user_id: child, title: 't', message: 'm', type: 'system' } })
    await db.activity.create({ data: { id: id('act'), family_id: f, user_id: parent, type: 'x', title: 'x' } })
    // Lists and budget
    await db.list.create({ data: { id: id('list'), family_id: f, name: 'Groceries', type: 'grocery', created_by: parent } })
    await db.listItem.create({ data: { id: id('item'), list_id: id('list'), content: 'Milk', added_by: teen, checked_by: parent } })
    await db.groceryShoppingSession.create({ data: { id: id('trip'), family_id: f, list_id: id('list') } })
    await db.grocerySectionPreference.create({ data: { id: id('section'), family_id: f, name_key: 'milk', section: 'dairy_eggs', updated_by: parent } })
    await db.budgetCategory.create({ data: { id: id('cat'), family_id: f, name: 'Food', created_by: parent } })
    await db.transaction.create({ data: { id: id('txn'), family_id: f, user_id: parent, amount: 1, type: 'expense', category_id: id('cat'), list_item_id: id('item') } })
    await db.project.create({ data: { id: id('proj'), family_id: f, name: 'Garage', created_by: parent } })
    await db.projectTask.create({ data: { id: id('task'), project_id: id('proj'), title: 'Sweep', assigned_to: teen } })
    // Family features
    await db.pinnedNote.create({ data: { id: id('note'), family_id: f, title: 'Wifi', body: 'x', created_by: parent } })
    await db.anniversary.create({ data: { id: id('ann'), family_id: f, name: 'Bday', type: 'birthday', date: t, person_id: child, created_by: parent } })
    await db.familyLocation.create({ data: { id: id('loc'), family_id: f, user_id: parent, label: 'Home' } })
    await db.emergencyContact.create({ data: { id: id('contact'), family_id: f, person_id: child, person_name: 'Kid', relationship: 'child' } })
    await db.pickup.create({ data: { id: id('pickup'), family_id: f, title: 'School', pickup_time: t, created_by: parent, assigned_to: parent } })
    await db.allowance.create({ data: { id: id('allow'), family_id: f, from_user_id: parent, to_user_id: child, amount: 5 } })
    await db.wishlistItem.create({ data: { id: id('wish'), family_id: f, requested_by: child, title: 'Bike' } })
    await db.handoff.create({ data: { id: id('handoff'), family_id: f, sitter_name: 'Sam', share_token: id('share-token'), share_expires_at: later, created_by: parent } })
    await db.sickDay.create({ data: { id: id('sick'), family_id: f, person_id: child, severity: 'mild', created_by: parent } })
    await db.medication.create({ data: { id: id('med'), family_id: f, sick_day_id: id('sick'), person_id: child, name: 'Syrup', dosage: '5ml', schedule: 'x', created_by: parent } })
    // Inventory
    await db.inventoryItem.create({ data: { id: id('inv'), family_id: f, name: 'Tomatoes', ingredient_id: id('ingredient'), added_by: parent } })
    await db.inventoryAdjustment.create({
      data: { id: id('adj'), family_id: f, item_id: id('inv'), kind: 'consume', status_before: 'active', status_after: 'consumed', item_version: t, actor_id: parent },
    })
    await db.weatherCache.create({ data: { family_id: f, latitude: 1, longitude: 1, status: 'ok', fetched_at: t } })
    // Shared device
    await db.householdDevice.create({ data: { id: id('device'), family_id: f, label: 'Kitchen', platform: 'android', created_by: parent } })
    await db.deviceSession.create({
      data: {
        id: id('dsess'),
        device_id: id('device'),
        family_id: f,
        access_token_hash: tokens.hashToken(id('access')),
        access_expires_at: later,
        refresh_token_hash: tokens.hashToken(id('refresh')),
        refresh_expires_at: later,
      },
    })
    await db.devicePairing.create({ data: { id: id('pairing'), family_id: f, code_hash: id('code'), label: 'Hall', created_by: parent, expires_at: later } })
    await db.parentElevationPin.create({ data: { user_id: parent, family_id: f, pin_hash: 'x' } })
    await db.deviceAuditEvent.create({ data: { id: id('audit'), family_id: f, device_id: id('device'), actor_user_id: parent, type: 'x' } })
    await db.idempotencyRecord.create({
      data: { id: id('idem'), scope: `user:${parent}`, key: id('key-0000000000'), family_id: f, user_id: parent, action: 'x', request_hash: 'x', expires_at: later },
    })
  }

  /** Every row of household `h`, table by table (family_id tables + child tables + member rows). */
  async function rowsOf(h: string): Promise<Record<string, unknown[]>> {
    const f = fam(h)
    const tables: Array<{ table_name: string }> = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'family_id' ORDER BY table_name`
    )
    const out: Record<string, unknown[]> = {}
    const add = (name: string, rows: unknown[]) => {
      if (rows.length > 0) out[name] = rows
    }
    for (const { table_name } of tables) {
      add(table_name, await prisma.$queryRawUnsafe(`SELECT * FROM "${table_name}" WHERE "family_id" = $1 ORDER BY 1`, f))
    }
    add('Family', await prisma.$queryRawUnsafe(`SELECT * FROM "Family" WHERE "id" = $1`, f))
    const children: Array<[string, string, string]> = [
      ['ListItem', 'list_id', 'List'],
      ['ProjectTask', 'project_id', 'Project'],
      ['RecipeIngredient', 'recipe_id', 'Recipe'],
      ['MealPlanEntry', 'meal_plan_id', 'MealPlan'],
      ['ShoppingItem', 'shopping_list_id', 'ShoppingList'],
    ]
    for (const [table, fk, parentTable] of children) {
      add(
        table,
        await prisma.$queryRawUnsafe(
          `SELECT * FROM "${table}" WHERE "${fk}" IN (SELECT "id" FROM "${parentTable}" WHERE "family_id" = $1) OR "id" LIKE $2 ORDER BY 1`,
          f,
          `${P}-${h}-%`
        )
      )
    }
    const memberIds = ['parent', 'parent2', 'teen', 'child'].map((w) => uid(h, w))
    add('Notification', await prisma.$queryRawUnsafe(`SELECT * FROM "Notification" WHERE "user_id" = ANY($1) ORDER BY 1`, memberIds))
    add('User(members)', await prisma.$queryRawUnsafe(`SELECT * FROM "User" WHERE "id" = ANY($1) ORDER BY 1`, memberIds))
    return out
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    lib = await import('@/lib/account-deletion')
    session = await import('@/lib/session')
    auth = await import('@/lib/auth')
    tokens = await import('@/lib/tokens')
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-account-deletion-'))
    fs.mkdirSync(path.join(uploadDir, 'chores'))
    for (const level of ['log', 'info'] as const) jest.spyOn(console, level).mockImplementation(() => undefined)
    await cleanup()
  })

  afterAll(async () => {
    await cleanup()
    fs.rmSync(uploadDir, { recursive: true, force: true })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await cleanup()
    await seed('a')
    await seed('b')
  })

  it('the seed really covers every household-scoped table', async () => {
    const tables: Array<{ table_name: string }> = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'family_id'`
    )
    const a = await rowsOf('a')
    const missing = tables.map((t) => t.table_name).filter((t) => t !== 'User' && !a[t])
    expect(missing).toEqual([])
  })

  it('whole-household delete removes every row of A, keeps B intact, removes files and invalidates tokens', async () => {
    const beforeB = await rowsOf('b')
    const parentA = uid('a', 'parent')
    const parentB = uid('b', 'parent')
    const cookieA = auth.signToken({ userId: parentA, email: `${parentA}@example.test`, role: 'parent', family_id: fam('a'), tv: 0 })
    const cookieB = auth.signToken({ userId: parentB, email: `${parentB}@example.test`, role: 'parent', family_id: fam('b'), tv: 0 })
    expect(await session.verifySessionToken(cookieA)).not.toBeNull()
    const disconnected: string[] = []

    const result = await lib.deleteHousehold(fam('a'), parentA, {
      uploadDir,
      revokeCalendarGrant: async (grant) => {
        disconnected.push(grant.id)
      },
    })

    expect(result).toMatchObject({ deleted: true, membersRemoved: 3, filesRemoved: 1, filesNotRemoved: 0 })
    expect(await rowsOf('a')).toEqual({})
    expect(await rowsOf('b')).toEqual(beforeB)
    expect(disconnected).toEqual([`${P}-a-conn`])

    // Files: A's upload is gone from disk, B's is still there.
    expect(fs.existsSync(path.join(uploadDir, 'chores', 'a1a1a1a1a1a1a1a1.jpg'))).toBe(false)
    expect(fs.existsSync(path.join(uploadDir, 'chores', 'b2b2b2b2b2b2b2b2.jpg'))).toBe(true)

    // Tokens: A's no longer resolve; B's still do.
    expect(await session.verifySessionToken(cookieA)).toBeNull()
    expect(await session.verifySessionToken(cookieB)).not.toBeNull()
    const lookups = async (h: string) => ({
      deviceRefresh: await prisma.deviceSession.count({ where: { refresh_token_hash: tokens.hashToken(`${P}-${h}-refresh`) } }),
      invite: await prisma.familyInvite.count({ where: { token_hash: tokens.hashToken(`${P}-${h}-invite-token`) } }),
      feed: await prisma.family.count({ where: { feed_token: `${P}-${h}-feed-token` } }),
      share: await prisma.handoff.count({ where: { share_token: `${P}-${h}-share-token` } }),
      pairingCode: await prisma.devicePairing.count({ where: { code_hash: `${P}-${h}-code` } }),
    })
    expect(await lookups('a')).toEqual({ deviceRefresh: 0, invite: 0, feed: 0, share: 0, pairingCode: 0 })
    expect(await lookups('b')).toEqual({ deviceRefresh: 1, invite: 1, feed: 1, share: 1, pairingCode: 1 })

    // A retry converges.
    const again = await lib.deleteHousehold(fam('a'), parentA, { uploadDir, revokeCalendarGrant: async () => undefined })
    expect(again).toMatchObject({ deleted: false })
    expect(await rowsOf('b')).toEqual(beforeB)
  })

  it('a transaction that fails leaves calendar rows intact and revokes nothing at the provider', async () => {
    const before = await rowsOf('a')
    const revoked: string[] = []
    // The real client, except that deleting the Family row fails inside the transaction.
    const failing = new Proxy(prisma as any, {
      get(target, prop) {
        if (prop !== '$transaction') return Reflect.get(target, prop)
        return (fn: (tx: any) => Promise<unknown>, opts: unknown) =>
          target.$transaction(
            (tx: any) =>
              fn(
                new Proxy(tx, {
                  get(t, p) {
                    if (p === 'family') {
                      return new Proxy(t.family, {
                        get(ft, fp) {
                          if (fp === 'delete') return async () => Promise.reject(new Error('simulated failure'))
                          const v = Reflect.get(ft, fp)
                          return typeof v === 'function' ? v.bind(ft) : v
                        },
                      })
                    }
                    const v = Reflect.get(t, p)
                    return typeof v === 'function' ? v.bind(t) : v
                  },
                })
              ),
            opts
          )
      },
    })
    await expect(
      lib.deleteHousehold(fam('a'), uid('a', 'parent'), {
        db: failing,
        uploadDir,
        revokeCalendarGrant: async (grant) => {
          revoked.push(grant.id)
        },
      })
    ).rejects.toThrow('simulated failure')
    expect(revoked).toEqual([])
    expect(await rowsOf('a')).toEqual(before)
    expect(await prisma.calendarConnection.count({ where: { id: `${P}-a-conn` } })).toBe(1)
    expect(await prisma.calendarEventLink.count({ where: { id: `${P}-a-link` } })).toBe(1)
    expect(await prisma.event.count({ where: { id: `${P}-a-event-imported` } })).toBe(1)
    expect(fs.existsSync(path.join(uploadDir, 'chores', 'a1a1a1a1a1a1a1a1.jpg'))).toBe(true)
  })

  it('is refused while another parent exists, and nothing changes', async () => {
    await prisma.user.create({
      data: { id: uid('a', 'parent2'), email: `${uid('a', 'parent2')}@example.test`, name: 'P2', role: 'parent', family_id: fam('a') },
    })
    const before = await rowsOf('a')
    await expect(lib.deleteHousehold(fam('a'), uid('a', 'parent'), { uploadDir })).rejects.toMatchObject({ code: 'OTHER_PARENTS_EXIST' })
    expect(await rowsOf('a')).toEqual(before)
  })

  it('a parent who created rows behind RESTRICT keys can delete their account; the content moves to the other parent', async () => {
    const p2 = uid('a', 'parent2')
    await prisma.user.create({
      data: { id: p2, email: `${p2}@example.test`, name: 'P2', role: 'parent', family_id: fam('a'), created_at: new Date('2026-09-21T00:00:00Z') },
    })
    const beforeB = await rowsOf('b')
    const disconnected: string[] = []
    const result = await lib.deleteMemberAccount(uid('a', 'parent'), {
      uploadDir,
      revokeCalendarGrant: async (grant) => {
        disconnected.push(grant.id)
      },
    })
    expect(result).toMatchObject({ deleted: true, successorId: p2 })
    expect(disconnected).toEqual([`${P}-a-conn`])
    expect(await prisma.user.findUnique({ where: { id: uid('a', 'parent') } })).toBeNull()

    const owner = async (model: string, id: string, column: string) =>
      ((await (prisma as any)[model].findUnique({ where: { id: `${P}-a-${id}` } })) ?? {})[column]
    for (const [model, id, column] of [
      ['recipe', 'recipe', 'created_by'],
      ['familyMeal', 'meal', 'created_by'],
      ['pinnedNote', 'note', 'created_by'],
      ['pickup', 'pickup', 'created_by'],
      ['handoff', 'handoff', 'created_by'],
      ['habit', 'habit', 'created_by'],
      ['familyGoal', 'goal', 'created_by'],
      ['sickDay', 'sick', 'created_by'],
      ['medication', 'med', 'created_by'],
      ['mealPlan', 'plan', 'created_by'],
      ['shoppingList', 'shop', 'created_by'],
      ['importJob', 'job', 'started_by'],
      ['chore', 'chore', 'created_by'],
      ['event', 'event', 'created_by'],
      ['list', 'list', 'created_by'],
      ['transaction', 'txn', 'user_id'],
      ['project', 'proj', 'created_by'],
      ['calendarSubscription', 'sub', 'created_by'],
    ] as const) {
      expect([model, await owner(model, id, column)]).toEqual([model, p2])
    }
    expect(await owner('familyMeal', 'meal', 'cook_id')).toBeNull()
    expect(await owner('listItem', 'item', 'checked_by')).toBeNull()
    // Their personal rows and credentials are gone; the household's tablet stays paired.
    expect(await prisma.message.count({ where: { id: `${P}-a-msg` } })).toBe(0)
    expect(await prisma.calendarConnection.count({ where: { id: `${P}-a-conn` } })).toBe(0)
    // Events imported through their connection go with it, as on a disconnect.
    expect(await prisma.event.count({ where: { id: `${P}-a-event-imported` } })).toBe(0)
    expect(await prisma.parentElevationPin.count({ where: { user_id: uid('a', 'parent') } })).toBe(0)
    expect(await prisma.idempotencyRecord.count({ where: { user_id: uid('a', 'parent') } })).toBe(0)
    expect(await prisma.deviceSession.count({ where: { id: `${P}-a-dsess`, revoked_at: null } })).toBe(1)
    expect(await prisma.family.count({ where: { id: fam('a') } })).toBe(1)
    expect(await rowsOf('b')).toEqual(beforeB)
  })

  it('a child deleting their account removes what was only theirs and keeps the household', async () => {
    const child = uid('a', 'child')
    await lib.deleteMemberAccount(child, { uploadDir, revokeCalendarGrant: async () => undefined })
    expect(await prisma.user.count({ where: { id: child } })).toBe(0)
    expect(await prisma.chore.count({ where: { id: `${P}-a-chore` } })).toBe(0)
    expect(await prisma.chore.count({ where: { id: `${P}-a-chore-parent` } })).toBe(1)
    expect(await prisma.sickDay.count({ where: { id: `${P}-a-sick` } })).toBe(0)
    expect(await prisma.emergencyContact.findUnique({ where: { id: `${P}-a-contact` } })).toMatchObject({ person_id: null })
    const msg = await prisma.message.findUnique({ where: { id: `${P}-a-msg` } })
    expect(msg?.read_by).toEqual([])
    // The parent's upload is still referenced by nothing of the child's: it stays.
    expect(fs.existsSync(path.join(uploadDir, 'chores', 'a1a1a1a1a1a1a1a1.jpg'))).toBe(true)
  })
})
