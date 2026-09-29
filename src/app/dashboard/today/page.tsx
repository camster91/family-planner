import type { Metadata } from 'next'
import { after } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { refreshStaleSubscriptions } from '@/lib/calendar-import/sync'
import TodayBoard from '@/components/fridge/TodayBoard'
import HomeSummary from '@/components/dashboard/HomeSummary'
import { loadTodayBoard } from './board-snapshot'
import { loadHomeSummary } from './home-summary-data'

export const metadata: Metadata = { title: 'Today' }

// Always render from current household data; the board re-requests this page
// when its version check sees a change (#271: client-side polling of
// /api/family/board-version, then router.refresh; not a server job).
export const dynamic = 'force-dynamic'

/**
 * Today board (#119 / #159): the glanceable household view for the fridge or
 * wall tablet, also usable on a phone. `?mode=fridge` hides the app chrome for
 * a mounted tablet. Shared-surface data rules live in ./today-board-data.ts.
 *
 * One home (#269): this is the home for person sessions on every viewport;
 * /dashboard redirects parents here (children and teens keep their own kid
 * home at /dashboard). Outside fridge mode the page adds the viewer's summary
 * sentence and their own tickable chores above the board (#268,
 * ./home-summary-data.ts). Fridge mode is the shared surface, so it shows the
 * board alone.
 */
export default async function TodayBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>
}) {
  const sessionUser = await getServerUser()
  if (!sessionUser) return null

  // Role and household are read fresh from the database (D6, #102).
  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { role: true, family_id: true },
  })

  const params = await searchParams
  const fridgeMode = params.mode === 'fridge'

  if (!user?.family_id) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-title-1 text-label-primary">Today</h1>
        <p className="mt-3 text-body text-label-secondary">
          Join or create a household to see today&apos;s plans here.
        </p>
      </div>
    )
  }

  const familyId = user.family_id
  // Subscribed calendars (#232): refresh stale feeds after the response is sent,
  // exactly as the main dashboard does. Viewing drives it; there is no cron.
  after(() => refreshStaleSubscriptions(familyId))

  const now = new Date()
  // Weather (#262) is opt-in per household and never fails the page: null
  // hides the tile. The board carries its display settings and change
  // version (#271).
  const [data, home] = await Promise.all([
    loadTodayBoard(prisma!, { familyId, role: user.role, now, withWeather: true }),
    fridgeMode ? Promise.resolve(null) : loadHomeSummary(prisma!, { familyId, role: user.role }),
  ])

  if (!home) return <TodayBoard data={data} fridgeMode={fridgeMode} />

  return (
    <>
      <HomeSummary viewer={{ id: sessionUser.id, role: user.role }} {...home} />
      <TodayBoard data={data} fridgeMode={fridgeMode} />
    </>
  )
}
