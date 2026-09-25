/**
 * Deterministic development/test fixture dataset (#154).
 *
 * Everything here is SYNTHETIC. Names are invented, emails use the reserved
 * `example.test` domain, and no row is copied from any real household.
 *
 * - Every fixture row id starts with FIXTURE_ID_PREFIX (`fx_`). Seed upserts by
 *   these ids; reset deletes only these ids (see ./seed.ts).
 * - Every timestamp derives from one anchor (FIXTURES_ANCHOR_DATE, default
 *   DEFAULT_FIXTURE_ANCHOR) so screenshots and snapshots are repeatable.
 * - `buildFixtureDataset` is pure: same anchor in, deep-equal dataset out.
 *
 * Grocery/shopping lists use the existing List/ListItem model (type 'grocery'
 * as created by the capture flow, and 'shopping'), which is what the dashboard
 * Shopping card reads (src/lib/shopping-snapshot.ts).
 *
 * Deliberately NOT included yet (see docs/testing/TEST_DATA.md):
 * - meal / recipe fixtures: waiting on the canonical model in #149;
 * - shared-device (tablet) fixtures: schema not ready.
 *
 * This file must stay importable by plain Node type-stripping (used by
 * scripts/fixtures.mjs): only `import type`, no enums/namespaces/parameter
 * properties, no path-alias runtime imports.
 */
import type { Prisma } from '@prisma/client'

export const FIXTURE_ID_PREFIX = 'fx_'

/** Monday, 12:00 UTC. Chosen so "today" is a school/work day in every US/EU zone. */
export const DEFAULT_FIXTURE_ANCHOR = '2026-01-05T12:00:00.000Z'

/**
 * Shared password for every fixture account. FAKE — for local/test databases
 * only. It is public in this repository and must never be used anywhere real.
 */
export const FIXTURE_PASSWORD = 'Fixture-Only-Passw0rd!'

export const FIXTURE_EMAIL_DOMAIN = 'example.test'

export const FIXTURE_IDS = {
  familyA: {
    family: 'fx_family_a',
    parent: 'fx_user_a_parent',
    teen: 'fx_user_a_teen',
    child: 'fx_user_a_child',
    longNameChild: 'fx_user_a_child_longname',
    /** A standalone event created by the parent. */
    event: 'fx_event_a_today_school',
    /** A pending, one-off chore assigned to the teen. */
    chore: 'fx_chore_a_pending_teen',
    /** Template of the weekly recurring series (recurrence_id === this id). */
    recurringChoreTemplate: 'fx_chore_a_weekly_tpl',
    reward: 'fx_reward_a_available',
    list: 'fx_list_a_todo_weekend',
    listItem: 'fx_item_a_weekend_1',
    /** type 'grocery': 6 open items (one more than the dashboard card shows) + 2 checked. */
    groceryList: 'fx_list_a_grocery',
    /** Oldest open grocery item (quantity 2): first row of the dashboard Shopping card. */
    groceryItem: 'fx_item_a_grocery_1',
  },
  familyB: {
    family: 'fx_family_b',
    parent: 'fx_user_b_parent',
    teen: 'fx_user_b_teen',
    child: 'fx_user_b_child',
    event: 'fx_event_b_dentist',
    chore: 'fx_chore_b_pending_teen',
    reward: 'fx_reward_b_available',
    list: 'fx_list_b_todo',
    listItem: 'fx_item_b_1',
    /** type 'shopping': one open item, one checked. */
    shoppingList: 'fx_list_b_shopping',
    shoppingItem: 'fx_item_b_shopping_1',
  },
  familyEmpty: {
    family: 'fx_family_empty',
    parent: 'fx_user_empty_parent',
  },
} as const

export const FIXTURE_EMAILS = {
  familyA: {
    parent: 'parent.a@example.test',
    teen: 'teen.a@example.test',
    child: 'child.a@example.test',
    longNameChild: 'child.longname.a@example.test',
  },
  familyB: {
    parent: 'parent.b@example.test',
    teen: 'teen.b@example.test',
    child: 'child.b@example.test',
  },
  familyEmpty: {
    parent: 'parent.empty@example.test',
  },
} as const

/**
 * Cross-family ids for negative (isolation) tests: an actor in `actor`'s
 * family attempting to read/write the `foreign` family's resources must be
 * refused. Both directions are listed so tests can be symmetric.
 */
export const FIXTURE_CROSS_FAMILY = {
  aToB: { actor: FIXTURE_IDS.familyA, foreign: FIXTURE_IDS.familyB },
  bToA: { actor: FIXTURE_IDS.familyB, foreign: FIXTURE_IDS.familyA },
} as const

