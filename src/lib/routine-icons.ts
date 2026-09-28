/**
 * Picture routines for young kids (#272): the built-in chore icon catalogue.
 *
 * The keys are the stored value of `Chore.icon` and part of the API contract:
 * `createChoreSchema` / `updateChoreSchema` accept only these. Add keys freely;
 * never rename or remove one (installed clients and stored rows use them).
 * Drawings live in `src/components/chores/RoutineIcon.tsx` (original line art,
 * design/GRAPHICS.md "Chore picture icons").
 */

export interface RoutineIconMeta {
  /** Stored key. Lower-case words joined by hyphens. */
  key: string
  /** What the picture shows, in the words a parent would search for. */
  label: string
  /** Extra search words. */
  keywords: string[]
}

export const ROUTINE_ICONS = [
  // Getting up and getting ready
  { key: 'wake-up', label: 'Wake up', keywords: ['morning', 'sun', 'get up', 'alarm'] },
  { key: 'toilet', label: 'Toilet', keywords: ['potty', 'bathroom', 'loo', 'wee'] },
  { key: 'wash-hands', label: 'Wash hands', keywords: ['soap', 'tap', 'sink', 'clean'] },
  { key: 'wash-face', label: 'Wash face', keywords: ['face', 'clean', 'water'] },
  { key: 'brush-teeth', label: 'Brush teeth', keywords: ['toothbrush', 'teeth', 'toothpaste', 'dentist'] },
  { key: 'brush-hair', label: 'Brush hair', keywords: ['comb', 'hair'] },
  { key: 'bath', label: 'Bath', keywords: ['bathtub', 'wash', 'bubbles'] },
  { key: 'shower', label: 'Shower', keywords: ['wash', 'water'] },
  { key: 'get-dressed', label: 'Get dressed', keywords: ['clothes', 't-shirt', 'shirt', 'dress'] },
  { key: 'pyjamas', label: 'Pyjamas', keywords: ['pajamas', 'pjs', 'night', 'bedtime', 'change'] },
  { key: 'socks', label: 'Socks', keywords: ['clothes', 'feet'] },
  { key: 'shoes', label: 'Shoes', keywords: ['sneakers', 'trainers', 'boots', 'feet'] },
  { key: 'coat', label: 'Coat', keywords: ['jacket', 'zip', 'outside', 'warm'] },
  { key: 'hat', label: 'Hat', keywords: ['beanie', 'warm', 'outside', 'winter'] },
  { key: 'medicine', label: 'Medicine', keywords: ['pill', 'vitamin', 'tablet'] },
  { key: 'drink-water', label: 'Drink water', keywords: ['cup', 'glass', 'water bottle', 'drink'] },
  // Meals
  { key: 'breakfast', label: 'Breakfast', keywords: ['cereal', 'bowl', 'eat', 'food'] },
  { key: 'lunchbox', label: 'Lunchbox', keywords: ['lunch', 'pack lunch', 'school', 'food'] },
  { key: 'set-table', label: 'Set the table', keywords: ['table', 'plate', 'fork', 'knife', 'dinner'] },
  { key: 'dishes', label: 'Dishes', keywords: ['wash up', 'plates', 'dishwasher', 'clear table'] },
  { key: 'help-cook', label: 'Help cook', keywords: ['cook', 'pot', 'kitchen', 'dinner'] },
  // School
  { key: 'backpack', label: 'Backpack', keywords: ['school bag', 'bag', 'pack', 'school'] },
  { key: 'homework', label: 'Homework', keywords: ['pencil', 'write', 'school', 'worksheet'] },
  { key: 'reading', label: 'Reading', keywords: ['book', 'read', 'story'] },
  { key: 'school-bus', label: 'School bus', keywords: ['bus', 'school', 'car', 'leave'] },
  { key: 'music-practice', label: 'Music practice', keywords: ['music', 'piano', 'instrument', 'practice'] },
  // Home
  { key: 'make-bed', label: 'Make the bed', keywords: ['bed', 'bedroom', 'pillow'] },
  { key: 'tidy-toys', label: 'Tidy toys', keywords: ['toys', 'blocks', 'tidy', 'put away', 'clean up'] },
  { key: 'laundry', label: 'Laundry', keywords: ['washing', 'clothes', 'basket', 'hamper'] },
  { key: 'trash', label: 'Trash', keywords: ['bin', 'rubbish', 'garbage', 'recycling'] },
  { key: 'sweep', label: 'Sweep', keywords: ['broom', 'floor', 'clean'] },
  { key: 'wipe-table', label: 'Wipe the table', keywords: ['spray', 'wipe', 'clean', 'counter'] },
  { key: 'water-plants', label: 'Water the plants', keywords: ['plants', 'watering can', 'garden', 'flowers'] },
  { key: 'groceries', label: 'Put away groceries', keywords: ['shopping', 'bag', 'groceries'] },
  // Pets
  { key: 'feed-pet', label: 'Feed the pet', keywords: ['pet', 'dog', 'cat', 'bowl', 'food'] },
  { key: 'walk-dog', label: 'Walk the dog', keywords: ['dog', 'paw', 'walk', 'pet'] },
  // Play and rest
  { key: 'exercise', label: 'Exercise', keywords: ['ball', 'sport', 'play', 'active'] },
  { key: 'play-outside', label: 'Play outside', keywords: ['tree', 'park', 'garden', 'outdoors'] },
  { key: 'hug', label: 'Hug', keywords: ['heart', 'love', 'goodbye', 'kiss'] },
  { key: 'bedtime', label: 'Bedtime', keywords: ['sleep', 'moon', 'night', 'lights out'] },
] as const satisfies readonly RoutineIconMeta[]

