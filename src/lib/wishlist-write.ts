/**
 * Transactional Wishlist mutations with optional idempotency receipts.
 *
 * The routes keep their existing auth, device, feature and validation guards.
 * Keyed effects repeat membership, feature and requester/parent checks under
 * the user -> household -> receipt lock order so a retry cannot outlive a
 * role, household or feature change. Legacy requests without a key use the
 * same mutation helpers but do not create a receipt.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import type { z } from 'zod'
import type {
  createWishlistItemSchema,
  updateWishlistItemSchema,
  wishlistStatusSchema,
} from '@/lib/validations'
import type { EffectResult } from '@/lib/idempotency'
import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import { lockHousehold, lockUser } from '@/lib/household-lock'

type WishlistTx = Prisma.TransactionClient
type WishlistDb = Pick<PrismaClient, '$transaction'>
type CreateInput = z.infer<typeof createWishlistItemSchema>
type UpdateInput = z.infer<typeof updateWishlistItemSchema>
type StatusInput = z.infer<typeof wishlistStatusSchema>
type Actor = { familyId: string; userId: string }
export type WishlistMutation = 'create' | 'update' | 'delete' | 'status'

const ACTIONS: Record<WishlistMutation, string> = {
  create: 'wishlist.create',
  update: 'wishlist.update',
  delete: 'wishlist.delete',
  status: 'wishlist.status',
}

const inProgress = (): EffectResult => ({
  status: 409,
  body: {
    error: {
      code: 'IDEMPOTENCY_IN_PROGRESS',
      message: 'Please retry this wishlist change.',
      retryable: true,
    },
  },
})

function noFamily(): EffectResult {
  return { status: 400, body: { error: 'No family' } }
}

function featureOff(): EffectResult {
  return {
    status: 403,
    body: { error: 'This feature is turned off for your family' },
  }
}

function forbidden(): EffectResult {
  return { status: 403, body: { error: 'Forbidden' } }
}

function parentOnly(): EffectResult {
  return {
    status: 403,
    body: { error: 'Only parents can perform this action' },
  }
}

function ownerOrParent(actor: { id: string; role: string }, requestedBy: string) {
  return requestedBy === actor.id || actor.role === 'parent'
}

function serializeItem(item: Record<string, any>) {
  return {
    ...item,
    approx_price: item.approx_price == null ? null : item.approx_price.toString(),
  }
}

function itemResult(status: number, item: Record<string, any>): EffectResult {
  // NextResponse.json serializes Date fields on the wire. Normalize the
  // effect body before both the initial response and its stored receipt so a
  // retry has the exact same canonical DTO under test transports too.
  return {
    status,
    body: JSON.parse(JSON.stringify({ item: serializeItem(item) })),
  }
}

/** Normalize the values already accepted by the legacy routes before hashing. */
export function normalizeWishlistCreate(input: CreateInput): CreateInput {
  return {
    title: input.title.trim(),
    link: input.link?.trim() || null,
    description: input.description?.trim() || null,
    approx_price: input.approx_price ?? null,
  }
}

export function normalizeWishlistUpdate(input: UpdateInput): UpdateInput {
  const out: UpdateInput = {}
  if (input.title !== undefined) out.title = input.title.trim()
  if (input.link !== undefined) out.link = input.link?.trim() || null
  if (input.description !== undefined) out.description = input.description?.trim() || null
  if (input.approx_price !== undefined) out.approx_price = input.approx_price
  return out
}

export function normalizeWishlistStatus(input: StatusInput): StatusInput {
  return {
    status: input.status,
    denied_reason: input.status === 'denied' ? input.denied_reason?.trim() : undefined,
  }
}

type CurrentActor = { id: string; family_id: string | null; role: string }
type Prepared = { actor: CurrentActor } | { result: EffectResult }

