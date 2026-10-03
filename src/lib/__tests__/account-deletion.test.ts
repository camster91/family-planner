// Account and household deletion (D-3, docs/product/ACCOUNT_DELETION.md)
// against the two-household fake database: what a household deletion removes
// and what it leaves, member deletion hand-over, role and last-parent rules,
// files, calendar disconnect and retries. The Postgres proof (real foreign
// keys, every table) is account-deletion.integration.test.ts.

jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import fs from 'fs'
import path from 'path'
import { db, fakePrisma, FAMILY_A, FAMILY_B } from '@/__tests__/helpers/two-household'
import {
  AccountDeletionError,
  HOUSEHOLD_DELETION_PLAN,
  NOT_HOUSEHOLD_SCOPED,
  deleteHousehold,
  deleteMemberAccount,
  getDeletionOptions,
  type DeletionDeps,
} from '@/lib/account-deletion'

const A_USERS = ['parent-a', 'teen-a', 'child-a']
const UPLOADS = path.resolve('/srv/uploads')

type Row = Record<string, any>

function seedExtras() {
  const t = new Date('2026-09-01T00:00:00Z')
  const both = (fn: (f: 'a' | 'b', family: string) => Row) => [fn('a', FAMILY_A), fn('b', FAMILY_B)]
  db.rows('householdDevice').push(
    ...both((f, family_id) => ({ id: `dev-${f}`, family_id, label: 'Tablet', created_by: `parent-${f}`, revoked_at: null }))
  )
  db.rows('deviceSession').push(
    ...both((f, family_id) => ({ id: `dsess-${f}`, device_id: `dev-${f}`, family_id, refresh_token_hash: `r-${f}`, revoked_at: null }))
  )
  db.rows('devicePairing').push(
    ...both((f, family_id) => ({ id: `pair-${f}`, family_id, code_hash: `c-${f}`, created_by: `parent-${f}`, device_id: null }))
  )
  db.rows('parentElevationPin').push(...both((f, family_id) => ({ user_id: `parent-${f}`, family_id, pin_hash: 'x' })))
  db.rows('deviceAuditEvent').push(...both((f, family_id) => ({ id: `audit-${f}`, family_id, device_id: `dev-${f}`, type: 'x' })))
  db.rows('idempotencyRecord').push(
    ...both((f, family_id) => ({ id: `idem-${f}`, scope: `user:parent-${f}`, key: `k-${f}`, family_id, user_id: `parent-${f}` }))
  )
  db.rows('calendarConnection').push(
    ...both((f, family_id) => ({ id: `conn-${f}`, family_id, user_id: `parent-${f}`, provider: 'google' })),
    { id: 'conn-a-teen', family_id: FAMILY_A, user_id: 'teen-a', provider: 'microsoft' }
  )
  db.rows('calendarOAuthState').push(
    ...both((f, family_id) => ({ id: `oauth-${f}`, family_id, user_id: `parent-${f}`, state_hash: `s-${f}` }))
  )
  db.rows('calendarSubscription').push(
    ...both((f, family_id) => ({ id: `sub-${f}`, family_id, name: 'School', url_enc: 'v1:x', created_by: `parent-${f}` }))
  )
  db.rows('pushSubscription').push(
    ...both((f, family_id) => ({ id: `push-${f}`, family_id, user_id: `parent-${f}`, endpoint: `https://push/${f}` }))
  )
  db.rows('upload').push(
    ...both((f, family_id) => ({
      id: `upload-${f}`,
      family_id,
      uploaded_by: `parent-${f}`,
      filename: `${f === 'a' ? '1111111111111111' : '2222222222222222'}.jpg`,
      content_type: 'image/jpeg',
      size_bytes: 1,
      created_at: t,
    }))
  )
  db.rows('weatherCache').push(...both((f, family_id) => ({ family_id, latitude: 1, longitude: 1, status: 'ok' })))
  db.rows('inventoryAdjustment').push(
    ...both((f, family_id) => ({ id: `adj-${f}`, family_id, item_id: `inv-${f}`, kind: 'consume', actor_id: `parent-${f}` }))
  )
  // Household audit history (#285)
  const audit = (id: string, family_id: string, actor: string, action: string, target_id: string | null, summary: string) => ({
    id, family_id, actor_user_id: actor, actor_kind: 'person', action, target_type: action.startsWith('member.') ? 'member' : 'feature',
    target_id, summary, created_at: t,
  })
  db.rows('auditLog').push(
    ...both((f, family_id) => audit(`alog-${f}`, family_id, `parent-${f}`, 'feature.turned_on', 'wishlist', 'Turned on Wishlist')),
    audit('alog-a-join', FAMILY_A, 'child-a', 'member.joined', 'child-a', 'Child A joined as a child')
  )
  // Beta usage counts (#287)
  db.rows('betaMetricDaily').push(
    ...both((f, family_id) => ({ family_id, day: t, metric: 'chore_completed', count: f === 'a' ? 3 : 5 }))
  )
}

