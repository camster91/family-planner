/**
 * Deterministic fake data for the design gallery (#156).
 *
 * Rules (checked by `__tests__/fixtures.test.ts`):
 * - Built from constants only: no database, no fetch, no clock, no randomness.
 *   Times are local wall-clock strings (no `Z`), so "4:30 PM" renders the same
 *   on the server and in any browser zone.
 * - Clearly fictional: every person is "<first name> Sample", the weather place
 *   is "Sampleton", and there are no emails, phone numbers, addresses, notes
 *   or photos. Ids start with `fx-gallery-`.
 * - Shapes are the production component props (the board DTO types, the
 *   recipe DTO, the offline queue operation), so the gallery renders the real
 *   components rather than copies.
 *
 * `long` pseudolocalises every piece of fixture text (accented and about 60%
 * longer) for reflow and truncation checks; `empty` returns the empty data each
 * component has to handle.
 */
import type { BoardChore, BoardDinner } from '@/app/dashboard/today/today-board-data'
import type { ComingUpDay, PersonChores, TodayEvent, UseSoonEntry, WeatherView } from '@/components/fridge/board-model'
import type { BoardPerson } from '@/components/fridge/regions'
import type { RecipeDetailData } from '@/components/meals/RecipeDetail'
import type { RoutineStep } from '@/components/dashboard/KidRoutines'
import type { ShoppingSnapshot } from '@/lib/shopping-snapshot'
import type { CheckedQueuedOperation } from '@/lib/offline-queue'
import type { RoutineGroup } from '@/lib/routine-icons'
import type { MemberColorKey } from '@/lib/member-colors'
import type { GrocerySectionId } from '@/lib/grocery-sections'
import type { BoardWeather } from '@/lib/weather/board-weather'
import { expiryLabel, type DateKind, type InventoryLocation } from '@/lib/inventory'

/** The fixed day every fixture is anchored to (the E2E anchor day). */
export const GALLERY_DAY = '2026-01-05'

const ACCENTS: Record<string, string> = {
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
  n: 'ñ', o: 'ö', p: 'þ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', w: 'ŵ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', N: 'Ñ', O: 'Ö',
  R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', W: 'Ŵ', Y: 'Ý', Z: 'Ž',
}
const FILLER = ['ļöñĝéŕ', 'ŵöŕðš', 'ƒöŕ', 'ŕéƒļöŵ']

/**
 * Pseudolocalise: accent every letter, wrap in brackets and pad with filler
 * words to about 1.6x the length (German/Finnish-like growth). Words stay
 * short, so the text can always wrap.
 */
export function pseudolocalize(text: string): string {
  const accented = text.replace(/[A-Za-z]/g, (c) => ACCENTS[c] ?? c)
  const extra: string[] = []
  const target = Math.max(6, Math.ceil(text.length * 0.6))
  for (let i = 0; extra.join(' ').length < target; i++) extra.push(FILLER[i % FILLER.length])
  return `[${accented} ${extra.join(' ')}]`
}

export interface GalleryMember {
  id: string
  name: string
  color: MemberColorKey
}

export interface GalleryListRow {
  id: string
  content: string
  checked: boolean
  quantity: number
  amount: number | null
  unit: string | null
  recipe_title: string | null
  section: GrocerySectionId
}

export interface GalleryFixtures {
  members: GalleryMember[]
  /** Board labels by member id (first name + colour). */
  people: Map<string, BoardPerson>
  todayEvents: TodayEvent[]
  comingUp: ComingUpDay[]
  dinner: BoardDinner | null
  shopping: ShoppingSnapshot
  personChores: PersonChores[]
  routines: RoutineGroup<RoutineStep>[]
  useSoon: UseSoonEntry[]
  recipe: RecipeDetailData
  listName: string
  listRows: GalleryListRow[]
  weather: WeatherView
  /** One queued offline operation per sync state, for the list-row sync text. */
  syncOps: Array<{ label: string; op: CheckedQueuedOperation }>
  nextEvent: { title: string; when: string }
  /** A single long title used for the dialog/sheet and toast frames. */
  itemTitle: string
}