async function prepare(
  tx: WishlistTx,
  actor: Actor,
  recordId: string | null,
): Promise<Prepared> {
  await lockUser(tx, actor.userId)
  await lockHousehold(tx, actor.familyId)

  const currentActor = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, family_id: true, role: true },
  })
  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { id: true, features: true },
  })
  if (!family || !currentActor || currentActor.family_id !== actor.familyId) {
    return { result: noFamily() }
  }

  // The route's feature gate preserves no-key compatibility. Keyed effects
  // also recheck the effective flag under the mutation locks for race safety.
  if (recordId && !isFeatureEnabled(normalizeFeatures(family.features), 'wishlist')) {
    return { result: featureOff() }
  }

  if (recordId) {
    await tx.$queryRaw`
      SELECT "id"
      FROM "IdempotencyRecord"
      WHERE "id" = ${recordId}
      FOR UPDATE
    `
    const receipt = await tx.idempotencyRecord.findFirst({
      where: {
        id: recordId,
        family_id: actor.familyId,
        user_id: actor.userId,
      },
      select: { response_status: true, response_body: true },
    })
    if (!receipt) return { result: inProgress() }
    if (receipt.response_status != null) {
      return {
        result: {
          status: receipt.response_status,
          body: receipt.response_body,
        },
      }
    }
  }

  return { actor: currentActor }
}

async function storeReceipt(
  tx: WishlistTx,
  recordId: string | null,
  result: EffectResult,
): Promise<void> {
  if (!recordId || result.status < 200 || result.status >= 300) return
  await tx.idempotencyRecord.update({
    where: { id: recordId },
    data: {
      response_status: result.status,
      response_body: JSON.parse(JSON.stringify(result.body)) as Prisma.InputJsonObject,
    },
  })
}

export async function createWishlistWithReceipt(
  db: WishlistDb,
  input: CreateInput,
  actor: Actor,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, recordId)
    if ('result' in prepared) return prepared.result

    const item = await tx.wishlistItem.create({
      data: {
        family_id: actor.familyId,
        requested_by: actor.userId,
        title: input.title,
        link: input.link || null,
        description: input.description || null,
        approx_price:
          input.approx_price == null
            ? null
            : new Prisma.Decimal(input.approx_price.toFixed(2)),
      },
      include: { requester: { select: { id: true, name: true } } },
    })
    const result = itemResult(201, item)
    await storeReceipt(tx, recordId, result)
    return result
  })
}

export async function updateWishlistWithReceipt(
  db: WishlistDb,
  id: string,
  input: UpdateInput,
  actor: Actor,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, recordId)
    if ('result' in prepared) return prepared.result

    const existing = await tx.wishlistItem.findUnique({
      where: { id },
      select: { family_id: true, requested_by: true },
    })
    if (!existing) return { status: 404, body: { error: 'Not found' } }
    if (existing.family_id !== actor.familyId) return forbidden()
    if (!ownerOrParent(prepared.actor, existing.requested_by)) return forbidden()

    const data: Record<string, unknown> = {}
    if (input.title !== undefined) data.title = input.title
    if (input.link !== undefined) data.link = input.link || null
    if (input.description !== undefined) data.description = input.description || null
    if (input.approx_price !== undefined) {
      data.approx_price = input.approx_price === null
        ? null
        : new Prisma.Decimal(input.approx_price.toFixed(2))
    }

    const updated = await tx.wishlistItem.update({
      where: { id },
      data,
      include: { requester: { select: { id: true, name: true } } },
    })
    const result = itemResult(200, updated)
    await storeReceipt(tx, recordId, result)
    return result
  })
}

export async function deleteWishlistWithReceipt(
  db: WishlistDb,
  id: string,
  actor: Actor,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, recordId)
    if ('result' in prepared) return prepared.result

    const existing = await tx.wishlistItem.findUnique({
      where: { id },
      select: { family_id: true, requested_by: true },
    })
    if (!existing) return { status: 404, body: { error: 'Not found' } }
    if (existing.family_id !== actor.familyId) return forbidden()
    if (!ownerOrParent(prepared.actor, existing.requested_by)) return forbidden()

    await tx.wishlistItem.delete({ where: { id } })
    const result = { status: 200, body: { success: true } } satisfies EffectResult
    await storeReceipt(tx, recordId, result)
    return result
  })
}

