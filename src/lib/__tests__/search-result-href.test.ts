// Household search links and query rules (route inventory F-3).
import { canSearchType, searchResultHref, SEARCH_RESULT_TYPES, SEARCH_TYPE_PAGE } from '@/lib/search-result-href'
import { escapeLikePattern, parseSearchQuery, searchableTypes } from '@/lib/household-search'
import { defaultFeatures, normalizeFeatures } from '@/lib/features'
import { canRoleAccessPath } from '@/lib/kid-access'

describe('searchResultHref', () => {
  it('builds each link from the record', () => {
    expect(searchResultHref('parent', { type: 'list', id: 'l 1' })).toBe('/dashboard/lists/l%201')
    expect(searchResultHref('parent', { type: 'list_item', listId: 'l1' })).toBe('/dashboard/lists/l1')
    expect(searchResultHref('parent', { type: 'recipe', id: 'r1' })).toBe('/dashboard/meals/recipes/r1')
    expect(searchResultHref('parent', { type: 'event', start: new Date('2026-12-31T20:00:00Z') })).toBe(
      '/dashboard/calendar?year=2026&month=12'
    )
    expect(searchResultHref('parent', { type: 'member' })).toBe('/dashboard/family')
    expect(searchResultHref('parent', { type: 'chore' })).toBe('/dashboard/chores')
    expect(searchResultHref('parent', { type: 'note' })).toBe('/dashboard/notes')
    expect(searchResultHref('parent', { type: 'inventory' })).toBe('/dashboard/inventory')
  })

  it.each(['teen', 'child'])('gives a %s only links the kid allowlist opens, else null', (role) => {
    expect(searchResultHref(role, { type: 'list', id: 'l1' })).toBe('/dashboard/lists/l1')
    expect(searchResultHref(role, { type: 'inventory' })).toBe('/dashboard/inventory')
    expect(searchResultHref(role, { type: 'member' })).toBeNull()
    expect(searchResultHref(role, { type: 'note' })).toBeNull()
    expect(searchResultHref(role, { type: 'chore' })).toBeNull()
  })

  it('links a teen to the calendar and recipes (O-37), and a child to neither', () => {
    const start = new Date('2026-12-31T20:00:00Z')
    expect(searchResultHref('teen', { type: 'recipe', id: 'r1' })).toBe('/dashboard/meals/recipes/r1')
    expect(searchResultHref('teen', { type: 'event', start })).toBe('/dashboard/calendar?year=2026&month=12')
    expect(searchResultHref('child', { type: 'recipe', id: 'r1' })).toBeNull()
    expect(searchResultHref('child', { type: 'event', start })).toBeNull()
  })

  it('agrees with the kid allowlist for every type', () => {
    for (const role of ['parent', 'teen', 'child']) {
      for (const type of SEARCH_RESULT_TYPES) {
        expect([role, type, canSearchType(role, type)]).toEqual([role, type, canRoleAccessPath(role, SEARCH_TYPE_PAGE[type])])
      }
    }
    expect(SEARCH_RESULT_TYPES.every((t) => canSearchType('parent', t))).toBe(true)
  })
})

describe('parseSearchQuery', () => {
  it('trims, collapses spaces and bounds the length in characters', () => {
    expect(parseSearchQuery('  Milk   and  eggs ')).toEqual({ ok: true, q: 'Milk and eggs' })
    expect(parseSearchQuery(null)).toMatchObject({ ok: false, code: 'QUERY_TOO_SHORT' })
    expect(parseSearchQuery('a')).toMatchObject({ ok: false, code: 'QUERY_TOO_SHORT' })
    expect(parseSearchQuery('é')).toMatchObject({ ok: false, code: 'QUERY_TOO_SHORT' })
    expect(parseSearchQuery('éé')).toEqual({ ok: true, q: 'éé' })
    // 100 emoji are 100 characters (200 UTF-16 units): allowed.
    expect(parseSearchQuery('🍎'.repeat(100))).toMatchObject({ ok: true })
    expect(parseSearchQuery('🍎'.repeat(101))).toMatchObject({ ok: false, code: 'QUERY_TOO_LONG' })
  })
})

describe('escapeLikePattern', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLikePattern('50% off_now\\')).toBe('50\\% off\\_now\\\\')
    expect(escapeLikePattern('milk')).toBe('milk')
  })
})

describe('searchableTypes', () => {
  it('follows the features and the role', () => {
    const all = normalizeFeatures({ inventory: true })
    expect(searchableTypes('parent', all)).toEqual(['member', 'event', 'chore', 'list', 'list_item', 'recipe', 'note', 'inventory'])
    expect(searchableTypes('child', all)).toEqual(['list', 'list_item', 'inventory'])
    expect(searchableTypes('parent', defaultFeatures())).not.toContain('inventory')
    expect(searchableTypes('parent', normalizeFeatures({ meals: false, notes: false }))).toEqual([
      'member',
      'event',
      'chore',
      'list',
      'list_item',
    ])
  })
})