/** Rows of household A (directly or through a parent row / member). */
function belongsToA(model: string, row: Row): boolean {
  if (model === 'family') return row.id === FAMILY_A
  if (row.family_id === FAMILY_A) return true
  if (model === 'listItem') return row.list_id === 'list-a'
  if (model === 'projectTask') return row.project_id === 'proj-a'
  if (model === 'recipeIngredient') return row.recipe_id === 'recipe-a'
  if (model === 'notification') return A_USERS.includes(row.user_id)
  return false
}

function snapshot(pred: (model: string, row: Row) => boolean): Record<string, Row[]> {
  const out: Record<string, Row[]> = {}
  for (const model of Object.keys(db.tables)) {
    // db.rows applies column defaults, as reads do.
    const kept = db.rows(model).filter((r) => pred(model, r))
    if (kept.length > 0) out[model] = JSON.parse(JSON.stringify(kept))
  }
  return out
}

function deps(extra: Partial<DeletionDeps> = {}) {
  const removed: string[] = []
  const disconnected: string[] = []
  const d: DeletionDeps = {
    db: fakePrisma,
    uploadDir: UPLOADS,
    removeFile: async (p) => {
      removed.push(p)
    },
    revokeCalendarGrant: async (grant) => {
      disconnected.push(grant.id)
    },
    ...extra,
  }
  return { d, removed, disconnected }
}

function addSecondParent() {
  db.rows('user').push({
    id: 'parent-a2',
    email: 'parent-a2@example.test',
    name: 'Second Parent A',
    role: 'parent',
    family_id: FAMILY_A,
    created_at: new Date('2026-09-02T00:00:00Z'),
    password: 'hash',
    token_version: 0,
  })
}

beforeAll(() => {
  for (const level of ['log', 'warn', 'error', 'info'] as const) jest.spyOn(console, level).mockImplementation(() => undefined)
})

describe('deletion plan', () => {
  it('names every model in prisma/schema.prisma (or says why it is not household data)', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1][0].toLowerCase() + m[1].slice(1))
    const planned = new Set([...HOUSEHOLD_DELETION_PLAN.map((s) => s.model), ...NOT_HOUSEHOLD_SCOPED])
    expect(models.filter((m) => !planned.has(m))).toEqual([])
    expect(HOUSEHOLD_DELETION_PLAN.map((s) => s.model).filter((m) => !models.includes(m))).toEqual([])
  })

  it('deletes shared-device credentials first and member accounts last', () => {
    const order = HOUSEHOLD_DELETION_PLAN.map((s) => s.model)
    expect(order[0]).toBe('deviceSession')
    expect(order[order.length - 1]).toBe('user')
    expect(order.indexOf('listItem')).toBeLessThan(order.indexOf('list'))
    expect(order.indexOf('event')).toBeLessThan(order.indexOf('calendarConnection'))
  })
})

