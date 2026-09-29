import { redirect } from 'next/navigation'
import { listsFilterHref } from '@/lib/list-type-filter'

export const dynamic = 'force-dynamic'

/**
 * Route inventory F-6 (#289): this page duplicated a filter of
 * `/dashboard/lists`. Old links and bookmarks now land on that filter,
 * `/dashboard/lists?type=<type>`; an unknown type opens every list. Reads no
 * household data, so the redirect itself needs no session (the lists page and
 * the dashboard middleware still apply).
 */
export default async function ListsByTypePage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params
  redirect(listsFilterHref(type))
}
