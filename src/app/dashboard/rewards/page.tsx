import { Suspense } from 'react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'
import { EmptyState } from '@/components/ui/empty-state'
import { FeatureOffState } from '@/components/ui/feature-gate'
import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import { Gift } from 'lucide-react'
import RewardsBoard, { type RewardCard } from './RewardsBoard'

export const dynamic = 'force-dynamic'

interface RewardsPageProps {
  searchParams: Promise<{ tab?: string }>
}

async function RewardsContent({ userId, familyId }: { userId: string; familyId: string }) {
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
    claimedById: r.claimed_by,
    claimedByName: r.claimer?.name ?? null,
  }))

  return (
    <div className="space-y-8">
      {/* Your XP balance */}
      <div className="card-apple p-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Glyph color="rewards" size="lg">
            <span className="text-2xl" aria-hidden="true">⭐</span>
          </Glyph>
          <div>
            <p className="text-subhead text-label-secondary">Your XP Balance</p>
            <p className="text-title-2 text-label-primary font-bold">{userXp} XP</p>
          </div>
        </div>
        <Link
          href="/dashboard/analytics"
          className="inline-flex min-h-[44px] items-center text-subhead text-rewards hover:text-rewards/80 font-medium"
        >
          Leaderboard →
        </Link>
      </div>

      <RewardsBoard rewards={cards} userXp={userXp} isParent={isParent} currentUserId={userId} />
    </div>
  )
}

function RewardsSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="card-apple p-5 h-20" />
      <div>
        <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
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
        <LargeHeader title="Rewards" subtitle="Claim rewards with your earned XP" className="px-4" />
        <div className="px-4">
          <EmptyState
            icon={Gift}
            glyphColor="rewards"
            title="No family set up"
            description="Create or join a family to start earning and claiming rewards."
          />
        </div>
      </div>
    )
  }

  // Server-side gate (#248): with Rewards off, or Points & streaks off (which
  // Rewards needs), no XP balance or reward cost is rendered or serialised.
  if (!isFeatureEnabled(normalizeFeatures(user?.family?.features), 'rewards')) {
    return <FeatureOffState featureKey="rewards" canManage={sessionUser.role !== 'teen' && sessionUser.role !== 'child'} />
  }

  return (
    <div className="pb-20">
      <LargeHeader
        title="Rewards"
        subtitle={user?.family?.name ? `${user.family.name} family` : undefined}
        className="px-4"
      />
      <div className="px-4 mt-6">
        <Suspense fallback={<RewardsSkeleton />}>
          <RewardsContent userId={sessionUser.id} familyId={familyId} />
        </Suspense>
      </div>
    </div>
  )
}