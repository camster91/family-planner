/**
 * The `?type=` filter of `/dashboard/lists` (route inventory F-6, #289). The
 * old `/dashboard/lists/type/[type]` pages redirect to it.
 */

export const LIST_TYPE_KEYS = ['grocery', 'todo', 'meal_plan', 'wishlist', 'shopping'] as const

export type ListTypeKey = (typeof LIST_TYPE_KEYS)[number]

/** A known list type, or null (an unknown or missing `?type=` shows every list). */
export function listTypeFilter(value: string | string[] | null | undefined): ListTypeKey | null {
  const v = Array.isArray(value) ? value[0] : value
  return v && (LIST_TYPE_KEYS as readonly string[]).includes(v) ? (v as ListTypeKey) : null
}

/** Where a type filter lives: `/dashboard/lists?type=<type>`, or every list for an unknown type. */
export function listsFilterHref(value: string | string[] | null | undefined): string {
  const type = listTypeFilter(value)
  return type ? `/dashboard/lists?type=${type}` : '/dashboard/lists'
}
