import { projectRewardPeople } from "@/lib/reward-people"
/** Opt-in rewards keysets; positions are never household authority. */
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
type Position = { createdAt: Date; id: string }
const cursorValue = z.tuple([
  z.literal('herewoven.rewards-page.v1'), z.string().min(1).max(128),
  z.enum(['available', 'claimed', 'approved', 'redeemed']).nullable(),
  z.string().datetime(), z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
])
export type RewardPaging =
  | { ok: true; paged: false }
  | { ok: true; paged: true; limit: number; status: string | null; cursor: Position | null }
  | { ok: false; error: string }
export function encodeRewardCursor(familyId: string, status: string | null, row: { created_at: Date; id: string }) {
  return Buffer.from(JSON.stringify(cursorValue.parse(['herewoven.rewards-page.v1', familyId, status, row.created_at.toISOString(), row.id])), 'utf8').toString('base64url')
}
export function parseRewardPaging(params: URLSearchParams, familyId: string): RewardPaging {
  const limit = params.get('limit'), cursor = params.get('cursor'), status = params.get('status')
  if (limit === null) return cursor === null ? { ok: true, paged: false } : { ok: false, error: 'cursor requires limit' }
  if (['limit', 'cursor', 'status'].some(key => params.getAll(key).length > 1)) return { ok: false, error: 'Duplicate reward paging parameter' }
  if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) return { ok: false, error: 'limit must be a whole number from 1 to 100' }
  if (status !== null && !['available', 'claimed', 'approved', 'redeemed'].includes(status)) return { ok: false, error: 'Invalid reward status filter' }
  let position: Position | null = null
  if (cursor !== null) {
    try {
      if (!cursor.length || cursor.length > 1024) throw new Error()
      const bytes = Buffer.from(cursor, 'base64url')
      if (bytes.toString('base64url') !== cursor) throw new Error()
      const value = cursorValue.parse(JSON.parse(bytes.toString('utf8')))
      if (value[1] !== familyId || value[2] !== status) throw new Error()
      position = { createdAt: new Date(value[3]), id: value[4] }
    } catch { return { ok: false, error: 'Invalid cursor for this reward filter' } }
  }
  return { ok: true, paged: true, limit: Number(limit), status, cursor: position }
}
export function afterRewardCursor(position: Position): Prisma.RewardWhereInput {
  return { OR: [{ created_at: { lt: position.createdAt } }, { created_at: position.createdAt, id: { gt: position.id } }] }
}
/** Shared API/SSR reader; one lookahead, never a complete-household pre-read. */
export async function readRewardPage(db: Pick<Prisma.TransactionClient, 'reward' | 'user'>, familyId: string, page: Extract<RewardPaging, { paged: true }>) {
  const rows = await db.reward.findMany({
    where: { family_id: familyId, ...(page.status ? { status: page.status } : {}), ...(page.cursor ? afterRewardCursor(page.cursor) : {}) },
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }], take: page.limit + 1,
  })
  const rewards = rows.slice(0, page.limit)
  return { rewards: await projectRewardPeople(db, familyId, rewards), nextCursor: rows.length > page.limit && rewards.length ? encodeRewardCursor(familyId, page.status, rewards[rewards.length - 1]) : null }
}