export async function updateWishlistStatusWithReceipt(
  db: WishlistDb,
  id: string,
  input: StatusInput,
  actor: Actor,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, recordId)
    if ('result' in prepared) return prepared.result
    if (prepared.actor.role !== 'parent') return parentOnly()

    const existing = await tx.wishlistItem.findUnique({
      where: { id },
      select: { family_id: true },
    })
    if (!existing) return { status: 404, body: { error: 'Not found' } }
    if (existing.family_id !== actor.familyId) return forbidden()

    const updated = await tx.wishlistItem.update({
      where: { id },
      data: {
        status: input.status,
        denied_reason: input.status === 'denied' ? (input.denied_reason ?? '').trim() : null,
        status_changed_at: new Date(),
        status_changed_by: actor.userId,
      },
      include: {
        requester: { select: { id: true, name: true } },
        status_changer: { select: { id: true, name: true } },
      },
    })
    const result = itemResult(200, updated)
    await storeReceipt(tx, recordId, result)
    return result
  })
}

function receiptItem(body: unknown): { requestedBy: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const item = (body as { item?: unknown }).item
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const requestedBy = (item as { requested_by?: unknown }).requested_by
  return typeof requestedBy === 'string' ? { requestedBy } : null
}

/** Recheck current authority before returning a completed keyed response. */
export async function authorizeWishlistReplay(
  db: WishlistDb,
  mutation: WishlistMutation,
  actor: Actor,
  id?: string,
  replayKey?: string | null,
): Promise<EffectResult | null> {
  return db.$transaction(async (tx) => {
    await lockUser(tx, actor.userId)
    await lockHousehold(tx, actor.familyId)
    const currentActor = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, family_id: true, role: true },
    })
    const family = await tx.family.findUnique({
      where: { id: actor.familyId },
      select: { id: true, features: true },
    })
    if (!family || !currentActor || currentActor.family_id !== actor.familyId) return noFamily()
    if (!isFeatureEnabled(normalizeFeatures(family.features), 'wishlist')) return featureOff()
    if (mutation === 'create') return null
    if (!id) return { status: 400, body: { error: 'Wishlist item ID is required' } }

    const existing = await tx.wishlistItem.findUnique({
      where: { id },
      select: { family_id: true, requested_by: true },
    })
    if (existing && existing.family_id !== actor.familyId) return forbidden()

    if (mutation === 'status' && currentActor.role !== 'parent') return parentOnly()
    if (existing) {
      if (mutation === 'update' || mutation === 'delete') {
        if (!ownerOrParent(currentActor, existing.requested_by)) return forbidden()
      }
      return null
    }

    // A completed keyed delete/update/status must not create a new row. If
    // the original row was removed, a delete is safe to replay because the
    // receipt is scoped to this authenticated user and the row is already
    // absent; the current family, feature and identity checks above still
    // apply. Missing status rows remain safe parent replays.
    if (mutation === 'delete' || mutation === 'status') return null
    if (!replayKey) return { status: 404, body: { error: 'Not found' } }
    const receipt = await tx.idempotencyRecord.findFirst({
      where: {
        scope: `user:${actor.userId}`,
        key: replayKey,
        family_id: actor.familyId,
        user_id: actor.userId,
        action: ACTIONS[mutation],
      },
      select: { response_body: true },
    })
    const original = receiptItem(receipt?.response_body)
    if (!original || !ownerOrParent(currentActor, original.requestedBy)) return forbidden()
    return null
  })
}

export const wishlistAction = (mutation: WishlistMutation) => ACTIONS[mutation]
