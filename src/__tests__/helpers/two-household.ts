// Shared two-household harness for route-level isolation tests (#102).
//
// This file is NOT a test (jest only collects `*.test.ts`). It provides:
//
//   * a small in-memory fake of the Prisma client that genuinely evaluates
//     `where` clauses (family_id, id, OR/AND/NOT, in, gte/lt, relation filters)
//     against a family-A / family-B dataset, and applies `select`/`include`
//     through a relation map — so a route that forgets `family_id` really does
//     return the other household's rows instead of a hard-coded stub;
//   * session mocks for both auth styles used by the API
//     (`authenticateWithFamily`/`authenticateRequest` read the request cookie,
//     `getServerUser()` reads `next/headers` cookies) — the real
//     `@/lib/api-auth` and `@/lib/supabase/server` code runs on top of them;
//   * a minimal `next/server` mock and a request builder.
//
// Usage in a test file (jest.mock factories may only reach module state via
// require, hence the pattern):
//
//   jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
//   jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
//   jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
//   jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
//   jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));
//
// Every family-B row carries the marker FOREIGN in its human-readable text so
// tests can assert a response body never contains another household's data.

export const FAMILY_A = 'family-A'
export const FAMILY_B = 'family-B'
export const FOREIGN = 'FOREIGN'

type Row = Record<string, any>
type Tables = Record<string, Row[]>

export type UserKey = 'parentA' | 'teenA' | 'childA' | 'parentB' | 'childB' | 'loner'

export const USER_IDS: Record<UserKey, string> = {
  parentA: 'parent-a',
  teenA: 'teen-a',
  childA: 'child-a',
  parentB: 'parent-b',
  childB: 'child-b',
  loner: 'loner',
}

const T0 = new Date('2026-09-01T00:00:00Z')
const SOON = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
const LATER = new Date(Date.now() + 6 * 60 * 60 * 1000)

function user(id: string, name: string, role: string, family_id: string | null): Row {
  return {
    id,
    email: `${id}@example.test`,
    name,
    role,
    family_id,
    age: null,
    avatar_url: null,
    email_verified: true,
    xp: 500,
    level: 1,
    streak: 0,
    best_streak: 0,
    last_chore_date: null,
    created_at: T0,
    password: 'hash',
    token_version: 0,
  }
}

