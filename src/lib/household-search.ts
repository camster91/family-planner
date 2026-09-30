import type { PrismaClient } from '@prisma/client'
import { isFeatureEnabled, type FamilyFeatures, type FeatureKey } from '@/lib/features'
import { LOCATION_LABELS, type InventoryLocation } from '@/lib/inventory'
import {
  canSearchType,
  searchResultHref,
  type SearchHrefTarget,
  type SearchResultType,
} from '@/lib/search-result-href'

/**
 * Household search (`GET /api/search`, route inventory F-3, #101 disposition
 * D-2). Reads only canonical tables (ADR-0007): members, events, chores,
 * lists, list items, recipes, pinned notes and active inventory items. Never a
 * legacy meal/shopping table, and never budget, messages, medical, locations,
 * handoff or allowance data.
 *
 * Every query is filtered by the caller's `family_id` (list items through
 * their list). A type is searched only when the household has its feature on
 * and the caller's role may open the page its results link to
 * (`canSearchType`), so a teen or child gets lists, list items and inventory
 * only, the same things their own pages show.
 */

export const SEARCH_MIN_LENGTH = 2
export const SEARCH_MAX_LENGTH = 100
export const SEARCH_PER_TYPE = 5
export const SEARCH_MAX_RESULTS = 30

export type SearchResult = {
  type: SearchResultType
  id: string
  title: string
  subtitle?: string
  href: string
  /** Events: start time; chores: due time (ISO). The page formats it in the viewer's time zone. */
  date?: string
}

export type ParsedSearchQuery =
  | { ok: true; q: string }
  | { ok: false; code: 'QUERY_TOO_SHORT' | 'QUERY_TOO_LONG'; message: string }

