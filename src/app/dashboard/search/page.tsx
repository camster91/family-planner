import SearchClient from './SearchClient'

export const dynamic = 'force-dynamic'

/**
 * Household search (route inventory F-3). Parent-only in the UI, like every
 * page not on the kid allowlist (the middleware sends teens and children
 * home); `GET /api/search` enforces household, feature and role rules on its
 * own. `?q=` pre-fills the box, so the command palette can link here.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams
  const initialQuery = typeof q === 'string' ? q.slice(0, 100) : ''
  return <SearchClient initialQuery={initialQuery} />
}
