/**
 * "Used it", "Throw away" and Undo for inventory items (#158/#121).
 * Contract: docs/architecture/MEALS_AND_GROCERIES.md §10 "Consume, discard
 * and undo".
 *
 * - Household-scoped: every read and write filters on `family_id`, so another
 *   household's item or adjustment id answers exactly like a missing one.
 * - Consume: without an amount (or with one at least the item's amount) the
 *   item becomes `consumed`; a smaller positive amount reduces `amount` and
 *   leaves it active. Discard makes it `discarded`. Either way one
 *   `InventoryAdjustment` row records the kind, the amount change, the actor
 *   and what Undo needs to restore.
 * - Concurrency: the item update is a compare-and-set on `updated_at`; the
 *   item's new `updated_at` is the adjustment's `created_at`, so Undo can
 *   prove nothing changed the item since (otherwise 409).
 * - Retries: the route runs these inside `withIdempotency`; the adjustment
 *   carries the idempotency record id (`request_id`, unique), so a re-run
 *   after a crash finds the row it already wrote and converges. Undo of an
 *   already undone row returns the item as it is (also convergent).
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { INVENTORY_ITEM_SELECT, type InventoryRow } from '@/lib/inventory'

export const ADJUSTMENT_KINDS = ['consume', 'discard'] as const
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number]

export const ADJUSTMENT_SELECT = {
  id: true,
  item_id: true,
  kind: true,
  amount_delta: true,
  amount_before: true,
  amount_after: true,
  status_before: true,
  status_after: true,
  actor_id: true,
  created_at: true,
  undone_at: true,
} as const

export interface AdjustmentRow {
  id: string
  item_id: string
  kind: string
  amount_delta: number | null
  amount_before: number | null
  amount_after: number | null
  status_before: string
  status_after: string
  actor_id: string | null
  created_at: Date | string
  undone_at: Date | string | null
}

/** Adjustment as the API returns it. Never `family_id` or `request_id`. */
export interface AdjustmentDto {
  id: string
  item_id: string
  kind: AdjustmentKind
  amount_delta: number | null
  amount_before: number | null
  amount_after: number | null
  status_before: string
  status_after: string
  actor_id: string | null
  created_at: string
  undone_at: string | null
}

const iso = (v: Date | string | null | undefined): string | null => (v ? (typeof v === 'string' ? v : v.toISOString()) : null)

export function toAdjustmentDto(row: AdjustmentRow): AdjustmentDto {
  return {
    id: row.id,
    item_id: row.item_id,
    kind: row.kind === 'discard' ? 'discard' : 'consume',
    amount_delta: row.amount_delta ?? null,
    amount_before: row.amount_before ?? null,
    amount_after: row.amount_after ?? null,
    status_before: row.status_before,
    status_after: row.status_after,
    actor_id: row.actor_id ?? null,
    created_at: iso(row.created_at) ?? '',
    undone_at: iso(row.undone_at),
  }
}

export type AdjustFailure =
  /** No such item in this household (foreign ids look the same). */
  | 'NOT_FOUND'
  /** The item is already used up or thrown away. */
  | 'FINISHED'
  /** A partial amount was sent for an item that has no amount. */
  | 'NO_AMOUNT'
  /** Something changed the item while this ran; retry. */
  | 'CONFLICT'

export type UndoFailure =
  | 'NOT_FOUND'
  /** The item changed after the adjustment (edited, used again, …). */
  | 'UNDO_CONFLICT'

export type AdjustResult =
  | { ok: true; item: InventoryRow; adjustment: AdjustmentRow; replayed: boolean }
  | { ok: false; reason: AdjustFailure }

export type UndoResult =
  | { ok: true; item: InventoryRow; adjustment: AdjustmentRow; alreadyUndone: boolean }
  | { ok: false; reason: UndoFailure }

type Db = Pick<PrismaClient, 'inventoryItem' | 'inventoryAdjustment' | '$transaction'>

class CasLost extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002')
}

/**
 * The item's next `updated_at`: now, but always later than the previous
 * value, so the compare-and-set on `updated_at` that Undo relies on can never
 * be fooled by two changes in the same millisecond.
 */
export function nextItemVersion(previous: Date | string | null | undefined, now: Date = new Date()): Date {
  const prev = previous ? new Date(previous).getTime() : 0
  return new Date(Math.max(now.getTime(), prev + 1))
}