// One row per family for every family-owned model the API exposes. Family-B
// text fields contain FOREIGN.
function seed(): Tables {
  const perFamily = (fn: (f: 'a' | 'b', familyId: string, tag: string) => Row): Row[] => [
    fn('a', FAMILY_A, 'Home'),
    fn('b', FAMILY_B, FOREIGN),
  ]
  return {
    family: [
      {
        id: FAMILY_A, name: 'Household A', invite_code: 'INVITEA1', feed_token: 'feed-token-a',
        features: null, subscription_tier: 'free', created_at: T0,
        travel_mode_active: true, travel_start_date: T0, travel_end_date: SOON, travel_destination: 'Lisbon',
        capture_ai_key_enc: null, capture_ai_base_url: null, capture_ai_model: null,
      },
      {
        id: FAMILY_B, name: `Household ${FOREIGN}`, invite_code: 'INVITEB1', feed_token: 'feed-token-b',
        features: null, subscription_tier: 'free', created_at: T0,
        travel_mode_active: true, travel_start_date: T0, travel_end_date: SOON, travel_destination: `${FOREIGN} Island`,
        capture_ai_key_enc: null, capture_ai_base_url: null, capture_ai_model: null,
      },
    ],
    user: [
      user('parent-a', 'Parent A', 'parent', FAMILY_A),
      user('teen-a', 'Teen A', 'teen', FAMILY_A),
      user('child-a', 'Child A', 'child', FAMILY_A),
      user('parent-b', `Parent ${FOREIGN}`, 'parent', FAMILY_B),
      user('child-b', `Child ${FOREIGN}`, 'child', FAMILY_B),
      user('loner', 'Loner', 'parent', null),
    ],
    anniversary: perFamily((f, family_id, tag) => ({
      id: `ann-${f}`, family_id, name: `${tag} birthday`, type: 'birthday', date: T0, notes: null,
      // Legacy rows: created before Anniversary.created_by existed (D9).
      person_id: `child-${f}`, created_by: null, created_at: T0,
    })),
    event: perFamily((f, family_id, tag) => ({
      id: `event-${f}`, family_id, title: `${tag} dentist`, description: null, start_time: SOON,
      end_time: SOON, location: `${tag} clinic`, event_type: 'appointment', recurrence: null,
      created_by: `parent-${f}`, project_id: null, is_task: false, created_at: T0,
    })),
    chore: perFamily((f, family_id, tag) => ({
      id: `chore-${f}`, family_id, title: `${tag} dishes`, description: null, points: 10,
      assigned_to: `child-${f}`, due_date: SOON, status: 'pending', frequency: 'once',
      difficulty: 'easy', created_by: `parent-${f}`, photo_url: `/api/files/chores/${f === 'a' ? 'aaaaaaaaaaaaaaaa' : 'bbbbbbbbbbbbbbbb'}.jpg`,
      recurrence_id: null, completed_at: null, created_at: T0,
    })),
    choreAssignment: [],
    // D3 ownership records. Empty at seed: the seeded chore photos above are
    // legacy files with no Upload row. Tests add rows as POST /api/upload would.
    upload: [],
    list: perFamily((f, family_id, tag) => ({
      id: `list-${f}`, family_id, name: `${tag} groceries`, type: 'grocery', description: null,
      created_by: `parent-${f}`, created_at: T0, updated_at: T0,
    })),
    listItem: perFamily((f, _family_id, tag) => ({
      id: `item-${f}`, list_id: `list-${f}`, content: `${tag} milk`, quantity: 1, category: null,
      notes: null, checked: false, checked_by: null, checked_at: null, added_by: `parent-${f}`,
      position: 1, created_at: T0,
    })),
    familyMeal: perFamily((f, family_id, tag) => ({
      id: `meal-${f}`, family_id, date: SOON, meal_type: 'dinner', recipe_name: `${tag} pasta`,
      notes: null, cook_id: `parent-${f}`, created_by: `parent-${f}`, created_at: T0,
    })),
    pinnedNote: perFamily((f, family_id, tag) => ({
      id: `note-${f}`, family_id, title: `${tag} wifi`, body: `${tag} password`, color: 'yellow',
      created_by: `parent-${f}`, created_at: T0,
    })),
    pickup: perFamily((f, family_id, tag) => ({
      id: `pickup-${f}`, family_id, title: `${tag} school pickup`, location: `${tag} school`,
      pickup_time: SOON, completed: false, completed_at: null, assigned_to: `parent-${f}`,
      notes: null, created_by: `parent-${f}`, created_at: T0,
    })),
    allowance: perFamily((f, family_id, tag) => ({
      id: `allow-${f}`, family_id, from_user_id: `parent-${f}`, to_user_id: `child-${f}`,
      amount: 5, reason: `${tag} weekly`, status: 'pending', scheduled_for: null, paid_at: null,
      created_at: T0,
    })),
    familyLocation: perFamily((f, family_id, tag) => ({
      id: `loc-${f}`, family_id, user_id: `parent-${f}`, label: 'Home',
      address: `1 ${tag} Street`, is_primary: true, created_at: T0,
    })),
    sickDay: perFamily((f, family_id, tag) => ({
      id: `sick-${f}`, family_id, person_id: `child-${f}`, started_at: T0, ended_at: null,
      symptoms: `${tag} cough`, severity: 'mild', status: 'active', temperature_log: [],
      notes: null, created_by: `parent-${f}`, created_at: T0,
    })),
    medication: perFamily((f, family_id, tag) => ({
      id: `med-${f}`, family_id, sick_day_id: `sick-${f}`, person_id: `child-${f}`,
      name: `${tag} syrup`, dosage: '5ml', schedule: 'every 6h', next_dose_at: null,
      last_dose_at: null, active: true, notes: null, created_by: `parent-${f}`, created_at: T0,
    })),
    emergencyContact: perFamily((f, family_id, tag) => ({
      id: `contact-${f}`, family_id, person_id: `child-${f}`, person_name: `${tag} kid`,
      relationship: 'child', blood_type: 'O+', allergies: `${tag} peanuts`, medications: null,
      medical_conditions: null, doctor_name: null, doctor_phone: null, dentist_name: null,
      dentist_phone: null, insurance_provider: null, insurance_id: null,
      emergency_contact_name: null, emergency_contact_phone: null,
      emergency_contact_relation: null, notes: null, created_at: T0,
    })),
    handoff: perFamily((f, family_id, tag) => ({
      id: `handoff-${f}`, family_id, sitter_name: `${tag} sitter`, sitter_phone: '555',
      arrival_time: null, departure_time: null, kids_bedtimes: null, where_snacks: null,
      pickup_authorized: null, code_words: `${tag} pineapple`, pet_care: null,
      emergency_notes: null, house_notes: null, general_notes: null,
      share_token: `share-token-${f}`, share_expires_at: LATER, created_by: `parent-${f}`,
      created_at: T0,
    })),
    budgetCategory: perFamily((f, family_id, tag) => ({
      id: `cat-${f}`, family_id, name: `${tag} groceries`, icon: 'x', color: '#000',
      type: 'expense', budget_limit: 100, created_by: `parent-${f}`, created_at: T0,
    })),
    transaction: perFamily((f, family_id, tag) => ({
      id: `txn-${f}`, family_id, user_id: `parent-${f}`, amount: 42, type: 'expense',
      category_id: `cat-${f}`, description: `${tag} shop`, notes: null, date: T0,
      is_recurring: false, recurring_interval: null, list_item_id: null, created_at: T0,
    })),
    project: perFamily((f, family_id, tag) => ({
      id: `proj-${f}`, family_id, name: `${tag} garage`, description: null, color: '#000',
      status: 'active', created_by: `parent-${f}`, created_at: T0, updated_at: T0,
    })),
    projectTask: perFamily((f, _family_id, tag) => ({
      id: `task-${f}`, project_id: `proj-${f}`, title: `${tag} sweep`, description: null,
      completed: false, assigned_to: `child-${f}`, due_date: SOON, position: 0, created_at: T0,
    })),
    reward: perFamily((f, family_id, tag) => ({
      id: `reward-${f}`, family_id, name: `${tag} ice cream`, description: null, cost: 10,
      icon: 'gift', status: 'available', created_by: `parent-${f}`, claimed_by: null,
      claimed_at: null, approved: false, created_at: T0,
    })),
    wishlistItem: perFamily((f, family_id, tag) => ({
      id: `wish-${f}`, family_id, requested_by: `child-${f}`, title: `${tag} bike`, link: null,
      description: null, approx_price: null, status: 'idle', denied_reason: null,
      status_changed_at: null, status_changed_by: null, created_at: T0,
    })),
    message: perFamily((f, family_id, tag) => ({
      id: `msg-${f}`, family_id, sender_id: `parent-${f}`, content: `${tag} hello`, type: 'text',
      read_by: [], created_at: T0,
    })),
    notification: perFamily((f, _family_id, tag) => ({
      id: `notif-${f}`, user_id: `parent-${f}`, title: `${tag} alert`, message: `${tag}`,
      type: 'system', read: false, created_at: T0,
    })),
    activity: perFamily((f, family_id, tag) => ({
      id: `act-${f}`, family_id, user_id: `parent-${f}`, type: 'chore_completed',
      title: `${tag} did a thing`, description: null, metadata: null, created_at: T0,
    })),
    familyInvite: perFamily((f, family_id, tag) => ({
      id: `invite-${f}`, family_id, email: `${tag.toLowerCase()}@invitee.test`, role: 'child',
      token_hash: `hash-${f}`, expires_at: SOON, accepted_at: null, created_by: `parent-${f}`,
      created_at: T0,
    })),
    importJob: perFamily((f, family_id) => ({
      id: `job-${f}`, family_id, source_app: 'x', source_version: '1', status: 'done',
      dry_run: true, started_at: T0, completed_at: T0, summary: null, error: null,
    })),
  }
}

