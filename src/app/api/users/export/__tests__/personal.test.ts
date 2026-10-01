// GET /api/users/export on the two-household harness: the caller's own rows
// in the per-person domains (allowance, wishlist, sick days, medications,
// emergency card, anniversaries, pickups, notes, saved places, handoffs,
// uploads, chore assignments, calendar subscriptions/connections, push
// registrations, budget categories). Same role rules as the matching GET
// routes, never a secret, never another member's or household's rows.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import { GET } from '../route'
import { db, req, FAMILY_A, FAMILY_B, FOREIGN } from '@/__tests__/helpers/two-household'

const T = new Date('2026-09-20T00:00:00Z')

const PERSONAL_KEYS = [
  'allowances', 'wishlistItems', 'sickDays', 'medications', 'emergencyContacts', 'anniversaries', 'pickups',
  'pinnedNotes', 'familyLocations', 'handoffs', 'uploads', 'choreAssignments', 'calendarSubscriptions',
  'calendarConnections', 'pushSubscriptions', 'budgetCategories',
] as const

// Sensitive marker values seeded below; none may appear in any export.
const SECRETS = [
  'share-token-marker', 'v1:feed-url-ciphertext', 'etag-marker', 'access-token-marker', 'refresh-token-marker',
  'sync-cursor-marker', 'https://push.example/endpoint-marker', 'p256dh-marker', 'auth-marker', 'idem-marker',
]

const ids = (rows: any[]) => rows.map((r) => r.id).sort()