const MEMBER_BASE: GalleryMember[] = [
  { id: 'fx-gallery-m1', name: 'Alex Sample', color: 'indigo' },
  { id: 'fx-gallery-m2', name: 'Robin Sample', color: 'green' },
  { id: 'fx-gallery-m3', name: 'Sam Sample', color: 'orange' },
  { id: 'fx-gallery-m4', name: 'Jordan Sample', color: 'pink' },
]

function at(time: string, day = GALLERY_DAY): string {
  return `${day}T${time}:00`
}

function chore(id: string, title: string, assigneeId: string, status: string, icon: string | null): BoardChore {
  return { id: `fx-gallery-chore-${id}`, title, dueDay: GALLERY_DAY, status, assigneeId, icon }
}

function soonItem(
  id: string,
  name: string,
  location: InventoryLocation,
  daysLeft: number,
  dateKind: DateKind
): UseSoonEntry {
  const status: UseSoonEntry['status'] = daysLeft < 0 ? 'expired' : daysLeft === 0 ? 'today' : 'soon'
  const day = new Date(Date.UTC(2026, 0, 5 + daysLeft)).toISOString().slice(0, 10)
  return {
    id: `fx-gallery-inv-${id}`,
    name,
    location,
    expiresOn: day,
    dateKind,
    status,
    daysLeft,
    label: expiryLabel(status, daysLeft, dateKind),
  }
}

function queued(id: string, state: CheckedQueuedOperation['state'], lastError?: string): CheckedQueuedOperation {
  return {
    id: `fx-gallery-op-${id}`,
    action: 'list-item.set-checked',
    v: 1,
    target: `list-item:fx-gallery-row-${id}`,
    payload: { itemId: `fx-gallery-row-${id}`, checked: true },
    createdAt: 0,
    state,
    attempts: state === 'pending' ? 0 : 1,
    nextAttemptAt: 0,
    lastError,
  }
}