// ---------------------------------------------------------------------------
// Relation map: model -> relation name -> how to resolve it.
type Rel = { model: string; fk: string; many?: boolean; ref?: string }
const RELATIONS: Record<string, Record<string, Rel>> = {
  user: { family: { model: 'family', fk: 'family_id' } },
  family: { members: { model: 'user', fk: 'family_id', many: true, ref: 'id' } },
  anniversary: { creator: { model: 'user', fk: 'created_by' }, person: { model: 'user', fk: 'person_id' } },
  upload: { family: { model: 'family', fk: 'family_id' }, uploader: { model: 'user', fk: 'uploaded_by' } },
  chore: {
    assignee: { model: 'user', fk: 'assigned_to' },
    creator: { model: 'user', fk: 'created_by' },
    family: { model: 'family', fk: 'family_id' },
  },
  event: { creator: { model: 'user', fk: 'created_by' } },
  list: {
    creator: { model: 'user', fk: 'created_by' },
    items: { model: 'listItem', fk: 'list_id', many: true },
    family: { model: 'family', fk: 'family_id' },
  },
  listItem: { list: { model: 'list', fk: 'list_id' } },
  familyMeal: { cook: { model: 'user', fk: 'cook_id' }, creator: { model: 'user', fk: 'created_by' } },
  pickup: { assignee: { model: 'user', fk: 'assigned_to' } },
  allowance: { from_user: { model: 'user', fk: 'from_user_id' }, to_user: { model: 'user', fk: 'to_user_id' } },
  familyLocation: { user: { model: 'user', fk: 'user_id' } },
  medication: { person: { model: 'user', fk: 'person_id' } },
  sickDay: {
    person: { model: 'user', fk: 'person_id' },
    medications: { model: 'medication', fk: 'sick_day_id', many: true },
  },
  handoff: { family: { model: 'family', fk: 'family_id' } },
  budgetCategory: {
    creator: { model: 'user', fk: 'created_by' },
    transactions: { model: 'transaction', fk: 'category_id', many: true },
  },
  transaction: { category: { model: 'budgetCategory', fk: 'category_id' }, user: { model: 'user', fk: 'user_id' } },
  project: {
    creator: { model: 'user', fk: 'created_by' },
    tasks: { model: 'projectTask', fk: 'project_id', many: true },
    family: { model: 'family', fk: 'family_id' },
  },
  projectTask: { assignee: { model: 'user', fk: 'assigned_to' }, project: { model: 'project', fk: 'project_id' } },
  reward: { creator: { model: 'user', fk: 'created_by' }, claimer: { model: 'user', fk: 'claimed_by' } },
  wishlistItem: {
    requester: { model: 'user', fk: 'requested_by' },
    status_changer: { model: 'user', fk: 'status_changed_by' },
  },
  message: { sender: { model: 'user', fk: 'sender_id' } },
  activity: { user: { model: 'user', fk: 'user_id' }, family: { model: 'family', fk: 'family_id' } },
  familyInvite: { family: { model: 'family', fk: 'family_id' } },
  // Shared device (#240)
  householdDevice: {
    family: { model: 'family', fk: 'family_id' },
    creator: { model: 'user', fk: 'created_by' },
    sessions: { model: 'deviceSession', fk: 'device_id', many: true },
    events: { model: 'deviceAuditEvent', fk: 'device_id', many: true },
  },
  deviceSession: { device: { model: 'householdDevice', fk: 'device_id' } },
  devicePairing: { family: { model: 'family', fk: 'family_id' }, creator: { model: 'user', fk: 'created_by' } },
  parentElevationPin: { user: { model: 'user', fk: 'user_id' }, family: { model: 'family', fk: 'family_id' } },
  deviceAuditEvent: {
    family: { model: 'family', fk: 'family_id' },
    device: { model: 'householdDevice', fk: 'device_id' },
    actor: { model: 'user', fk: 'actor_user_id' },
  },
}