// One row per member of household A for each domain, plus household B rows
// and a row of child-a's left behind in household B (a stale membership).
function seed() {
  // Replace the harness's generic rows of these tables with per-member ones.
  for (const model of [
    'allowance', 'wishlistItem', 'sickDay', 'medication', 'emergencyContact', 'pickup', 'pinnedNote', 'familyLocation',
    'upload', 'choreAssignment', 'pushSubscription', 'calendarSubscription', 'calendarConnection', 'budgetCategory',
    'handoff',
  ]) {
    db.rows(model).length = 0
  }
  const members = [
    ['parent-a', FAMILY_A, 'pa'],
    ['teen-a', FAMILY_A, 'ta'],
    ['child-a', FAMILY_A, 'ca'],
    ['parent-b', FAMILY_B, 'pb'],
    ['child-a', FAMILY_B, 'stale'],
  ] as const
  for (const [uid, family_id, k] of members) {
    const tag = family_id === FAMILY_B ? FOREIGN : 'Home'
    db.rows('allowance').push({
      id: `allow-${k}`, family_id, from_user_id: family_id === FAMILY_A ? 'parent-a' : 'parent-b', to_user_id: uid,
      amount: 5, reason: `${tag} weekly`, status: 'paid', scheduled_for: null, paid_at: T, created_at: T, updated_at: T,
    })
    db.rows('wishlistItem').push({
      id: `wish-${k}`, family_id, requested_by: uid, title: `${tag} bike`, link: null, description: null,
      approx_price: null, status: 'idle', denied_reason: null, status_changed_at: null, status_changed_by: null,
      created_at: T, updated_at: T,
    })
    db.rows('sickDay').push({
      id: `sick-${k}`, family_id, person_id: uid, started_at: T, ended_at: null, symptoms: `${tag} cough`,
      severity: 'mild', status: 'recovered', temperature_log: null, notes: null, created_by: uid, created_at: T, updated_at: T,
    })
    db.rows('medication').push({
      id: `med-${k}`, sick_day_id: `sick-${k}`, family_id, person_id: uid, name: `${tag} syrup`, dosage: '5ml',
      schedule: 'daily', next_dose_at: null, last_dose_at: null, active: false, notes: null, created_by: uid,
      created_at: T, updated_at: T,
    })
    db.rows('emergencyContact').push({
      id: `card-${k}`, family_id, person_id: uid, person_name: `${tag} person`, relationship: 'self',
      allergies: `${tag} peanuts`, insurance_id: `INS-${k}`, created_at: T, updated_at: T,
    })
    db.rows('pickup').push({
      id: `pickup-${k}`, family_id, title: `${tag} soccer`, location: null, pickup_time: T, assigned_to: uid,
      created_by: family_id === FAMILY_A ? 'parent-a' : 'parent-b', notes: null, completed: false, completed_at: null,
      created_at: T, updated_at: T,
    })
    db.rows('pinnedNote').push({
      id: `note-${k}`, family_id, title: `${tag} note`, body: 'body', color: 'yellow', pinned: true, created_by: uid,
      created_at: T, updated_at: T,
    })
    db.rows('familyLocation').push({
      id: `loc-${k}`, family_id, user_id: uid, label: `${tag} school`, address: `${tag} 1 Main St`, latitude: 1,
      longitude: 2, is_primary: false, created_at: T, updated_at: T,
    })
    db.rows('upload').push({
      id: `upload-${k}`, family_id, uploaded_by: uid, filename: `${k}000000000000.jpg`, content_type: 'image/jpeg',
      size_bytes: 10, created_at: T,
    })
    db.rows('choreAssignment').push({
      id: `ca-${k}`, family_id, chore_id: 'chore-x', assigned_to: uid, due_date: T, status: 'pending', photo_url: null,
      completed_at: null, completed_by: null, approved_at: null, approved_by: null, approval_notes: null,
      xp_awarded: 0, idempotency_key: `idem-marker-${k}`, created_at: T, updated_at: T,
    })
    db.rows('pushSubscription').push({
      id: `push-${k}`, family_id, user_id: uid, endpoint: `https://push.example/endpoint-marker-${k}`,
      keys: { p256dh: `p256dh-marker-${k}`, auth: `auth-marker-${k}` }, created_at: T, updated_at: T,
    })
    db.rows('calendarSubscription').push({
      id: `sub-${k}`, family_id, name: `${tag} school cal`, url_enc: `v1:feed-url-ciphertext-${k}`, color: null,
      last_fetched_at: null, last_status: 'ok', last_error: null, etag: `etag-marker-${k}`, last_modified: 'x',
      created_by: uid, created_at: T, updated_at: T,
    })
    db.rows('calendarConnection').push({
      id: `conn-${k}`, family_id, user_id: uid, provider: 'google', calendar_id: null, calendar_name: `${tag} cal`,
      access_token_enc: `access-token-marker-${k}`, refresh_token_enc: `refresh-token-marker-${k}`,
      token_expires_at: T, sync_cursor: `sync-cursor-marker-${k}`, push_mode: 'linked', generation: 0, status: 'ok',
      last_synced_at: null, last_error: null, conflicts_count: 0, last_conflict_at: null, created_at: T, updated_at: T,
    })
    db.rows('budgetCategory').push({
      id: `cat-${k}`, family_id, name: `${tag} groceries`, icon: 'x', color: '#000000', type: 'expense',
      budget_limit: 100, created_by: uid, created_at: T, import_metadata: { source: 'secret-import' },
    })
    db.rows('handoff').push({
      id: `handoff-${k}`, family_id, sitter_name: `${tag} sitter`, sitter_phone: '555', arrival_time: T,
      departure_time: T, code_words: `${tag} pineapple`, share_token: `share-token-marker-${k}`,
      share_expires_at: T, created_by: uid, created_at: T, updated_at: T,
    })
  }
}

async function exportAs(who: 'parentA' | 'teenA' | 'childA') {
  const res = await GET(req({ as: who }))
  expect(res.status).toBe(200)
  const raw = await res.text()
  return { raw, body: JSON.parse(raw) }
}