export type RoutineIconKey = (typeof ROUTINE_ICONS)[number]['key']

/** Every accepted key, for Zod (`z.enum`). */
export const ROUTINE_ICON_KEYS = ROUTINE_ICONS.map((i) => i.key) as unknown as readonly [
  RoutineIconKey,
  ...RoutineIconKey[],
]

const BY_KEY = new Map<string, RoutineIconMeta>(ROUTINE_ICONS.map((i) => [i.key, i]))

export function isRoutineIconKey(value: unknown): value is RoutineIconKey {
  return typeof value === 'string' && BY_KEY.has(value)
}

/** Label for a stored key; null for an unknown or empty key. */
export function routineIconLabel(key: string | null | undefined): string | null {
  return key ? BY_KEY.get(key)?.label ?? null : null
}

/**
 * Icons whose label, key or keywords contain every word of `query`
 * (case-insensitive). An empty query returns the whole set in catalogue order.
 */
export function searchRoutineIcons(query: string): RoutineIconMeta[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...ROUTINE_ICONS]
  return ROUTINE_ICONS.filter((icon) => {
    const hay = [icon.label, icon.key.replace(/-/g, ' '), ...icon.keywords].join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

// ---------------------------------------------------------------------------
// Routines: a short label (`Chore.routine`) and a step number (`Chore.routine_order`).

/** Longest routine label the API accepts. */
export const ROUTINE_NAME_MAX = 40
/** Highest step number the API accepts (steps start at 1). */
export const ROUTINE_ORDER_MAX = 99

/** Suggested routine names, in the order of a day. */
export const ROUTINE_SUGGESTIONS = ['Morning', 'After school', 'Evening', 'Bedtime'] as const

/** Trim and collapse inner whitespace; null for an empty label. */
export function normalizeRoutineName(value: string | null | undefined): string | null {
  if (value == null) return null
  const out = value.trim().replace(/\s+/g, ' ')
  return out === '' ? null : out
}

/** Where a routine sits in the day: suggested names first in day order, then others by name. */
function routineRank(name: string): number {
  const i = ROUTINE_SUGGESTIONS.findIndex((s) => s.toLowerCase() === name.toLowerCase())
  return i === -1 ? ROUTINE_SUGGESTIONS.length : i
}

export interface RoutineStepLike {
  id: string
  title: string
  routine?: string | null
  routine_order?: number | null
}

export interface RoutineGroup<T> {
  /** Display name (as the first step in the group spells it). */
  name: string
  steps: T[]
}

/**
 * Group chores by routine (case-insensitive name) and order everything:
 * routines by the day (Morning, After school, Evening, Bedtime, then others
 * alphabetically); steps by `routine_order` (unnumbered last), then title, then id.
 * Chores with no routine are returned separately, in their original order.
 */
export function groupByRoutine<T extends RoutineStepLike>(chores: T[]): { routines: RoutineGroup<T>[]; other: T[] } {
  const groups = new Map<string, RoutineGroup<T>>()
  const other: T[] = []
  for (const chore of chores) {
    const name = normalizeRoutineName(chore.routine)
    if (!name) {
      other.push(chore)
      continue
    }
    const key = name.toLowerCase()
    const group = groups.get(key)
    if (group) group.steps.push(chore)
    else groups.set(key, { name, steps: [chore] })
  }
  const byStep = (a: T, b: T) => {
    const ao = a.routine_order ?? Number.POSITIVE_INFINITY
    const bo = b.routine_order ?? Number.POSITIVE_INFINITY
    if (ao !== bo) return ao - bo
    const t = a.title.localeCompare(b.title)
    return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }
  const routines = [...groups.values()]
    .map((g) => ({ ...g, steps: [...g.steps].sort(byStep) }))
    .sort((a, b) => routineRank(a.name) - routineRank(b.name) || a.name.localeCompare(b.name))
  return { routines, other }
}