// ---------------------------------------------------------------------------
// The in-memory database.

export type Write = { model: string; op: string; args: any }

class FakeDb {
  tables: Tables = seed()
  writes: Write[] = []
  private seq = 0

  reset() {
    this.tables = seed()
    this.writes = []
    this.seq = 0
  }

  rows(model: string): Row[] {
    if (!this.tables[model]) this.tables[model] = []
    return this.tables[model]
  }

  find(model: string, id: string): Row | undefined {
    return this.rows(model).find((r) => r.id === id)
  }

  nextId(model: string) {
    this.seq += 1
    return `${model}-new-${this.seq}`
  }

  related(model: string, row: Row, relName: string): { rel: Rel; value: Row | Row[] | null } | null {
    const rel = RELATIONS[model]?.[relName]
    if (!rel) return null
    if (rel.many) {
      const key = rel.ref ?? 'id'
      return { rel, value: this.rows(rel.model).filter((r) => r[rel.fk] === row[key]) }
    }
    const fkValue = row[rel.fk]
    return { rel, value: fkValue == null ? null : this.find(rel.model, fkValue) ?? null }
  }
}

export const db = new FakeDb()

function cmp(a: any, b: any): number {
  // A column never written reads as NULL, as in the database.
  const av = a instanceof Date ? a.getTime() : a === undefined ? null : a
  const bv = b instanceof Date ? b.getTime() : b === undefined ? null : b
  if (av === bv) return 0
  if (av == null) return -1
  if (bv == null) return 1
  return av < bv ? -1 : 1
}

