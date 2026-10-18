import { Suspense } from 'react'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { FeatureOffState } from '@/components/ui/feature-gate'
import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import RewardsBoard, { type RewardCard } from './RewardsBoard'
import { RewardsNoFamilyState, RewardsPageHeader } from '@/components/rewards/RewardsPageHeader'

export const dynamic = 'force-dynamic'

interface RewardsPageProps {
  searchParams: Promise<{ tab?: string }>
}

async function RewardsContent({
  userId,
  familyId,
  canViewAnalytics,
}: {
  userId: string;
  familyId: string;
  canViewAnalytics: boolean;
}) {
  const sessionUser = await getServerUser()
  if (!sessionUser) return null

  const [rewards, user] = await Promise.all([
    prisma!.reward.findMany({
      where: { family_id: familyId },
      include: {
        creator: { select: { name: true } },
        claimer: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' }
    }),
    prisma!.user.findUnique({
      where: { id: userId },
      select: { xp: true, role: true },
    }),
  ])

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

  return (
    <div className="space-y-8">
      <RewardsBoard
        rewards={cards}
        userXp={userXp}
        isParent={isParent}
        currentUserId={userId}
        canViewAnalytics={canViewAnalytics}
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
          <RewardsContent userId={sessionUser.id} familyId={familyId} canViewAnalytics={canViewAnalytics} />
        </Suspense>
      </div>
    </div>
  )
}