/** Round away float noise from a subtraction (0.3 - 0.1). */
function tidy(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

async function replayFor(db: Db, familyId: string, requestId: string | null): Promise<AdjustResult | null> {
  if (!requestId) return null
  const adjustment = await db.inventoryAdjustment.findFirst({
    where: { request_id: requestId, family_id: familyId },
    select: ADJUSTMENT_SELECT,
  })
  if (!adjustment) return null
  const item = await db.inventoryItem.findFirst({
    where: { id: adjustment.item_id, family_id: familyId },
    select: INVENTORY_ITEM_SELECT,
  })
  if (!item) return { ok: false, reason: 'NOT_FOUND' }
  return { ok: true, item, adjustment, replayed: true }
}

/**
 * Consume (all or part) or discard one active item of `familyId`, writing one
 * adjustment row. `requestId` is the idempotency record id (or null).
 */
export async function adjustInventoryItem(
  db: Db,
  input: {
    familyId: string
    itemId: string
    actorId: string
    kind: AdjustmentKind
    /** Consume only: how much was used; null/undefined = all of it. */
    amount?: number | null
    requestId: string | null
    now?: Date
  }
): Promise<AdjustResult> {
  const { familyId, itemId, actorId, kind } = input
  const replay = await replayFor(db, familyId, input.requestId)
  if (replay) return replay

  const item = await db.inventoryItem.findFirst({
    where: { id: itemId, family_id: familyId },
    select: { id: true, status: true, amount: true, updated_at: true },
  })
  if (!item) return { ok: false, reason: 'NOT_FOUND' }
  if (item.status !== 'active') return { ok: false, reason: 'FINISHED' }

  const used = kind === 'consume' ? (input.amount ?? null) : null
  if (used !== null && item.amount === null) return { ok: false, reason: 'NO_AMOUNT' }
  const partial = used !== null && item.amount !== null && used < item.amount
  const statusAfter = partial ? 'active' : kind === 'consume' ? 'consumed' : 'discarded'
  const amountAfter = partial ? tidy(item.amount! - used!) : item.amount
  const amountDelta = partial ? -used! : item.amount === null ? null : -item.amount
  const now = nextItemVersion(item.updated_at, input.now)

  try {
    const adjustment = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const moved = await tx.inventoryItem.updateMany({
        where: { id: itemId, family_id: familyId, status: 'active', updated_at: item.updated_at },
        data: {
          status: statusAfter,
          amount: amountAfter,
          finished_at: statusAfter === 'active' ? null : now,
          updated_at: now,
        },
      })
      if (moved.count !== 1) throw new CasLost()
      return tx.inventoryAdjustment.create({
        data: {
          family_id: familyId,
          item_id: itemId,
          kind,
          amount_delta: amountDelta,
          amount_before: item.amount,
          amount_after: amountAfter,
          status_before: 'active',
          status_after: statusAfter,
          actor_id: actorId,
          request_id: input.requestId,
          created_at: now,
        },
        select: ADJUSTMENT_SELECT,
      })
    })
    const row = await db.inventoryItem.findFirst({ where: { id: itemId, family_id: familyId }, select: INVENTORY_ITEM_SELECT })
    if (!row) return { ok: false, reason: 'NOT_FOUND' }
    return { ok: true, item: row, adjustment, replayed: false }
  } catch (error) {
    if (error instanceof CasLost) {
      // Lost the race: say FINISHED when the other writer finished it.
      const now2 = await db.inventoryItem.findFirst({ where: { id: itemId, family_id: familyId }, select: { status: true } })
      if (!now2) return { ok: false, reason: 'NOT_FOUND' }
      return { ok: false, reason: now2.status === 'active' ? 'CONFLICT' : 'FINISHED' }
    }
    if (isUniqueViolation(error)) {
      // A concurrent takeover of the same request wrote it first.
      const again = await replayFor(db, familyId, input.requestId)
      if (again) return again
    }
    throw error
  }
}

/**
 * Put an item back as it was before one adjustment. Only while nothing else
 * changed the item since (its `updated_at` is still the adjustment's time);
 * otherwise `UNDO_CONFLICT`, and the person edits the item instead.
 */
export async function undoInventoryAdjustment(
  db: Db,
  input: { familyId: string; adjustmentId: string; actorId: string; now?: Date }
): Promise<UndoResult> {
  const { familyId, adjustmentId } = input
  const adjustment = await db.inventoryAdjustment.findFirst({
    where: { id: adjustmentId, family_id: familyId },
    select: ADJUSTMENT_SELECT,
  })
  if (!adjustment) return { ok: false, reason: 'NOT_FOUND' }
  const current = async () =>
    db.inventoryItem.findFirst({ where: { id: adjustment.item_id, family_id: familyId }, select: INVENTORY_ITEM_SELECT })

  if (adjustment.undone_at) {
    const item = await current()
    if (!item) return { ok: false, reason: 'NOT_FOUND' }
    return { ok: true, item, adjustment, alreadyUndone: true }
  }

  const now = nextItemVersion(adjustment.created_at, input.now)
  try {
    const undone = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const restored = await tx.inventoryItem.updateMany({
        where: {
          id: adjustment.item_id,
          family_id: familyId,
          status: adjustment.status_after,
          updated_at: adjustment.created_at,
        },
        data: {
          status: adjustment.status_before,
          amount: adjustment.amount_before,
          finished_at: null,
          updated_at: now,
        },
      })
      if (restored.count !== 1) throw new CasLost()
      const marked = await tx.inventoryAdjustment.updateMany({
        where: { id: adjustment.id, family_id: familyId, undone_at: null },
        data: { undone_at: now, undone_by: input.actorId },
      })
      if (marked.count !== 1) throw new CasLost()
      return tx.inventoryAdjustment.findFirst({ where: { id: adjustment.id, family_id: familyId }, select: ADJUSTMENT_SELECT })
    })
    const item = await current()
    if (!item || !undone) return { ok: false, reason: 'NOT_FOUND' }
    return { ok: true, item, adjustment: undone, alreadyUndone: false }
  } catch (error) {
    if (!(error instanceof CasLost)) throw error
    // A concurrent Undo of the same row may have won: that is success.
    const again = await db.inventoryAdjustment.findFirst({
      where: { id: adjustmentId, family_id: familyId },
      select: ADJUSTMENT_SELECT,
    })
    if (again?.undone_at) {
      const item = await current()
      if (item) return { ok: true, item, adjustment: again, alreadyUndone: true }
    }
    return { ok: false, reason: 'UNDO_CONFLICT' }
  }
}