function isPlainObject(v: any): boolean {
  return v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)
}

function matchValue(value: any, cond: any): boolean {
  if (!isPlainObject(cond)) return cmp(value, cond) === 0
  for (const [op, arg] of Object.entries(cond)) {
    switch (op) {
      case 'equals':
        if (typeof arg === 'string' && typeof value === 'string' && cond.mode === 'insensitive') {
          if (arg.toLowerCase() !== value.toLowerCase()) return false
        } else if (cmp(value, arg) !== 0) return false
        break
      case 'mode':
        break
      case 'in':
        if (!(arg as any[]).some((x) => cmp(value, x) === 0)) return false
        break
      case 'notIn':
        if ((arg as any[]).some((x) => cmp(value, x) === 0)) return false
        break
      case 'not':
        if (isPlainObject(arg) ? matchValue(value, arg) : cmp(value, arg) === 0) return false
        break
      case 'lt':
        if (value == null || cmp(value, arg) >= 0) return false
        break
      case 'lte':
        if (value == null || cmp(value, arg) > 0) return false
        break
      case 'gt':
        if (value == null || cmp(value, arg) <= 0) return false
        break
      case 'gte':
        if (value == null || cmp(value, arg) < 0) return false
        break
      case 'contains':
        if (typeof value !== 'string' || !value.includes(arg as string)) return false
        break
      case 'startsWith':
        if (typeof value !== 'string' || !value.startsWith(arg as string)) return false
        break
      case 'has':
        if (!Array.isArray(value) || !value.includes(arg)) return false
        break
      default:
        throw new Error(`fake prisma: unsupported operator ${op}`)
    }
  }
  return true
}

