import type { Metadata } from 'next'
import { after } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { normalizeFeatures } from '@/lib/features'
import { refreshStaleSubscriptions } from '@/lib/calendar-import/sync'
import TodayBoard from '@/components/fridge/TodayBoard'
import { buildTodayBoard } from './today-board-data'

export const metadata: Metadata = { title: 'Today' }

// Always render from current household data; the board re-requests this page
// on its own refresh interval (client-side router.refresh, not a server job).
export const dynamic = 'force-dynamic'

/**
 * Today board (#119 / #159): the glanceable household view for the fridge or
 * wall tablet, also usable on a phone. `?mode=fridge` hides the app chrome for
 * a mounted tablet. Shared-surface data rules live in ./today-board-data.ts.
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
    select: { role: true, family_id: true, family: { select: { features: true } } },
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

  const data = await buildTodayBoard(prisma!, {
    familyId,
    role: user.role,
    features: normalizeFeatures(user.family?.features),
  })

  return <TodayBoard data={data} fridgeMode={fridgeMode} />
}