type WithId<T> = T & { id: string }

export type FixtureFamily = WithId<Prisma.FamilyUncheckedCreateInput> & { invite_code: string }
/** No password: the seed hashes FIXTURE_PASSWORD at write time (bcrypt salts are random). */
export type FixtureUser = WithId<Omit<Prisma.UserUncheckedCreateInput, 'password'>> & {
  family_id: string
  role: 'parent' | 'teen' | 'child'
}
export type FixtureEvent = WithId<Prisma.EventUncheckedCreateInput>
export type FixtureChore = WithId<Prisma.ChoreUncheckedCreateInput>
export type FixtureReward = WithId<Prisma.RewardUncheckedCreateInput>
export type FixtureList = WithId<Prisma.ListUncheckedCreateInput>
export type FixtureListItem = WithId<Prisma.ListItemUncheckedCreateInput>

export interface FixtureDataset {
  anchor: string
  families: FixtureFamily[]
  users: FixtureUser[]
  events: FixtureEvent[]
  chores: FixtureChore[]
  rewards: FixtureReward[]
  lists: FixtureList[]
  listItems: FixtureListItem[]
}

/** Parse an anchor string; throws on anything that is not a valid date. */
export function resolveFixtureAnchor(value: string | undefined | null): Date {
  const raw = (value ?? '').trim() || DEFAULT_FIXTURE_ANCHOR
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`FIXTURES_ANCHOR_DATE is not a valid date: ${JSON.stringify(raw)}`)
  }
  return d
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** Long strings for reflow / truncation testing. Plain ASCII plus a few accented letters. */
export const FIXTURE_LONG_TEXT = {
  name: 'Maximiliana-Josephine Featherstonehaugh-Worthington',
  eventTitle:
    'Parent-teacher conference about the interdisciplinary science-and-art exhibition, followed by volunteer sign-up',
  choreTitle:
    'Sort the entire garage shelf of mismatched sports equipment into labelled bins and donate outgrown items',
  listItem:
    'Replacement batteries for the upstairs smoke detector (the one near the linen closet that chirps at 3am)',
  groceryItem:
    'Sourdough sandwich loaf from the bakery counter, sliced thin (not the pre-packaged one on the bottom shelf)',
  description:
    'This description is intentionally long so layouts can be checked for wrapping, truncation and reflow. ' +
    'It repeats a little: café, naïve, façade, jalapeño — accented characters included on purpose. ' +
    'It should never overflow its container on a 390px phone or on the 1280x800 fridge tablet.',
} as const