export function matches(model: string, row: Row, where: any): boolean {
  if (!where) return true
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue
    if (key === 'AND') {
      if (!(Array.isArray(cond) ? cond : [cond]).every((w) => matches(model, row, w))) return false
      continue
    }
    if (key === 'OR') {
      if (!(cond as any[]).some((w) => matches(model, row, w))) return false
      continue
    }
    if (key === 'NOT') {
      if ((Array.isArray(cond) ? cond : [cond]).some((w) => matches(model, row, w))) return false
      continue
    }
    const relation = db.related(model, row, key)
    if (relation) {
      const { rel, value } = relation
      if (rel.many) {
        const list = value as Row[]
        const c = cond as any
        if (c.some && !list.some((r) => matches(rel.model, r, c.some))) return false
        if (c.every && !list.every((r) => matches(rel.model, r, c.every))) return false
        if (c.none && list.some((r) => matches(rel.model, r, c.none))) return false
      } else {
        if (!value || !matches(rel.model, value as Row, cond)) return false
      }
      continue
    }
    if (!matchValue(row[key], cond)) return false
  }
  return true
}

function project(model: string, row: Row | null | undefined, args: any = {}): Row | null {
  if (!row) return null
  const { select, include } = args
  let out: Row
  if (select) {
    out = {}
    for (const [key, on] of Object.entries(select)) {
      if (!on) continue
      if (key === '_count') {
        out._count = countRelations(model, row, (on as any).select)
        continue
      }
      const relation = db.related(model, row, key)
      if (relation) {
        out[key] = shapeRelated(relation, on)
      } else if (key in row) {
        out[key] = row[key]
      }
    }
  } else {
    out = { ...row }
  }
  if (include) {
    for (const [key, on] of Object.entries(include)) {
      if (!on) continue
      if (key === '_count') {
        out._count = countRelations(model, row, (on as any).select)
        continue
      }
      const relation = db.related(model, row, key)
      if (!relation) throw new Error(`fake prisma: unknown relation ${model}.${key}`)
      out[key] = shapeRelated(relation, on)
    }
  }
  return out
}

function shapeRelated(relation: { rel: Rel; value: Row | Row[] | null }, on: any) {
  const { rel, value } = relation
  const args = on === true ? {} : on
  if (rel.many) {
    let list = (value as Row[]).filter((r) => matches(rel.model, r, args.where))
    list = sortRows(list, args.orderBy)
    return list.map((r) => project(rel.model, r, args))
  }
  return project(rel.model, value as Row | null, args)
}

function countRelations(model: string, row: Row, select: Record<string, any> = {}) {
  const out: Record<string, number> = {}
  for (const key of Object.keys(select)) {
    const relation = db.related(model, row, key)
    out[key] = relation && Array.isArray(relation.value) ? relation.value.length : 0
  }
  return out
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy]
  return [...rows].sort((a, b) => {
    for (const o of orders) {
      const [key, dir] = Object.entries(o)[0] as [string, string]
      const c = cmp(a[key], b[key])
      if (c !== 0) return dir === 'desc' ? -c : c
    }
    return 0
  })
}

function applyData(model: string, row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    const rel = RELATIONS[model]?.[key]
    if (rel && isPlainObject(value) && (value as any).connect) {
      row[rel.fk] = (value as any).connect.id
      continue
    }
    if (isPlainObject(value)) {
      const v = value as any
      if ('increment' in v) row[key] = (row[key] ?? 0) + v.increment
      else if ('decrement' in v) row[key] = (row[key] ?? 0) - v.decrement
      else if ('push' in v) row[key] = [...(row[key] ?? []), v.push]
      else row[key] = value
      continue
    }
    row[key] = value
  }
}

function notFound(model: string): Error {
  const err = new Error(`fake prisma: ${model} record to update not found`) as Error & { code: string }
  err.code = 'P2025'
  return err
}