describe('GET /api/users/export — per-person domains', () => {
  beforeEach(() => {
    db.reset()
    seed()
  })

  it.each(['parentA', 'teenA', 'childA'] as const)('%s export has every per-person key as an array', async (who) => {
    const { body } = await exportAs(who)
    for (const key of PERSONAL_KEYS) expect(Array.isArray(body[key])).toBe(true)
  })

  it("a child's export carries only their own rows, and none of the parent-only domains", async () => {
    const { body } = await exportAs('childA')
    expect(ids(body.allowances)).toEqual(['allow-ca'])
    expect(ids(body.wishlistItems)).toEqual(['wish-ca'])
    expect(ids(body.sickDays)).toEqual(['sick-ca'])
    expect(ids(body.medications)).toEqual(['med-ca'])
    expect(ids(body.emergencyContacts)).toEqual(['card-ca'])
    expect(ids(body.pickups)).toEqual(['pickup-ca'])
    expect(ids(body.pinnedNotes)).toEqual(['note-ca'])
    expect(ids(body.uploads)).toEqual(['upload-ca'])
    expect(ids(body.choreAssignments)).toEqual(['ca-ca'])
    expect(ids(body.pushSubscriptions)).toEqual(['push-ca'])
    // The seeded anniversary of household A is about child-a.
    expect(ids(body.anniversaries)).toEqual(['ann-a'])
    // Parent-only (addresses, finance, calendar sync) and parent/teen-only (ICS).
    expect(body.familyLocations).toEqual([])
    expect(body.budgetCategories).toEqual([])
    expect(body.calendarConnections).toEqual([])
    expect(body.calendarSubscriptions).toEqual([])
    // Handoffs: the child view only (who is coming and when).
    expect(body.handoffs).toEqual([
      { id: 'handoff-ca', sitter_name: 'Home sitter', arrival_time: T.toISOString(), departure_time: T.toISOString() },
    ])
  })

  it("a teen's export adds their calendar subscriptions but not the parent-only domains", async () => {
    const { body } = await exportAs('teenA')
    expect(ids(body.calendarSubscriptions)).toEqual(['sub-ta'])
    expect(body.familyLocations).toEqual([])
    expect(body.budgetCategories).toEqual([])
    expect(body.calendarConnections).toEqual([])
    expect(body.handoffs[0]).toMatchObject({ id: 'handoff-ta', code_words: 'Home pineapple' })
    expect(body.handoffs[0]).not.toHaveProperty('share_expires_at')
  })

  it("a parent's export has their own rows including parent-only domains, and allowances they gave", async () => {
    const { body } = await exportAs('parentA')
    expect(ids(body.allowances)).toEqual(['allow-ca', 'allow-pa', 'allow-ta'])
    expect(ids(body.wishlistItems)).toEqual(['wish-pa'])
    expect(ids(body.sickDays)).toEqual(['sick-pa'])
    expect(ids(body.emergencyContacts)).toEqual(['card-pa'])
    // Pickups they created (all of household A's) or are assigned.
    expect(ids(body.pickups)).toEqual(['pickup-ca', 'pickup-pa', 'pickup-ta'])
    expect(ids(body.familyLocations)).toEqual(['loc-pa'])
    expect(body.familyLocations[0]).toMatchObject({ address: 'Home 1 Main St' })
    expect(ids(body.budgetCategories)).toEqual(['cat-pa'])
    expect(body.budgetCategories[0]).not.toHaveProperty('import_metadata')
    expect(ids(body.calendarConnections)).toEqual(['conn-pa'])
    expect(ids(body.calendarSubscriptions)).toEqual(['sub-pa'])
    expect(body.handoffs[0]).toMatchObject({ id: 'handoff-pa', share_expires_at: T.toISOString() })
  })

  it.each(['parentA', 'teenA', 'childA'] as const)('%s export never contains a secret or a family_id', async (who) => {
    const { body, raw } = await exportAs(who)
    for (const secret of SECRETS) expect(raw).not.toContain(secret)
    expect(raw).not.toContain('secret-import')
    for (const key of PERSONAL_KEYS) {
      for (const row of body[key]) {
        expect(row).not.toHaveProperty('family_id')
        for (const field of ['share_token', 'url_enc', 'etag', 'access_token_enc', 'refresh_token_enc', 'sync_cursor', 'endpoint', 'keys', 'idempotency_key']) {
          expect(row).not.toHaveProperty(field)
        }
      }
    }
  })

  it.each(['parentA', 'teenA', 'childA'] as const)(
    "%s export never has another household's rows, even the caller's own stale ones",
    async (who) => {
      const { raw } = await exportAs(who)
      expect(raw).not.toContain(FOREIGN)
      expect(raw).not.toMatch(/-(pb|stale)"/)
    }
  )

  it("a removed member's export has none of the old household's chores", async () => {
    // Done chores stay assigned to a removed member (O-34); the export must not
    // hand them back the old household's chore titles and notes.
    db.find('user', 'child-a')!.family_id = null
    const { body } = await exportAs('childA')
    expect(body.chores).toEqual([])
  })

  it('a member with no household gets empty per-person domains', async () => {
    db.find('user', 'child-a')!.family_id = null
    const { body } = await exportAs('childA')
    for (const key of PERSONAL_KEYS) expect(body[key]).toEqual([])
  })
})
