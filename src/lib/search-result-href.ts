import { canRoleAccessPath } from '@/lib/kid-access'

/**
 * Where a household search result (`GET /api/search`, route inventory F-3)
 * sends the viewer. One helper builds every link so the API and the page can
 * never disagree, and a link is only ever one the viewer's role may open (the
 * kid allowlist in `src/lib/kid-access.ts`): a result the role could not open
 * gets `null` and is left out, so search never widens what a teen or child
 * can see.
 */

export const SEARCH_RESULT_TYPES = [
  'member',
  'event',
  'chore',
  'list',
  'list_item',
  'recipe',
  'note',
  'inventory',
] as const

export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number]

/** The page each result type opens. A role that cannot open it gets no results of that type. */
export const SEARCH_TYPE_PAGE: Record<SearchResultType, string> = {
  member: '/dashboard/family',
  event: '/dashboard/calendar',
  chore: '/dashboard/chores',
  list: '/dashboard/lists',
  list_item: '/dashboard/lists',
  recipe: '/dashboard/meals/recipes',
  note: '/dashboard/notes',
  inventory: '/dashboard/inventory',
}

export type SearchHrefTarget =
  | { type: 'member' }
  | { type: 'event'; start: Date }
  | { type: 'chore' }
  | { type: 'list'; id: string }
  | { type: 'list_item'; listId: string }
  | { type: 'recipe'; id: string }
  | { type: 'note' }
  | { type: 'inventory' }

/** Whether `role` may get results of `type` at all. */
export function canSearchType(role: string | null | undefined, type: SearchResultType): boolean {
  return canRoleAccessPath(role, SEARCH_TYPE_PAGE[type])
}

function hrefFor(target: SearchHrefTarget): string {
  switch (target.type) {
    case 'event':
      // The calendar opens on a month (`/dashboard/calendar?year=&month=`).
      return `/dashboard/calendar?year=${target.start.getUTCFullYear()}&month=${target.start.getUTCMonth() + 1}`
    case 'list':
      return `/dashboard/lists/${encodeURIComponent(target.id)}`
    case 'list_item':
      return `/dashboard/lists/${encodeURIComponent(target.listId)}`
    case 'recipe':
      return `/dashboard/meals/recipes/${encodeURIComponent(target.id)}`
    default:
      return SEARCH_TYPE_PAGE[target.type]
  }
}

/** The link for one result, or `null` when `role` may not open it. */
export function searchResultHref(role: string | null | undefined, target: SearchHrefTarget): string | null {
  const href = hrefFor(target)
  return canRoleAccessPath(role, href.split('?')[0]) ? href : null
}