function delegate(model: string) {
  const all = () => db.rows(model)
  const log = (op: string, args: any) => db.writes.push({ model, op, args })
  return {
    findUnique: async (args: any) => project(model, all().find((r) => matches(model, r, args.where)), args),
    findFirst: async (args: any = {}) =>
      project(model, sortRows(all().filter((r) => matches(model, r, args.where)), args.orderBy)[0], args),
    findMany: async (args: any = {}) => {
      let rows = sortRows(all().filter((r) => matches(model, r, args.where)), args.orderBy)
      if (args.skip) rows = rows.slice(args.skip)
      if (args.take !== undefined) rows = rows.slice(0, args.take)
      return rows.map((r) => project(model, r, args))
    },
    count: async (args: any = {}) => all().filter((r) => matches(model, r, args.where)).length,
    create: async (args: any) => {
      log('create', args)
      const row: Row = { id: db.nextId(model), created_at: new Date() }
      applyData(model, row, args.data)
      all().push(row)
      return project(model, row, args)
    },
    update: async (args: any) => {
      log('update', args)
      const row = all().find((r) => matches(model, r, args.where))
      if (!row) throw notFound(model)
      applyData(model, row, args.data)
      return project(model, row, args)
    },
    upsert: async (args: any) => {
      log('upsert', args)
      const row = all().find((r) => matches(model, r, args.where))
      if (row) {
        applyData(model, row, args.update)
        return project(model, row, args)
      }
      const created: Row = { id: db.nextId(model), created_at: new Date() }
      applyData(model, created, args.create)
      all().push(created)
      return project(model, created, args)
    },
    updateMany: async (args: any) => {
      log('updateMany', args)
      const rows = all().filter((r) => matches(model, r, args.where))
      rows.forEach((r) => applyData(model, r, args.data))
      return { count: rows.length }
    },
    delete: async (args: any) => {
      log('delete', args)
      const idx = all().findIndex((r) => matches(model, r, args.where))
      if (idx < 0) throw notFound(model)
      const [row] = all().splice(idx, 1)
      return row
    },
    deleteMany: async (args: any = {}) => {
      log('deleteMany', args)
      const keep = all().filter((r) => !matches(model, r, args.where))
      const count = all().length - keep.length
      db.tables[model] = keep
      return { count }
    },
    aggregate: async (args: any) => {
      const rows = all().filter((r) => matches(model, r, args.where))
      const out: Row = {}
      if (args._max) {
        out._max = {}
        for (const key of Object.keys(args._max)) {
          const vals = rows.map((r) => r[key]).filter((v) => v != null)
          out._max[key] = vals.length ? Math.max(...vals) : null
        }
      }
      return out
    },
    groupBy: async (args: any) => {
      const rows = all().filter((r) => matches(model, r, args.where))
      const groups = new Map<string, Row[]>()
      for (const r of rows) {
        const k = JSON.stringify(args.by.map((b: string) => r[b]))
        groups.set(k, [...(groups.get(k) ?? []), r])
      }
      return [...groups.values()].map((g) => {
        const out: Row = {}
        for (const b of args.by) out[b] = g[0][b]
        if (args._sum) {
          out._sum = {}
          for (const key of Object.keys(args._sum)) out._sum[key] = g.reduce((s, r) => s + (r[key] ?? 0), 0)
        }
        return out
      })
    },
  }
}

const delegates: Record<string, ReturnType<typeof delegate>> = {}

export const fakePrisma: any = new Proxy(
  {},
  {
    get(_target, prop: string) {
      if (prop === '$transaction') {
        return async (arg: any) => (typeof arg === 'function' ? arg(fakePrisma) : Promise.all(arg))
      }
      if (prop === '$executeRaw' || prop === '$queryRaw') return async () => 0
      if (prop === 'then') return undefined
      if (!delegates[prop]) delegates[prop] = delegate(prop)
      return delegates[prop]
    },
  }
)

/** Writes (create/update/delete/...) recorded since the last reset, optionally for one model. */
export function writesTo(model?: string): Write[] {
  return model ? db.writes.filter((w) => w.model === model) : db.writes
}

// ---------------------------------------------------------------------------
// Sessions. A session token is just `session:<userId>`; the mocked
// verifySessionToken resolves it against the fake user table, so role and
// family_id always come from the dataset.

let currentToken: string | null = null

export function actAs(who: UserKey | null): string | null {
  currentToken = who ? `session:${USER_IDS[who]}` : null
  return currentToken
}

async function payloadFor(token: string | undefined | null) {
  if (!token || !token.startsWith('session:')) return null
  const u = db.find('user', token.slice('session:'.length))
  if (!u) return null
  return { userId: u.id, email: u.email, role: u.role, family_id: u.family_id, tv: u.token_version }
}

