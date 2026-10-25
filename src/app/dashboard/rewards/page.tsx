import { readRewardNotificationFocus } from "@/lib/reward-notification-focus"
import { parseRewardPaging, readRewardPage } from '@/lib/reward-paging'
import { Suspense } from 'react'
import { getServerUser, getServerActor } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { FeatureOffState } from '@/components/ui/feature-gate'
import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import RewardsBoard, { type RewardCard } from './RewardsBoard'
import { RewardsNoFamilyState, RewardsPageHeader, RewardsPagingFailure, RewardNotificationUnavailable } from '@/components/rewards/RewardsPageHeader'

export const dynamic = 'force-dynamic'

interface RewardsPageProps {
  searchParams: Promise<{ tab?: string; cursor?: string | string[]; focus?: string | string[] }>
}

async function RewardsContent({
  userId,
  familyId,
  canViewAnalytics,
  cursor,
  focus,
}: {
  userId: string;
  familyId: string;
  canViewAnalytics: boolean;
  cursor?: string | string[];
  focus?: string | string[];
}) {
  const sessionUser = await getServerActor()
  if (!sessionUser || sessionUser.id !== userId) return null
  const params = new URLSearchParams({ limit: '24' })
  if (Array.isArray(cursor)) return <RewardsPagingFailure />
  if (cursor !== undefined) params.set('cursor', cursor)
  const paging = parseRewardPaging(params, familyId)
  if (!paging.ok || !paging.paged) return <RewardsPagingFailure />
  const user = await prisma!.user.findUnique({ where: { id: userId }, select: { xp: true, role: true, family_id: true } })
  if (!user || user.family_id !== familyId) return null
  const { rewards, nextCursor } = await readRewardPage(prisma!, familyId, paging)

  const userXp = user?.xp || 0
  const isParent = user?.role === 'parent'

  const cards: RewardCard[] = rewards.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    icon: r.icon,
    cost: r.cost,
    status: r.status,
    active: r.is_active,
    claimedById: r.claimed_by,
    claimedByName: r.claimer?.name ?? null,
  }))

  const notificationFocus = focus !== undefined ? {
    target: sessionUser.family_id === familyId && sessionUser.role === user.role
      ? await readRewardNotificationFocus(prisma!, { userId, familyId, role: user.role, tokenVersion: sessionUser.tokenVersion }, focus).catch(() => null)
      : null,
  } : undefined
  // Failed focus authority must not serialize the earlier shelf/balance reads.
  if (notificationFocus && !notificationFocus.target) return <RewardNotificationUnavailable />

  return (
    <div className="space-y-8">
      <RewardsBoard
        notificationFocus={notificationFocus}
        rewards={cards}
        userXp={userXp}
        isParent={isParent}
        currentUserId={userId}
        canViewAnalytics={canViewAnalytics && user.role === 'parent'}
        pageInfo={{ older: cursor !== undefined, nextCursor }}
      />
    </div>
  )
}

function RewardsSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="card-apple p-5 h-20" />
      <div>
        <div className="h-4 w-32 bg-muted rounded mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="card-apple p-5 h-48" />
          ))}
        </div>
      </div>
    </div>
  )
}

export default async function RewardsPage({ searchParams }: RewardsPageProps) {
  const params = await searchParams
  const sessionUser = await getServerUser()
  if (!sessionUser) return null

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      family_id: true,
      family: { select: { name: true, features: true } },
    },
  })

  const familyId = user?.family_id
  if (!familyId) {
    if (params.focus !== undefined) return <RewardNotificationUnavailable />
    return (
      <div className="space-y-6">
        <RewardsPageHeader className="px-4" />
        <div className="px-4">
          <RewardsNoFamilyState />
        </div>
      </div>
    )
  }

  // Server-side gate (#248): with Rewards off, or Points & streaks off (which
  // Rewards needs), no XP balance or reward cost is rendered or serialised.
  if (!isFeatureEnabled(normalizeFeatures(user?.family?.features), 'rewards')) {
    if (params.focus !== undefined) return <RewardNotificationUnavailable />
    return <FeatureOffState featureKey="rewards" canManage={sessionUser.role !== 'teen' && sessionUser.role !== 'child'} />
  }

  // Analytics is a parent-only surface and is also dependent on Points &
  // streaks. Compute this once on the server so the client cannot infer a
  // role or feature grant from a stale family payload.
  const canViewAnalytics = sessionUser.role === 'parent' &&
    isFeatureEnabled(normalizeFeatures(user?.family?.features), 'analytics')

  return (
    <div className="pb-20">
      <RewardsPageHeader
        familyName={user?.family?.name}
        className="w-full px-4 sm:px-6 lg:px-8"
      />
      <div className="mx-auto mt-6 w-full max-w-[1440px] px-4 sm:px-6 lg:px-8">
        <Suspense fallback={<RewardsSkeleton />}>
          <RewardsContent userId={sessionUser.id} familyId={familyId} canViewAnalytics={canViewAnalytics} cursor={params.cursor} focus={params.focus} />
        </Suspense>
      </div>
    </div>
  )
}
