import { Suspense } from 'react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { cn } from '@/lib/utils'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'
import { EmptyState } from '@/components/ui/empty-state'

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

  // Split into claimable (available, not claimed by user) and family (all)
  const claimableRewards = rewards.filter(r => r.status === 'available')
  const familyRewards = rewards

  return (
    <div className="space-y-8">
      {/* Your XP balance */}
      <div className="card-apple p-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Glyph color="rewards" size="lg">
            <span className="text-2xl">⭐</span>
          </Glyph>
          <div>
            <p className="text-subhead text-label-secondary">Your XP Balance</p>
            <p className="text-title-2 text-label-primary font-bold">{userXp} XP</p>
          </div>
        </div>
        <Link href="/dashboard/analytics" className="text-subhead text-rewards hover:text-rewards/80 font-medium">
          Leaderboard →
        </Link>
      </div>

      {/* Your Claimable Rewards */}
      {claimableRewards.length > 0 && (
        <section>
          <p className="section-header">Claimable Rewards</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {claimableRewards.map(reward => {
              const canClaim = userXp >= reward.cost
              return (
                <div key={reward.id} className="card-apple p-5 flex flex-col gap-4">
                  <Glyph color="rewards" size="lg">
                    <span className="text-2xl">{reward.icon || '🎁'}</span>
                  </Glyph>
                  <div>
                    <h3 className="text-title-3 text-label-primary font-semibold">{reward.name}</h3>
                    {reward.description && (
                      <p className="text-footnote text-label-secondary mt-1 line-clamp-2">{reward.description}</p>
                    )}
                    <p className="text-subhead text-rewards font-medium mt-2">{reward.cost} XP</p>
                  </div>
                  <button
                    disabled={!canClaim}
                    className={cn(
                      'btn-tinted w-full py-2.5 text-base font-semibold',
                      canClaim ? 'bg-rewards' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    )}
                  >
                    {userXp < reward.cost ? `Need ${reward.cost - userXp} more XP` : 'Claim Reward'}
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* All Family Rewards */}
      <section>
        <p className="section-header">All Family Rewards</p>
        {familyRewards.length === 0 ? (
          <EmptyState
            icon={Gift}
            glyphColor="rewards"
            title="No rewards yet"
            description={isParent ? "Create your first reward for the family." : "Ask a parent to create rewards."}
            action={isParent ? (
              <Link href="/dashboard/rewards/create" className="btn-tinted bg-rewards px-5 py-2 text-base font-medium">
                Create Reward
              </Link>
            ) : undefined}
          />
        ) : (
          <div className="space-y-3">
            {familyRewards.map(reward => {
              const statusBadge = {
                available: { label: 'Available', class: 'bg-green-100 text-green-700' },
                claimed: { label: 'Claimed', class: 'bg-yellow-100 text-yellow-700' },
                redeemed: { label: 'Redeemed', class: 'bg-blue-100 text-blue-700' },
              }[reward.status] ?? { label: reward.status, class: 'bg-gray-100 text-gray-600' }

              return (
                <div key={reward.id} className="card-apple p-4 flex items-center gap-4">
                  <Glyph color="rewards" size="md">
                    <span className="text-lg">{reward.icon || '🎁'}</span>
                  </Glyph>
                  <div className="flex-1 min-w-0">
                    <p className="text-body text-label-primary font-medium truncate">{reward.name}</p>
                    <p className="text-footnote text-label-secondary">{reward.cost} XP</p>
                  </div>
                  <span className={cn('text-caption-1 px-2.5 py-1 rounded-full font-medium', statusBadge.class)}>
                    {statusBadge.label}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>
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

import { Gift } from 'lucide-react'

export default async function RewardsPage({ searchParams }: RewardsPageProps) {
  const params = await searchParams
  const sessionUser = await getServerUser()
  if (!sessionUser) return null

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true }
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