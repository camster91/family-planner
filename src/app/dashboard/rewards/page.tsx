import { rewardActionCommandsEnabled } from "@/lib/reward-action-command"
import { validRewardActionOwner } from "@/lib/reward-action-shared"
import { withRewardReadAccess } from "@/lib/reward-read-access"
import { authorizeRewardReplay, type RewardActor } from "@/lib/reward-mutations"
import { readRewardNotificationFocus } from "@/lib/reward-notification-focus"
import { parseRewardPaging, readRewardPage } from '@/lib/reward-paging'
import { Suspense } from 'react'
import { getServerActor } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { FeatureOffState } from '@/components/ui/feature-gate'
import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import { storageBackend } from '@/lib/storage-backend'
import { getD1Database } from '@/lib/cloudflare/database'
import { withD1ReadClient, type NativeD1 } from '@/lib/cloudflare/read-client'
import { readD1RewardNotificationFocus, readD1Rewards } from '@/lib/cloudflare/rewards'
import RewardsBoard, { type RewardCard } from './RewardsBoard'
import { RewardsNoFamilyState, RewardsPageHeader, RewardsPagingFailure, RewardNotificationUnavailable, RewardsReadUnavailable } from '@/components/rewards/RewardsPageHeader'

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
  const unavailable = focus !== undefined ? <RewardNotificationUnavailable /> : <RewardsReadUnavailable />
  if (storageBackend() === 'd1') {
    const actor = {
      userId,
      familyId,
      role: sessionUser.role ?? '',
      generation: sessionUser.tokenVersion,
    }
    const result = await readD1Rewards(actor, { status: null, paging })
    if (result.status !== 200) return unavailable
    const body = result.body as { rewards?: Array<Record<string, unknown>>; nextCursor?: string | null }
    const rewards = body.rewards ?? []
    const user = await withD1ReadClient(async db => db.user.findUnique({
      where: { id: userId },
      select: { xp: true, role: true, family_id: true },
    }), await getD1Database() as unknown as NativeD1)
    if (!user || user.family_id !== familyId || user.role !== sessionUser.role) return unavailable
    const cards: RewardCard[] = rewards.map(reward => ({
      id: String(reward.id),
      sourceGeneration: String(reward.notification_generation),
      name: String(reward.name),
      description: (reward.description as string | null) ?? null,
      icon: (reward.icon as string | null) ?? null,
      cost: Number(reward.cost),
      status: String(reward.status),
      active: reward.is_active === true,
      claimedById: (reward.claimed_by as string | null) ?? null,
      claimedByName: (reward.claimer as { name?: string } | null)?.name ?? null,
    }))
    const notificationFocus = focus !== undefined
      ? { target: await readD1RewardNotificationFocus(actor, focus) }
      : undefined
    if (notificationFocus && !notificationFocus.target) return <RewardNotificationUnavailable />
    const candidateOwner = { userId, familyId, role: user.role, generation: sessionUser.tokenVersion }
    const ownedActions = rewardActionCommandsEnabled() ? { owner: validRewardActionOwner(candidateOwner) ? candidateOwner : null } : undefined
    return (
      <div className="space-y-8">
        <RewardsBoard
          ownedActions={ownedActions}
          notificationFocus={notificationFocus}
          rewards={cards}
          userXp={Number(user.xp ?? 0)}
          isParent={user.role === 'parent'}
          currentUserId={userId}
          familyId={familyId}
          viewerRole={user.role}
          sessionGeneration={sessionUser.tokenVersion}
          canViewAnalytics={canViewAnalytics && user.role === 'parent'}
          pageInfo={{ older: cursor !== undefined, nextCursor: body.nextCursor ?? null }}
        />
      </div>
    )
  }
  const original: RewardActor = { userId, familyId, role: sessionUser.role ?? '', tokenVersion: sessionUser.tokenVersion }
  if (sessionUser.family_id !== familyId) return unavailable
  const scope = await withRewardReadAccess(prisma!, original, async tx => ({
    user: await tx.user.findUnique({ where: { id: userId }, select: { xp: true, role: true, family_id: true } }),
    page: await readRewardPage(tx, familyId, paging),
  })).catch(() => null)
  if (!scope || scope.kind !== 'data' || !scope.value.user || scope.value.user.family_id !== familyId) return unavailable
  const { user, page: { rewards, nextCursor } } = scope.value

  const userXp = user?.xp || 0
  const isParent = user?.role === 'parent'

  const cards: RewardCard[] = rewards.map(r => ({
    id: r.id,
    sourceGeneration: r.notification_generation,
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
  if (await authorizeRewardReplay(prisma!, original, false).catch(() => ({ status: 503, body: {} }))) return unavailable

  const candidateOwner = { userId, familyId, role: user.role, generation: sessionUser.tokenVersion }
  const ownedActions = rewardActionCommandsEnabled() ? { owner: validRewardActionOwner(candidateOwner) ? candidateOwner : null } : undefined

  return (
    <div className="space-y-8">
      <RewardsBoard
        ownedActions={ownedActions}
        notificationFocus={notificationFocus}
        rewards={cards}
        userXp={userXp}
        isParent={isParent}
        currentUserId={userId}
        familyId={familyId}
        viewerRole={user.role}
        sessionGeneration={sessionUser.tokenVersion}
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
  const sessionUser = await getServerActor()
  if (!sessionUser) return null

  const user = storageBackend() === 'd1'
    ? await withD1ReadClient(async db => db.user.findUnique({
      where: { id: sessionUser.id },
      select: { family_id: true, family: { select: { name: true, features: true } } },
    }), await getD1Database() as unknown as NativeD1)
    : await prisma!.user.findUnique({
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

  const replayRefusal = storageBackend() === 'd1' ? null : await authorizeRewardReplay(prisma!, {
    userId: sessionUser.id, familyId, role: sessionUser.role ?? '', tokenVersion: sessionUser.tokenVersion,
  }, false).catch(() => ({ status: 503, body: {} }))
  if (sessionUser.family_id !== familyId || replayRefusal) return params.focus !== undefined ? <RewardNotificationUnavailable /> : <RewardsReadUnavailable />

  // Analytics is a parent-only surface and is also dependent on Points &
  // streaks. Compute this once on the server so the client cannot infer a
  // role or feature grant from a stale family payload.
  const canViewAnalytics = sessionUser.role === 'parent' &&
    isFeatureEnabled(normalizeFeatures(user?.family?.features), 'analytics')

  return (
    <div>
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