/** Trim, collapse spaces and check length (counted in characters, not bytes). */
export function parseSearchQuery(raw: string | null | undefined): ParsedSearchQuery {
  const q = (raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ')
  const length = Array.from(q).length
  if (length < SEARCH_MIN_LENGTH) {
    return { ok: false, code: 'QUERY_TOO_SHORT', message: `Type at least ${SEARCH_MIN_LENGTH} characters to search.` }
  }
  if (length > SEARCH_MAX_LENGTH) {
    return { ok: false, code: 'QUERY_TOO_LONG', message: `Search is limited to ${SEARCH_MAX_LENGTH} characters.` }
  }
  return { ok: true, q }
}

/** The feature each type belongs to; a type is skipped while its feature is off. */
const TYPE_FEATURE: Record<SearchResultType, FeatureKey> = {
  member: 'family',
  event: 'calendar',
  chore: 'chores',
  list: 'lists',
  list_item: 'lists',
  recipe: 'meals',
  note: 'notes',
  inventory: 'inventory',
}

const ROLE_LABEL: Record<string, string> = { parent: 'Parent', teen: 'Teen', child: 'Child' }

const CHORE_STATUS_LABEL: Record<string, string> = {
  pending: 'To do',
  in_progress: 'In progress',
  completed: "Waiting for a parent's check",
  verified: 'Done',
  overdue: 'Overdue',
}

const LIST_TYPE_LABEL: Record<string, string> = {
  grocery: 'Shopping list',
  shopping: 'Shopping list',
  todo: 'To-do list',
  meal_plan: 'Meal plan list',
  wishlist: 'Wish list',
}

type SearchDb = Pick<
  PrismaClient,
  'user' | 'event' | 'chore' | 'list' | 'listItem' | 'recipe' | 'pinnedNote' | 'inventoryItem'
>

type Loader = (db: SearchDb, familyId: string, q: string) => Promise<Array<{ id: string; title: string; subtitle?: string; date?: Date; target: SearchHrefTarget }>>

/**
 * Prisma sends `contains` to Postgres as `ILIKE '%<value>%'` without escaping,
 * so `%` and `_` in the words would act as wildcards. Escape them (and the
 * escape character) so the words match literally; Postgres's default LIKE
 * escape is the backslash. Covered by `search.integration.test.ts`.
 */
export function escapeLikePattern(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`)
}

const text = (q: string) => ({ contains: escapeLikePattern(q), mode: 'insensitive' as const })
const take = SEARCH_PER_TYPE

/**
 * One loader per type. Each `where` starts with the household; each order ends
 * with `id`, so equal titles or times still come back in the same order.
 */
const LOADERS: Record<SearchResultType, Loader> = {
  member: async (db, familyId, q) => {
    const rows = await db.user.findMany({
      where: { family_id: familyId, name: text(q) },
      select: { id: true, name: true, role: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take,
    })
    return rows.map((u) => ({ id: u.id, title: u.name, subtitle: ROLE_LABEL[u.role], target: { type: 'member' } }))
  },
  event: async (db, familyId, q) => {
    const rows = await db.event.findMany({
      where: { family_id: familyId, OR: [{ title: text(q) }, { description: text(q) }, { location: text(q) }] },
      select: { id: true, title: true, start_time: true, location: true },
      orderBy: [{ start_time: 'desc' }, { id: 'asc' }],
      take,
    })
    return rows.map((e) => ({
      id: e.id,
      title: e.title,
      subtitle: e.location || undefined,
      date: e.start_time,
      target: { type: 'event', start: e.start_time },
    }))
  },
  chore: async (db, familyId, q) => {
    const rows = await db.chore.findMany({
      where: { family_id: familyId, OR: [{ title: text(q) }, { description: text(q) }] },
      select: { id: true, title: true, status: true, due_date: true, assignee: { select: { name: true } } },
      orderBy: [{ due_date: 'desc' }, { id: 'asc' }],
      take,
    })
    return rows.map((c) => ({
      id: c.id,
      title: c.title,
      subtitle: [c.assignee?.name ? `For ${c.assignee.name}` : null, CHORE_STATUS_LABEL[c.status]].filter(Boolean).join(' · ') || undefined,
      date: c.due_date,
      target: { type: 'chore' },
    }))
  },
  list: async (db, familyId, q) => {
    const rows = await db.list.findMany({
      where: { family_id: familyId, OR: [{ name: text(q) }, { description: text(q) }] },
      select: { id: true, name: true, type: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take,
    })
    return rows.map((l) => ({ id: l.id, title: l.name, subtitle: LIST_TYPE_LABEL[l.type] ?? 'List', target: { type: 'list', id: l.id } }))
  },
  list_item: async (db, familyId, q) => {
    const rows = await db.listItem.findMany({
      where: { list: { family_id: familyId }, content: text(q) },
      select: { id: true, content: true, checked: true, list: { select: { id: true, name: true } } },
      orderBy: [{ checked: 'asc' }, { content: 'asc' }, { id: 'asc' }],
      take,
    })
    return rows.map((i) => ({
      id: i.id,
      title: i.content,
      subtitle: `On ${i.list.name}${i.checked ? ' · ticked' : ''}`,
      target: { type: 'list_item', listId: i.list.id },
    }))
  },
  recipe: async (db, familyId, q) => {
    const rows = await db.recipe.findMany({
      where: { family_id: familyId, OR: [{ title: text(q) }, { description: text(q) }] },
      select: { id: true, title: true, prep_time: true },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      take,
    })
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.prep_time ? `${r.prep_time} min to prepare` : undefined,
      target: { type: 'recipe', id: r.id },
    }))
  },
  note: async (db, familyId, q) => {
    // Matches the body too, but never returns it: only the title is shown.
    const rows = await db.pinnedNote.findMany({
      where: { family_id: familyId, OR: [{ title: text(q) }, { body: text(q) }] },
      select: { id: true, title: true },
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      take,
    })
    return rows.map((n) => ({ id: n.id, title: n.title, subtitle: 'Note', target: { type: 'note' } }))
  },
  inventory: async (db, familyId, q) => {
    const rows = await db.inventoryItem.findMany({
      where: { family_id: familyId, status: 'active', name: text(q) },
      select: { id: true, name: true, location: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take,
    })
    return rows.map((i) => ({
      id: i.id,
      title: i.name,
      subtitle: `In the ${(LOCATION_LABELS[i.location as InventoryLocation] ?? 'Fridge').toLowerCase()}`,
      target: { type: 'inventory' },
    }))
  },
}

/** The types `role` gets while `features` are the household's flags, in result order. */
export function searchableTypes(role: string | null | undefined, features: FamilyFeatures): SearchResultType[] {
  return (Object.keys(LOADERS) as SearchResultType[]).filter(
    (type) => isFeatureEnabled(features, TYPE_FEATURE[type]) && canSearchType(role, type)
  )
}

export async function searchHousehold(
  db: SearchDb,
  input: { familyId: string; role: string; features: FamilyFeatures; q: string }
): Promise<SearchResult[]> {
  const types = searchableTypes(input.role, input.features)
  const groups = await Promise.all(types.map((type) => LOADERS[type](db, input.familyId, input.q)))
  const results: SearchResult[] = []
  types.forEach((type, index) => {
    for (const row of groups[index]) {
      const href = searchResultHref(input.role, row.target)
      if (!href) continue
      results.push({
        type,
        id: row.id,
        title: row.title,
        ...(row.subtitle ? { subtitle: row.subtitle } : {}),
        href,
        ...(row.date ? { date: row.date.toISOString() } : {}),
      })
    }
  })
  return results.slice(0, SEARCH_MAX_RESULTS)
}