describe('deleteHousehold', () => {
  beforeEach(() => {
    db.reset()
    seedExtras()
  })

  it('removes every row of household A, and leaves household B exactly as it was', async () => {
    const before = snapshot((m, r) => !belongsToA(m, r) && !(m === 'user' && A_USERS.includes(r.id)))
    const { d, removed, disconnected } = deps()

    const result = await deleteHousehold(FAMILY_A, 'parent-a', d)

    expect(result).toMatchObject({ mode: 'household', deleted: true, membersRemoved: 3, filesNotRemoved: 0 })
    const leftA = snapshot((m, r) => belongsToA(m, r) || (m === 'user' && A_USERS.includes(r.id)))
    expect(leftA).toEqual({})
    expect(snapshot((m, r) => !belongsToA(m, r))).toEqual(before)

    // Provider-side revoke attempted for every connection of the household only.
    expect(disconnected.sort()).toEqual(['conn-a', 'conn-a-teen'])
    // The household's Upload file and its legacy chore photo; nothing of B.
    expect(removed.sort()).toEqual([
      path.join(UPLOADS, 'chores', '1111111111111111.jpg'),
      path.join(UPLOADS, 'chores', 'aaaaaaaaaaaaaaaa.jpg'),
    ])
  })

  it('is an explicit sequence, not one cascading family delete', async () => {
    const { d } = deps()
    await deleteHousehold(FAMILY_A, 'parent-a', d)
    const deletes = db.writes.filter((w) => w.op === 'deleteMany').map((w) => w.model)
    for (const model of ['deviceSession', 'devicePairing', 'householdDevice', 'familyInvite', 'calendarConnection', 'idempotencyRecord', 'upload', 'user']) {
      expect(deletes).toContain(model)
    }
    // Sessions are revoked before anything is deleted.
    const firstDelete = db.writes.findIndex((w) => w.op === 'deleteMany')
    const revoke = db.writes.findIndex((w) => w.model === 'user' && w.op === 'updateMany')
    expect(revoke).toBeGreaterThanOrEqual(0)
    expect(revoke).toBeLessThan(firstDelete)
    expect(db.writes[revoke].args.data.token_version).toEqual({ increment: 1 })
  })

  it('keeps a legacy photo file that another household also references', async () => {
    db.find('chore', 'chore-b')!.photo_url = '/api/files/chores/aaaaaaaaaaaaaaaa.jpg'
    const { d, removed } = deps()
    await deleteHousehold(FAMILY_A, 'parent-a', d)
    expect(removed).toEqual([path.join(UPLOADS, 'chores', '1111111111111111.jpg')])
  })

  it.each([
    ['legacy root path', '/api/files/aaaaaaaaaaaaaaaa.jpg'],
    ['bare filename', 'aaaaaaaaaaaaaaaa.jpg'],
  ])('keeps a shared legacy photo that the other household spells as a %s', async (_label, ref) => {
    db.find('chore', 'chore-b')!.photo_url = ref
    const { d, removed } = deps()
    await deleteHousehold(FAMILY_A, 'parent-a', d)
    expect(removed).toEqual([path.join(UPLOADS, 'chores', '1111111111111111.jpg')])
  })

  it('keeps a shared legacy photo when this household uses the bare form and the other the canonical one', async () => {
    db.find('chore', 'chore-a')!.photo_url = 'aaaaaaaaaaaaaaaa.jpg'
    db.find('chore', 'chore-b')!.photo_url = '/api/files/chores/aaaaaaaaaaaaaaaa.jpg'
    const { d, removed } = deps()
    await deleteHousehold(FAMILY_A, 'parent-a', d)
    expect(removed).toEqual([path.join(UPLOADS, 'chores', '1111111111111111.jpg')])
  })

  it('counts a file that could not be removed and still finishes', async () => {
    const { d } = deps({
      removeFile: async () => {
        throw new Error('EACCES')
      },
    })
    const result = await deleteHousehold(FAMILY_A, 'parent-a', d)
    expect(result).toMatchObject({ deleted: true, filesRemoved: 0, filesNotRemoved: 2 })
    expect(db.find('family', FAMILY_A)).toBeUndefined()
  })

  it('still deletes when a provider revoke fails (the stored tokens go either way)', async () => {
    const { d } = deps({
      revokeCalendarGrant: async () => {
        throw new Error('provider down')
      },
    })
    await deleteHousehold(FAMILY_A, 'parent-a', d)
    expect(db.rows('calendarConnection').map((c) => c.id)).toEqual(['conn-b'])
  })

  it('revokes calendar grants only after the transaction committed; a failed transaction revokes nothing', async () => {
    const order: string[] = []
    const failing = new Proxy(fakePrisma, {
      get(target, prop) {
        if (prop !== '$transaction') return target[prop]
        return async (fn: (tx: any) => Promise<unknown>) => {
          order.push('tx-start')
          await fn(
            new Proxy(fakePrisma, {
              get(t, p) {
                if (p === 'family') return { ...t.family, delete: async () => Promise.reject(new Error('boom')) }
                return t[p]
              },
            })
          )
          order.push('tx-commit')
        }
      },
    })
    const { d, disconnected } = deps({ db: failing })
    await expect(deleteHousehold(FAMILY_A, 'parent-a', d)).rejects.toThrow('boom')
    expect(order).toEqual(['tx-start'])
    expect(disconnected).toEqual([])

    db.reset()
    seedExtras()
    const ok = deps({
      revokeCalendarGrant: async (grant) => {
        // By the time the provider is called, the rows are already gone.
        order.push(`revoke:${grant.id}:${db.find('calendarConnection', grant.id) ? 'row' : 'gone'}`)
      },
    })
    await deleteHousehold(FAMILY_A, 'parent-a', ok.d)
    expect(order.filter((o) => o.startsWith('revoke')).sort()).toEqual(['revoke:conn-a-teen:gone', 'revoke:conn-a:gone'])
  })

  it.each([
    ['teen-a', 'PARENT_REQUIRED'],
    ['child-a', 'PARENT_REQUIRED'],
    ['parent-b', 'FAMILY_REQUIRED'],
  ])('%s cannot delete household A (%s) and nothing is written', async (actor, code) => {
    const { d, disconnected } = deps()
    await expect(deleteHousehold(FAMILY_A, actor, d)).rejects.toMatchObject({ code })
    expect(db.writes).toHaveLength(0)
    expect(disconnected).toHaveLength(0)
  })

  it('is refused while another parent exists', async () => {
    addSecondParent()
    const { d } = deps()
    await expect(deleteHousehold(FAMILY_A, 'parent-a', d)).rejects.toBeInstanceOf(AccountDeletionError)
    await expect(deleteHousehold(FAMILY_A, 'parent-a', d)).rejects.toMatchObject({ code: 'OTHER_PARENTS_EXIST', status: 409 })
    expect(db.writes).toHaveLength(0)
  })

  it('converges on a retry: the second run finds nothing and deletes nothing else', async () => {
    const { d } = deps()
    await deleteHousehold(FAMILY_A, 'parent-a', d)
    const writes = db.writes.length
    const again = await deleteHousehold(FAMILY_A, 'parent-a', d)
    expect(again).toMatchObject({ deleted: false, membersRemoved: 0 })
    expect(db.writes.length).toBe(writes)
    expect(db.find('family', FAMILY_B)).toBeDefined()
  })
})