export function buildFixtureDataset(anchorInput: Date | string = DEFAULT_FIXTURE_ANCHOR): FixtureDataset {
  const anchor = typeof anchorInput === 'string' ? resolveFixtureAnchor(anchorInput) : new Date(anchorInput.getTime())
  const t = anchor.getTime()
  const at = (offsetMs: number) => new Date(t + offsetMs)
  // Midnight UTC of the anchor day, for chore due dates.
  const dayStart = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate())
  const dueDay = (days: number) => new Date(dayStart + days * DAY)
  const created = at(-30 * DAY)

  const A = FIXTURE_IDS.familyA
  const B = FIXTURE_IDS.familyB
  const E = FIXTURE_IDS.familyEmpty

  const families: FixtureFamily[] = [
    { id: A.family, name: 'Fixture Family A (busy)', invite_code: 'fx-invite-family-a', created_at: created },
    { id: B.family, name: 'Fixture Family B (sparse)', invite_code: 'fx-invite-family-b', created_at: created },
    { id: E.family, name: 'Fixture Family (empty)', invite_code: 'fx-invite-family-empty', created_at: created },
  ]

  const user = (
    id: string,
    email: string,
    name: string,
    role: FixtureUser['role'],
    family_id: string,
    extra: Partial<FixtureUser> = {}
  ): FixtureUser => ({
    id,
    email,
    name,
    role,
    family_id,
    age: role === 'parent' ? null : role === 'teen' ? 15 : 8,
    email_verified: true,
    xp: 0,
    level: 1,
    streak: 0,
    best_streak: 0,
    token_version: 0,
    created_at: created,
    ...extra,
  })

  const users: FixtureUser[] = [
    user(A.parent, FIXTURE_EMAILS.familyA.parent, 'Avery Fixture-A', 'parent', A.family),
    user(A.teen, FIXTURE_EMAILS.familyA.teen, 'Taylor Fixture-A', 'teen', A.family, { xp: 340, level: 4, streak: 5, best_streak: 9 }),
    user(A.child, FIXTURE_EMAILS.familyA.child, 'Casey Fixture-A', 'child', A.family, { xp: 120, level: 2, streak: 2, best_streak: 3 }),
    user(A.longNameChild, FIXTURE_EMAILS.familyA.longNameChild, FIXTURE_LONG_TEXT.name, 'child', A.family, { age: 10 }),
    user(B.parent, FIXTURE_EMAILS.familyB.parent, 'Blair Fixture-B', 'parent', B.family),
    user(B.teen, FIXTURE_EMAILS.familyB.teen, 'Jordan Fixture-B', 'teen', B.family, { age: 14 }),
    user(B.child, FIXTURE_EMAILS.familyB.child, 'Riley Fixture-B', 'child', B.family, { age: 7 }),
    user(E.parent, FIXTURE_EMAILS.familyEmpty.parent, 'Emery Fixture-Empty', 'parent', E.family),
  ]

  // ---------- Events ----------
  const event = (
    id: string,
    family_id: string,
    created_by: string,
    title: string,
    startOffset: number,
    durationMs: number,
    extra: Partial<FixtureEvent> = {}
  ): FixtureEvent => ({
    id,
    family_id,
    created_by,
    title,
    start_time: at(startOffset),
    end_time: at(startOffset + durationMs),
    event_type: 'other',
    is_task: false,
    created_at: created,
    ...extra,
  })

  const events: FixtureEvent[] = [
    // Family A: busy morning + a full week
    event(A.event, A.family, A.parent, 'School drop-off', -4 * HOUR, 30 * 60 * 1000, { event_type: 'school', location: 'Fixture Elementary' }),
    event('fx_event_a_today_standup', A.family, A.parent, 'Work stand-up', -3 * HOUR, 15 * 60 * 1000, { event_type: 'work' }),
    event('fx_event_a_today_dentist', A.family, A.parent, 'Dentist (Casey)', 2 * HOUR, HOUR, { event_type: 'appointment', location: '123 Example Street' }),
    event('fx_event_a_today_practice', A.family, A.teen, 'Soccer practice', 5 * HOUR, 90 * 60 * 1000, { event_type: 'sports' }),
    event('fx_event_a_today_long', A.family, A.parent, FIXTURE_LONG_TEXT.eventTitle, 6 * HOUR, HOUR, { event_type: 'school', description: FIXTURE_LONG_TEXT.description }),
    event('fx_event_a_tomorrow_library', A.family, A.parent, 'Library returns', DAY - 2 * HOUR, 30 * 60 * 1000, { event_type: 'family' }),
    event('fx_event_a_tomorrow_recital', A.family, A.parent, 'Piano recital', DAY + 6 * HOUR, 2 * HOUR, { event_type: 'family' }),
    // Crosses midnight UTC — timezone edge.
    event('fx_event_a_midnight_crossing', A.family, A.parent, 'Late flight arrival', 2 * DAY + 11 * HOUR, 3 * HOUR, { event_type: 'other' }),
    event('fx_event_a_week_task', A.family, A.parent, 'Renew library cards', 3 * DAY, 30 * 60 * 1000, { event_type: 'other', is_task: true }),
    event('fx_event_a_week_game', A.family, A.teen, 'Away game', 4 * DAY + 3 * HOUR, 3 * HOUR, { event_type: 'sports', location: 'Fixture Field' }),
    event('fx_event_a_weekly_swim', A.family, A.parent, 'Swim lessons', 1 * DAY + 4 * HOUR, HOUR, { event_type: 'sports', recurrence: 'FREQ=WEEKLY;BYDAY=TU' }),
    event('fx_event_a_multiday', A.family, A.parent, 'Grandparents visiting', 5 * DAY - 12 * HOUR, 2 * DAY, { event_type: 'family' }),
    event('fx_event_a_next_week', A.family, A.parent, 'Science fair', 8 * DAY, 3 * HOUR, { event_type: 'school' }),
    event('fx_event_a_past', A.family, A.parent, 'Yesterday: haircut', -DAY, HOUR, { event_type: 'appointment' }),
    // Family B: one event only
    event(B.event, B.family, B.parent, 'Family B dentist', 2 * DAY, HOUR, { event_type: 'appointment' }),
  ]

  // ---------- Chores ----------
  const chore = (
    id: string,
    family_id: string,
    created_by: string,
    assigned_to: string,
    title: string,
    dueDays: number,
    extra: Partial<FixtureChore> = {}
  ): FixtureChore => ({
    id,
    family_id,
    created_by,
    assigned_to,
    title,
    due_date: dueDay(dueDays),
    points: 10,
    status: 'pending',
    frequency: 'once',
    difficulty: 'medium',
    photo_verified: false,
    is_template: false,
    recurrence_id: null,
    created_at: created,
    ...extra,
  })

  const tpl = A.recurringChoreTemplate
  const chores: FixtureChore[] = [
    chore(A.chore, A.family, A.parent, A.teen, 'Take out recycling', 0),
    chore('fx_chore_a_inprogress_child', A.family, A.parent, A.child, 'Tidy bedroom', 0, { status: 'in_progress', difficulty: 'easy', points: 5 }),
    chore('fx_chore_a_completed_teen', A.family, A.parent, A.teen, 'Unload dishwasher', -1, { status: 'completed', completed_at: at(-20 * HOUR) }),
    chore('fx_chore_a_verified_child', A.family, A.parent, A.child, 'Feed the fish', -1, {
      status: 'verified',
      completed_at: at(-22 * HOUR),
      verified_at: at(-21 * HOUR),
      verified_notes: 'Nice job!',
      difficulty: 'easy',
      points: 5,
    }),
    chore('fx_chore_a_overdue_teen', A.family, A.parent, A.teen, 'Mow the lawn', -3, { status: 'overdue', difficulty: 'hard', points: 25 }),
    chore('fx_chore_a_long', A.family, A.parent, A.longNameChild, FIXTURE_LONG_TEXT.choreTitle, 2, { description: FIXTURE_LONG_TEXT.description, difficulty: 'hard', points: 30 }),
    chore('fx_chore_a_tomorrow_child', A.family, A.parent, A.child, 'Pack school bag', 1, { difficulty: 'easy', points: 5 }),
    // Weekly recurring series: template + three generated occurrences.
    chore(tpl, A.family, A.parent, A.teen, 'Vacuum living room', 0, { frequency: 'weekly', recurrence_id: tpl, is_template: true, points: 15 }),
    chore('fx_chore_a_weekly_occ_1', A.family, A.parent, A.teen, 'Vacuum living room', 7, { recurrence_id: tpl, points: 15 }),
    chore('fx_chore_a_weekly_occ_2', A.family, A.parent, A.teen, 'Vacuum living room', 14, { recurrence_id: tpl, points: 15 }),
    chore('fx_chore_a_weekly_occ_3', A.family, A.parent, A.teen, 'Vacuum living room', 21, { recurrence_id: tpl, points: 15 }),
    // Family B: one chore for the teen; B's child intentionally has none (empty per-user state).
    chore(B.chore, B.family, B.parent, B.teen, 'Water the plants', 0),
  ]

  // ---------- Rewards ----------
  const reward = (
    id: string,
    family_id: string,
    created_by: string,
    name: string,
    cost: number,
    extra: Partial<FixtureReward> = {}
  ): FixtureReward => ({
    id,
    family_id,
    created_by,
    name,
    cost,
    icon: 'gift',
    status: 'available',
    is_active: true,
    approved: false,
    created_at: created,
    ...extra,
  })

  const rewards: FixtureReward[] = [
    reward(A.reward, A.family, A.parent, 'Extra 30 minutes of screen time', 50, { icon: 'tv' }),
    reward('fx_reward_a_claimed', A.family, A.parent, 'Pick Friday dinner', 80, { status: 'claimed', claimed_by: A.teen, claimed_at: at(-2 * HOUR) }),
    reward('fx_reward_a_redeemed', A.family, A.parent, 'Stay up 30 minutes late', 60, {
      status: 'redeemed',
      claimed_by: A.child,
      claimed_at: at(-3 * DAY),
      approved: true,
      approved_by: A.parent,
      approved_at: at(-3 * DAY + HOUR),
      redeemed_at: at(-2 * DAY),
    }),
    reward('fx_reward_a_inactive', A.family, A.parent, 'Retired reward (inactive)', 100, { is_active: false }),
    reward(B.reward, B.family, B.parent, 'Family B movie night', 40),
  ]

  // ---------- Lists (to-do + grocery/shopping; meal-plan lists wait on #149) ----------
  const list = (id: string, family_id: string, created_by: string, name: string, extra: Partial<FixtureList> = {}): FixtureList => ({
    id,
    family_id,
    created_by,
    name,
    type: 'todo',
    is_repeatable: false,
    created_at: created,
    updated_at: created,
    ...extra,
  })

  const lists: FixtureList[] = [
    list(A.list, A.family, A.parent, 'Weekend to-dos'),
    list('fx_list_a_school', A.family, A.parent, 'School forms', { description: 'Permission slips and sign-ups' }),
    list('fx_list_a_long', A.family, A.parent, 'Household maintenance backlog with an intentionally long list name', { description: FIXTURE_LONG_TEXT.description }),
    list('fx_list_a_empty', A.family, A.parent, 'Empty list'),
    list(A.groceryList, A.family, A.parent, 'Groceries', { type: 'grocery' }),
    list(B.list, B.family, B.parent, 'Family B to-dos'),
    list(B.shoppingList, B.family, B.parent, 'Family B shopping', { type: 'shopping' }),
  ]

  const item = (
    id: string,
    list_id: string,
    added_by: string,
    content: string,
    position: number,
    extra: Partial<FixtureListItem> = {}
  ): FixtureListItem => ({
    id,
    list_id,
    added_by,
    content,
    position,
    checked: false,
    quantity: 1,
    purchased: false,
    created_at: created,
    updated_at: created,
    ...extra,
  })

  const weekend = [
    'Return library books',
    'Fix squeaky door hinge',
    'Clean out the car',
    'Plan birthday party',
    'Wash the dog',
    'Organise the hall closet',
    'Swap winter tyres',
    'Call the plumber back',
  ]
  // Grocery items get distinct, ascending created_at so the dashboard Shopping
  // card (oldest open first, capped at 5) has a stable order. 6 open + 2 checked.
  const grocery: Array<[content: string, extra: Partial<FixtureListItem>]> = [
    ['Milk', { quantity: 2, category: 'Dairy' }],
    [FIXTURE_LONG_TEXT.groceryItem, { category: 'Bakery' }],
    ['Bananas', { category: 'Produce' }],
    ['Coffee beans', { checked: true, checked_by: A.teen, checked_at: at(-5 * HOUR), purchased: true }],
    ['Eggs (dozen)', { category: 'Dairy' }],
    ['Cheddar cheese', { category: 'Dairy' }],
    ['Olive oil', { checked: true, checked_by: A.parent, checked_at: at(-4 * HOUR), purchased: true }],
    ['Dish soap', { category: 'Household' }],
  ]
  const groceryItems = grocery.map(([content, extra], i) =>
    item(i === 0 ? A.groceryItem : `fx_item_a_grocery_${i + 1}`, A.groceryList, i % 3 === 2 ? A.teen : A.parent, content, i, {
      created_at: at(-2 * DAY + i * HOUR),
      updated_at: extra.checked_at ?? at(-2 * DAY + i * HOUR),
      ...extra,
    })
  )

  const listItems: FixtureListItem[] = [
    ...weekend.map((content, i) =>
      item(
        i === 0 ? A.listItem : `fx_item_a_weekend_${i + 1}`,
        A.list,
        i % 2 === 0 ? A.parent : A.teen,
        content,
        i,
        i < 3 ? { checked: true, checked_by: A.parent, checked_at: at(-(i + 1) * HOUR) } : {}
      )
    ),
    item('fx_item_a_school_1', 'fx_list_a_school', A.parent, 'Field trip permission slip', 0),
    item('fx_item_a_school_2', 'fx_list_a_school', A.parent, 'Photo day order form', 1, { checked: true, checked_by: A.parent, checked_at: at(-DAY) }),
    item('fx_item_a_long_1', 'fx_list_a_long', A.parent, FIXTURE_LONG_TEXT.listItem, 0, { notes: FIXTURE_LONG_TEXT.description }),
    item(B.listItem, B.list, B.parent, 'Book car service', 0),
    ...groceryItems,
    item(B.shoppingItem, B.shoppingList, B.parent, 'Printer ink (Family B)', 0, { created_at: at(-DAY), updated_at: at(-DAY) }),
    item('fx_item_b_shopping_2', B.shoppingList, B.parent, 'Light bulbs (Family B)', 1, {
      checked: true,
      checked_by: B.parent,
      checked_at: at(-HOUR),
      purchased: true,
      created_at: at(-DAY + HOUR),
      updated_at: at(-HOUR),
    }),
  ]

  return { anchor: anchor.toISOString(), families, users, events, chores, rewards, lists, listItems }
}

/** Every id in the dataset, grouped by table. Used by seed prune and reset. */
export function fixtureIdsByTable(ds: FixtureDataset) {
  return {
    families: ds.families.map((r) => r.id),
    users: ds.users.map((r) => r.id),
    events: ds.events.map((r) => r.id),
    chores: ds.chores.map((r) => r.id),
    rewards: ds.rewards.map((r) => r.id),
    lists: ds.lists.map((r) => r.id),
    listItems: ds.listItems.map((r) => r.id),
  }
}