export function galleryFixtures({ long = false, empty = false }: { long?: boolean; empty?: boolean } = {}): GalleryFixtures {
  const t = long ? pseudolocalize : (s: string) => s
  const members = MEMBER_BASE.map((m) => ({ ...m, name: t(m.name) }))
  const [alex, robin, sam, jordan] = members
  const people = new Map<string, BoardPerson>(members.map((m) => [m.id, { name: m.name.split(' ')[0], color: m.color }]))

  const weather: BoardWeather = {
    label: t('Sampleton'),
    unit: 'C',
    current: { temperature: -3, summary: t('Light snow'), icon: 'snow', isDay: true },
    days: [
      { day: '2026-01-05', high: -1, low: -7, summary: t('Light snow'), icon: 'snow', precipitationChance: 70 },
      { day: '2026-01-06', high: 1, low: -4, summary: t('Cloudy'), icon: 'cloudy', precipitationChance: 20 },
      { day: '2026-01-07', high: 3, low: -2, summary: t('Rain'), icon: 'rain', precipitationChance: 80 },
      { day: '2026-01-08', high: 0, low: -6, summary: t('Clear'), icon: 'clear', precipitationChance: 0 },
    ],
    utcOffsetSeconds: 0,
    fetchedAt: '2026-01-05T12:00:00.000Z',
  }
  const weatherView: WeatherView = { weather, today: weather.days[0], next: weather.days.slice(1) }

  const recipeFull: RecipeDetailData = {
    id: 'fx-gallery-recipe-1',
    title: t('Tomato soup with grilled cheese'),
    description: t('A warm weeknight dinner that kids can help stir.'),
    instructions: t('Soften the onion.\nAdd the tomatoes and stock, then simmer for 15 minutes.\nBlend until smooth.'),
    prep_time: 10,
    cook_time: 25,
    servings: 4,
    ingredients: [
      { id: 'fx-gallery-ri-1', amount: 2, unit: t('cans'), note: null, ingredient: { id: 'fx-gallery-ing-1', name: t('Crushed tomatoes'), unit: null } },
      { id: 'fx-gallery-ri-2', amount: 1, unit: null, note: t('diced'), ingredient: { id: 'fx-gallery-ing-2', name: t('Onion'), unit: null } },
      { id: 'fx-gallery-ri-3', amount: 500, unit: 'ml', note: null, ingredient: { id: 'fx-gallery-ing-3', name: t('Vegetable stock'), unit: 'ml' } },
      { id: 'fx-gallery-ri-4', amount: 8, unit: t('slices'), note: t('for the sandwiches'), ingredient: { id: 'fx-gallery-ing-4', name: t('Bread'), unit: null } },
    ],
  }

  const syncOps = [
    { label: 'Pending', op: queued('1', 'pending') },
    { label: 'Syncing', op: queued('2', 'syncing') },
    { label: 'Failed', op: queued('3', 'failed', 'NETWORK') },
    { label: 'Conflict', op: queued('4', 'conflict', 'CHANGED') },
    { label: 'Removed elsewhere', op: queued('5', 'conflict', 'NOT_FOUND') },
  ]

  const common = {
    members,
    people,
    weather: weatherView,
    syncOps,
    nextEvent: { title: t('Swimming lesson'), when: 'Tomorrow 4:30 PM' },
    itemTitle: t('Oat milk'),
    listName: t('Weekly groceries'),
  }

  if (empty) {
    return {
      ...common,
      todayEvents: [],
      comingUp: [
        { dayKey: '2026-01-06', label: 'Tomorrow', dateLabel: 'Jan 6', events: [], dinner: null },
        { dayKey: '2026-01-07', label: 'Wednesday', dateLabel: 'Jan 7', events: [], dinner: null },
        { dayKey: '2026-01-08', label: 'Thursday', dateLabel: 'Jan 8', events: [], dinner: null },
      ],
      dinner: null,
      shopping: { items: [], total: 0 },
      personChores: [],
      routines: [],
      useSoon: [],
      recipe: { ...recipeFull, description: null, instructions: null, prep_time: null, cook_time: null, servings: null, ingredients: [] },
      listRows: [],
    }
  }

  const todayEvents: TodayEvent[] = [
    {
      id: 'fx-gallery-ev-1',
      title: t('Swimming lesson'),
      start: at('16:30'),
      end: at('17:30'),
      isTask: false,
      source: null,
      addedById: alex.id,
      happeningNow: true,
      startedEarlier: false,
    },
    {
      id: 'fx-gallery-ev-2',
      title: t('Pay the water bill'),
      start: at('18:00'),
      end: at('18:15'),
      isTask: true,
      source: null,
      addedById: robin.id,
      happeningNow: false,
      startedEarlier: false,
    },
    {
      id: 'fx-gallery-ev-3',
      title: t('Choir practice'),
      start: at('19:00'),
      end: at('20:00'),
      isTask: false,
      source: { name: t('School calendar'), color: '#0079A8' },
      addedById: null,
      happeningNow: false,
      startedEarlier: false,
    },
  ]

  const dinner: BoardDinner = {
    id: 'fx-gallery-dinner-1',
    day: GALLERY_DAY,
    recipeName: t('Soup and grilled cheese'),
    cookName: robin.name.split(' ')[0],
    recipeTitle: recipeFull.title,
    prepMinutes: 10,
  }

  const comingUp: ComingUpDay[] = [
    {
      dayKey: '2026-01-06',
      label: 'Tomorrow',
      dateLabel: 'Jan 6',
      events: [
        { id: 'fx-gallery-ev-4', title: t('Dentist check-up'), start: at('09:00', '2026-01-06'), end: at('10:00', '2026-01-06'), isTask: false, source: null },
      ],
      dinner: { id: 'fx-gallery-dinner-2', day: '2026-01-06', recipeName: t('Veggie lasagna'), cookName: null },
    },
    { dayKey: '2026-01-07', label: 'Wednesday', dateLabel: 'Jan 7', events: [], dinner: null },
    {
      dayKey: '2026-01-08',
      label: 'Thursday',
      dateLabel: 'Jan 8',
      events: [
        { id: 'fx-gallery-ev-5', title: t('Library books due'), start: at('08:00', '2026-01-08'), end: at('08:30', '2026-01-08'), isTask: true, source: null },
        { id: 'fx-gallery-ev-6', title: t('Soccer practice'), start: at('16:00', '2026-01-08'), end: at('17:00', '2026-01-08'), isTask: false, source: { name: t('Club calendar'), color: null } },
        { id: 'fx-gallery-ev-7', title: t('Parent evening'), start: at('18:30', '2026-01-08'), end: at('19:30', '2026-01-08'), isTask: false, source: null },
        { id: 'fx-gallery-ev-8', title: t('Movie night'), start: at('19:45', '2026-01-08'), end: at('21:30', '2026-01-08'), isTask: false, source: null },
      ],
      dinner: null,
    },
  ]

  const shopping: ShoppingSnapshot = {
    items: [
      { id: 'fx-gallery-shop-1', content: t('Oat milk'), quantity: 2, listId: 'fx-gallery-list-1', listName: common.listName },
      { id: 'fx-gallery-shop-2', content: t('Bananas'), quantity: 1, listId: 'fx-gallery-list-1', listName: common.listName },
      { id: 'fx-gallery-shop-3', content: t('Crushed tomatoes'), quantity: 2, listId: 'fx-gallery-list-1', listName: common.listName },
      { id: 'fx-gallery-shop-4', content: t('Dish soap'), quantity: 1, listId: 'fx-gallery-list-1', listName: common.listName },
      { id: 'fx-gallery-shop-5', content: t('Whole wheat bread'), quantity: 1, listId: 'fx-gallery-list-1', listName: common.listName },
    ],
    total: 8,
  }

  const personChores: PersonChores[] = [
    {
      member: robin,
      open: [chore('1', t('Empty the dishwasher'), robin.id, 'pending', 'dishes')],
      doneCount: 1,
      awaitingCheckCount: 0,
    },
    {
      member: sam,
      open: [
        chore('2', t('Make the bed'), sam.id, 'pending', 'make-bed'),
        chore('3', t('Feed the cat'), sam.id, 'pending', 'feed-pet'),
        chore('4', t('Tidy the toy corner'), sam.id, 'pending', 'tidy-toys'),
        chore('5', t('Water the plants'), sam.id, 'pending', 'water-plants'),
        chore('6', t('Take out the recycling'), sam.id, 'pending', 'trash'),
      ],
      doneCount: 2,
      awaitingCheckCount: 1,
    },
    { member: jordan, open: [], doneCount: 3, awaitingCheckCount: 0 },
  ]

  const routines: RoutineGroup<RoutineStep>[] = [
    {
      name: t('Morning'),
      steps: [
        { id: 'fx-gallery-step-1', title: t('Brush teeth'), status: 'verified', icon: 'brush-teeth' },
        { id: 'fx-gallery-step-2', title: t('Get dressed'), status: 'completed', icon: 'get-dressed' },
        { id: 'fx-gallery-step-3', title: t('Pack your backpack'), status: 'pending', icon: 'backpack' },
        { id: 'fx-gallery-step-4', title: t('Put on shoes'), status: 'pending', icon: 'shoes' },
      ],
    },
  ]

  const useSoon: UseSoonEntry[] = [
    soonItem('1', t('Spinach'), 'fridge', -1, 'best_before'),
    soonItem('2', t('Chicken thighs'), 'fridge', 0, 'use_by'),
    soonItem('3', t('Greek yogurt'), 'fridge', 1, 'best_before'),
    soonItem('4', t('Sliced bread'), 'pantry', 2, 'best_before'),
    soonItem('5', t('Fish fingers'), 'freezer', 3, 'use_by'),
    soonItem('6', t('Hummus'), 'fridge', 3, 'best_before'),
  ]

  const listRows: GalleryListRow[] = [
    { id: 'fx-gallery-row-1', content: t('Bananas'), checked: false, quantity: 6, amount: null, unit: null, recipe_title: null, section: 'produce' },
    { id: 'fx-gallery-row-2', content: t('Crushed tomatoes'), checked: false, quantity: 1, amount: 2, unit: t('cans'), recipe_title: recipeFull.title, section: 'pantry' },
    { id: 'fx-gallery-row-3', content: t('Oat milk'), checked: false, quantity: 2, amount: null, unit: null, recipe_title: null, section: 'dairy_eggs' },
    { id: 'fx-gallery-row-4', content: t('Eggs'), checked: true, quantity: 1, amount: 12, unit: null, recipe_title: null, section: 'dairy_eggs' },
    { id: 'fx-gallery-row-5', content: t('Dish soap'), checked: false, quantity: 1, amount: null, unit: null, recipe_title: null, section: 'household' },
  ]

  return {
    ...common,
    todayEvents,
    comingUp,
    dinner,
    shopping,
    personChores,
    routines,
    useSoon,
    recipe: recipeFull,
    listRows,
  }
}
