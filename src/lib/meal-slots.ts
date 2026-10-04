/**
 * Week view model for /dashboard/meals (ADR-0007, #252).
 *
 * Several meals may share a (date, meal_type) slot (O-1), so every slot holds
 * a list, in API order (date, created_at, id). Nothing is hidden or merged:
 * this closes gap 2.4.1 in docs/architecture/MEALS_AND_GROCERIES.md, where the
 * page kept only the first meal per slot.
 */
import { toDateOnlyLocal, toDateOnlyUTC } from '@/lib/dates'

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealType = (typeof MEAL_TYPES)[number]

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}

/** The linked recipe summary `GET /api/meals` returns (MEAL_RECIPE_SELECT). */
export interface MealRecipeSummary {
  id: string
  title: string
  prep_time: number | null
  cook_time: number | null
  servings: number | null
}

export interface PlannedMeal {
  id: string
  meal_type: MealType
  recipe_name: string | null
  notes?: string | null
  cook_id?: string | null
  /** ISO string of UTC midnight; the YYYY-MM-DD prefix is the meal's calendar day. */
  date: string
  recipe_id?: string | null
  servings?: number | null
  recipe?: MealRecipeSummary | null
}

export interface MealSlotGroup {
  type: MealType
  meals: PlannedMeal[]
}

export interface DayPlan {
  /** Local calendar day as YYYY-MM-DD. */
  dateKey: string
  label: string
  /** Long form for accessible names, e.g. "Monday, January 5". */
  longLabel: string
  isToday: boolean
  slots: MealSlotGroup[]
}

/** Local calendar days for `count` days starting at `from` (default: today). */
export function getWeekDates(from: Date = new Date(), count = 7): Date[] {
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const dates: Date[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    dates.push(d)
  }
  return dates
}

function isMealType(value: unknown): value is MealType {
  return typeof value === 'string' && (MEAL_TYPES as readonly string[]).includes(value)
}

/**
 * Meal dates are date-only: match on the YYYY-MM-DD prefix of the ISO string,
 * never by parsing into a local Date (which shifts the day off UTC). Rows with
 * a meal type the page does not know are left out, as before.
 */
export function buildDayPlans(meals: readonly PlannedMeal[], from: Date = new Date(), locale: string = 'en'): DayPlan[] {
  return getWeekDates(from).map((d, i) => {
    const isToday = i === 0
    const dateKey = toDateOnlyLocal(d)
    // Display only, in the viewer's locale (src/lib/display-locale.ts): a
    // short month name, so "Sun, Oct 4" / "Sun 4 Oct" is never misread the
    // way "10/4" can be. dateKey stays YYYY-MM-DD.
    const label = isToday ? 'Today' : d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
    const longLabel = d.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })
    const dayMeals = meals.filter((m) => isMealType(m.meal_type) && toDateOnlyUTC(m.date) === dateKey)
    const slots = MEAL_TYPES.map((type) => ({ type, meals: dayMeals.filter((m) => m.meal_type === type) }))
    return { dateKey, label, longLabel, isToday, slots }
  })
}

/** Display title of a planned meal: its snapshot name, else the linked recipe title. */
export function mealTitle(meal: Pick<PlannedMeal, 'recipe_name' | 'recipe'>): string {
  return meal.recipe_name?.trim() || meal.recipe?.title?.trim() || 'Untitled meal'
}

/** "25 min", "1 h", "1 h 30 min"; null for unknown or negative values. */
export function formatMinutes(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return null
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Short recipe line for a meal row, e.g. "Recipe · 25 min prep". Null when unlinked. */
export function recipeMeta(recipe: MealRecipeSummary | null | undefined): string | null {
  if (!recipe) return null
  const prep = formatMinutes(recipe.prep_time)
  return prep ? `Recipe · ${prep} prep` : 'Recipe'
}