export const sessionMock = {
  // Like the real verifySessionToken (D6), role and family_id always come from
  // the user table, so a test can change a member's role mid-test.
  verifySessionToken: payloadFor,
  resolveSession: async (p: { userId: string }) => payloadFor(`session:${p.userId}`),
  isSessionCurrent: async () => true,
  getTokenVersion: async (id: string) => db.find('user', id)?.token_version ?? null,
}

export const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => (name === 'session_token' && currentToken ? { value: currentToken } : undefined),
  }),
  headers: async () => new Headers(),
}

// ---------------------------------------------------------------------------
// next/server + requests.

export type SetCookie = { name: string; value: string; options: Record<string, unknown> }

class MockNextResponse {
  status: number
  headers: Headers
  body: unknown
  /** Every `cookies.set` call, in order, so tests can assert Set-Cookie behaviour. */
  setCookies: SetCookie[] = []
  cookies = {
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      this.setCookies.push({ name, value, options })
    },
    get: () => undefined,
  }
  constructor(body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
    this.body = body
    this.status = init?.status ?? 200
    this.headers = new Headers(init?.headers)
  }
  async json() {
    return typeof this.body === 'string' ? JSON.parse(this.body) : this.body
  }
  async text() {
    return typeof this.body === 'string' ? this.body : JSON.stringify(this.body)
  }
  static json(data: unknown, init?: { status?: number; headers?: Record<string, string> }) {
    return new MockNextResponse(data, init)
  }
  static redirect(url: URL | string, status = 307) {
    return new MockNextResponse(null, { status, headers: { location: String(url) } })
  }
  static next() {
    return new MockNextResponse(null)
  }
}

export const nextServerMock = { NextResponse: MockNextResponse, NextRequest: class {} }

export type RequestOptions = {
  as?: UserKey | null
  method?: string
  path?: string
  query?: Record<string, string>
  body?: unknown
}

/**
 * Build a request for a route handler and set the session for `getServerUser()`
 * too, so both auth styles see the same caller. `as: null` is unauthenticated.
 */
export function req(opts: RequestOptions = {}): any {
  const token = actAs(opts.as === undefined ? null : opts.as)
  const url = new URL(`http://localhost${opts.path ?? '/api/test'}`)
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v)
  return {
    method: opts.method ?? 'GET',
    url: url.toString(),
    nextUrl: url,
    headers: new Headers({ 'x-forwarded-for': '198.51.100.7' }),
    cookies: { get: (name: string) => (name === 'session_token' && token ? { value: token } : undefined) },
    json: async () => {
      if (opts.body === undefined) throw new SyntaxError('Unexpected end of JSON input')
      return opts.body
    },
    text: async () => JSON.stringify(opts.body ?? null),
  }
}

/** Route context for dynamic segments. */
export function params<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) }
}

export async function bodyOf(res: any): Promise<any> {
  return res && typeof res.json === 'function' ? res.json() : undefined
}

/**
 * A cross-family attempt must be refused (403 or 404, per the route's
 * convention) and the response must not carry any family-B data.
 */
export async function expectDenied(res: any, statuses: number[] = [403, 404]) {
  expect(statuses).toContain(res.status)
  const body = await bodyOf(res)
  expect(JSON.stringify(body ?? null)).not.toContain(FOREIGN)
}

/** The response body contains no family-B data. */
export async function expectNoForeignData(res: any) {
  const body = await bodyOf(res)
  expect(JSON.stringify(body ?? null)).not.toContain(FOREIGN)
  return body
}

// ---------------------------------------------------------------------------
// Side-effect modules most routes pull in.

export const rateLimitMock = {
  checkRateLimit: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  isRateLimited: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  resetRateLimit: async () => undefined,
  cleanupRateLimits: async () => 0,
}

export const notificationsMock = {
  notificationServiceServer: {
    sendNotification: async () => undefined,
    notifyChoreAssignment: async () => undefined,
  },
}