describe('deleteMemberAccount', () => {
  beforeEach(() => {
    db.reset()
    seedExtras()
  })

  it('a child: their own chores, sick days, allowance and wishes go; the household and B stay', async () => {
    const beforeB = snapshot((m, r) => !belongsToA(m, r))
    const { d } = deps()
    const result = await deleteMemberAccount('child-a', d)

    expect(result).toMatchObject({ mode: 'account', deleted: true, successorId: 'parent-a' })
    expect(db.find('user', 'child-a')).toBeUndefined()
    expect(db.find('family', FAMILY_A)).toBeDefined()
    expect(db.find('user', 'parent-a')).toBeDefined()
    for (const [model, id] of [
      ['chore', 'chore-a'],
      ['sickDay', 'sick-a'],
      ['medication', 'med-a'],
      ['allowance', 'allow-a'],
      ['wishlistItem', 'wish-a'],
    ]) {
      expect(db.find(model, id)).toBeUndefined()
    }
    // References are cleared, household rows kept.
    expect(db.find('emergencyContact', 'contact-a')).toMatchObject({ person_id: null })
    expect(db.find('projectTask', 'task-a')).toMatchObject({ assigned_to: null })
    expect(db.find('anniversary', 'ann-a')).toMatchObject({ person_id: null })
    expect(snapshot((m, r) => !belongsToA(m, r))).toEqual(beforeB)
  })

  it("household audit history (#285): a line that a member left, without their name; their actor refs cleared", async () => {
    const { d } = deps()
    await deleteMemberAccount('child-a', d)
    const rows = db.rows('auditLog').filter((r) => r.family_id === FAMILY_A)
    expect(rows.find((r) => r.id === 'alog-a-join')).toMatchObject({
      actor_user_id: null,
      target_id: null,
      summary: 'A former member joined as a child',
    })
    const left = rows.find((r) => r.action === 'member.left')
    expect(left).toMatchObject({ actor_user_id: null, target_id: null, summary: 'A child deleted their account and left the household' })
    expect(JSON.stringify(rows)).not.toContain('Child A')
    // The parent's own row and household B are untouched.
    expect(db.find('auditLog', 'alog-a')).toMatchObject({ actor_user_id: 'parent-a' })
    expect(db.find('auditLog', 'alog-b')).toMatchObject({ actor_user_id: 'parent-b' })
  })

  it('a parent with another parent: household content is handed over, not deleted', async () => {
    addSecondParent()
    const { d, disconnected } = deps()
    const result = await deleteMemberAccount('parent-a', d)

    expect(result).toMatchObject({ deleted: true, successorId: 'parent-a2' })
    expect(db.find('user', 'parent-a')).toBeUndefined()
    for (const [model, id, column] of [
      ['chore', 'chore-a', 'created_by'],
      ['event', 'event-a', 'created_by'],
      ['list', 'list-a', 'created_by'],
      ['listItem', 'item-a', 'added_by'],
      ['familyMeal', 'meal-a', 'created_by'],
      ['recipe', 'recipe-a', 'created_by'],
      ['pinnedNote', 'note-a', 'created_by'],
      ['pickup', 'pickup-a', 'created_by'],
      ['handoff', 'handoff-a', 'created_by'],
      ['sickDay', 'sick-a', 'created_by'],
      ['medication', 'med-a', 'created_by'],
      ['transaction', 'txn-a', 'user_id'],
      ['budgetCategory', 'cat-a', 'created_by'],
      ['project', 'proj-a', 'created_by'],
      ['reward', 'reward-a', 'created_by'],
      ['allowance', 'allow-a', 'from_user_id'],
      ['familyLocation', 'loc-a', 'user_id'],
      ['calendarSubscription', 'sub-a', 'created_by'],
    ] as const) {
      expect([model, db.find(model, id)?.[column]]).toEqual([model, 'parent-a2'])
    }
    expect(db.find('familyMeal', 'meal-a')).toMatchObject({ cook_id: null })
    expect(db.find('pickup', 'pickup-a')).toMatchObject({ assigned_to: null })
    // Personal rows and credentials are gone.
    expect(db.find('notification', 'notif-a')).toBeUndefined()
    expect(db.find('message', 'msg-a')).toBeUndefined()
    expect(db.find('activity', 'act-a')).toBeUndefined()
    expect(db.rows('parentElevationPin').filter((p) => p.user_id === 'parent-a')).toHaveLength(0)
    expect(db.find('idempotencyRecord', 'idem-a')).toBeUndefined()
    expect(db.find('calendarConnection', 'conn-a')).toBeUndefined()
    expect(db.find('calendarOAuthState', 'oauth-a')).toBeUndefined()
    expect(db.find('devicePairing', 'pair-a')).toBeUndefined()
    expect(db.find('familyInvite', 'invite-a')).toBeUndefined()
    expect(db.find('pushSubscription', 'push-a')).toBeUndefined()
    // Household tablets stay paired; only the creator reference is cleared.
    expect(db.find('householdDevice', 'dev-a')).toMatchObject({ created_by: null })
    expect(db.find('deviceSession', 'dsess-a')).toMatchObject({ revoked_at: null })
    // Only their own calendar connection is disconnected at the provider.
    expect(disconnected).toEqual(['conn-a'])
    // Family B untouched.
    expect(db.find('user', 'parent-b')).toBeDefined()
    expect(db.find('calendarConnection', 'conn-b')).toBeDefined()
  })

  it('ends a tablet parent mode held by the member', async () => {
    addSecondParent()
    Object.assign(db.find('householdDevice', 'dev-a')!, {
      elevation_token_hash: 'h',
      elevated_user_id: 'parent-a',
      elevated_token_version: 0,
    })
    await deleteMemberAccount('parent-a', deps().d)
    expect(db.find('householdDevice', 'dev-a')).toMatchObject({ elevation_token_hash: null, elevated_user_id: null })
  })

  it('the only parent gets LAST_PARENT and nothing is written', async () => {
    const { d, disconnected } = deps()
    await expect(deleteMemberAccount('parent-a', d)).rejects.toMatchObject({ code: 'LAST_PARENT', status: 409 })
    expect(db.writes).toHaveLength(0)
    expect(disconnected).toHaveLength(0)
  })

  it('keeps every photo the member uploaded with the household (uploader cleared), used or not', async () => {
    db.rows('upload').push(
      { id: 'up-child-own', family_id: FAMILY_A, uploaded_by: 'child-a', filename: '3333333333333333.jpg' },
      { id: 'up-child-shared', family_id: FAMILY_A, uploaded_by: 'child-a', filename: '4444444444444444.jpg' },
      { id: 'up-child-ambient', family_id: FAMILY_A, uploaded_by: 'child-a', filename: '5555555555555555.jpg' }
    )
    db.find('chore', 'chore-a')!.photo_url = '/api/files/chores/3333333333333333.jpg'
    db.rows('chore').push({
      id: 'chore-a-other',
      family_id: FAMILY_A,
      assigned_to: 'teen-a',
      created_by: 'parent-a',
      title: 'Other',
      photo_url: '/api/files/chores/4444444444444444.jpg',
    })
    db.find('family', FAMILY_A)!.ambient_photo_ids = ['up-child-ambient']
    const { d, removed } = deps()
    await deleteMemberAccount('child-a', d)
    // Nothing is removed from disk: whether a photo is still used cannot be
    // decided atomically against a concurrent attach, so it stays with the
    // household and goes with it when the household is deleted.
    expect(removed).toEqual([])
    expect(db.find('upload', 'up-child-own')).toMatchObject({ uploaded_by: null })
    expect(db.find('upload', 'up-child-shared')).toMatchObject({ uploaded_by: null })
    expect(db.find('upload', 'up-child-ambient')).toMatchObject({ uploaded_by: null })
  })

  it('a user without a household is simply deleted', async () => {
    const result = await deleteMemberAccount('loner', deps().d)
    expect(result).toMatchObject({ deleted: true, successorId: null })
    expect(db.find('user', 'loner')).toBeUndefined()
  })

  it('converges on a retry', async () => {
    await deleteMemberAccount('teen-a', deps().d)
    const again = await deleteMemberAccount('teen-a', deps().d)
    expect(again).toMatchObject({ deleted: false })
    expect(db.find('user', 'parent-a')).toBeDefined()
  })
})

describe('getDeletionOptions', () => {
  beforeEach(() => db.reset())

  it('only parent: household only', async () => {
    expect(await getDeletionOptions('parent-a', { db: fakePrisma })).toEqual({
      role: 'parent',
      household: { id: FAMILY_A, name: 'Household A', memberCount: 3, parentCount: 1 },
      isOnlyParent: true,
      canDeleteAccount: false,
      canDeleteHousehold: true,
    })
  })

  it('teen and child: own account only', async () => {
    for (const id of ['teen-a', 'child-a']) {
      expect(await getDeletionOptions(id, { db: fakePrisma })).toMatchObject({
        canDeleteAccount: true,
        canDeleteHousehold: false,
        isOnlyParent: false,
      })
    }
  })

  it('one of two parents: own account only', async () => {
    addSecondParent()
    expect(await getDeletionOptions('parent-a', { db: fakePrisma })).toMatchObject({
      canDeleteAccount: true,
      canDeleteHousehold: false,
      household: { parentCount: 2 },
    })
  })

  it('no household: own account only', async () => {
    expect(await getDeletionOptions('loner', { db: fakePrisma })).toMatchObject({
      household: null,
      canDeleteAccount: true,
      canDeleteHousehold: false,
    })
  })
})
