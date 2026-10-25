/** Dormant #557 routine-domain adapter; not an unlink command or authority. */
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { routineScheduleConfig } from '@/lib/routine-schedule'
import { prepareRoutineSubjectUnlinkInTx, type RoutineSubjectUnlinkPreparation, ROUTINE_UNLINK_MAX_DEFINITION_BYTES, ROUTINE_UNLINK_MAX_TOTAL_BYTES } from '@/lib/routine-subject-unlink-read'

type Tx = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>
type Association = { familyId: string; userId: string; memberId: string }
type StackSize = { id: string; family_id: string; version: number; label_bytes: number; config_bytes: number }
type StackRow = { id: string; family_id: string; version: number; label: string; schedule_config: unknown }
type Held = Extract<RoutineSubjectUnlinkPreparation, { kind: 'held' }>
export type RoutineSubjectUnlinkWriteResult = Held |
  { kind: 'held'; reason: 'stack-storage-unavailable' | 'stack-inventory-changed' | 'stack-budget' | 'stack-definition-held' | 'stack-version-exhausted' } |
  { kind: 'applied'; inspectedRoots: number; unchangedRoots: number; rewrittenRoots: number; invalidatedStacks: number }

/** After any SQL mutation, propagate this error out of the enclosing transaction. */
export class RoutineSubjectUnlinkWriteConflict extends Error {
  constructor() { super('Routine unlink preparation changed; roll back the transaction'); this.name = 'RoutineSubjectUnlinkWriteConflict' }
}
const positiveInt = (value: number) => Number.isSafeInteger(value) && value > 0

/**
 * Internal routine slice for a FUTURE complete owner-verified unlink transaction.
 * Caller must hold participant User locks then household lock and renew exact
 * association, snapshot/proof, domain/credit/erasure capability before invoking.
 * Every future-definition writer must share that household-lock protocol.
 *
 * Freshly prepares the entire bounded root inventory; callers cannot supply a
 * stale/forged ready plan. Preflights all affected stack rows before any write.
 * A held result has no effects. After writes start, a failed compare/write throws:
 * the caller MUST let that error abort its entire transaction, never catch it and
 * commit other domains. No links, mappings, occurrences, credit or proofs change
 * here. Applied counts are internal preparation, not a receipt or public result.
 * This helper has no production HTTP/UI/account-command caller.
 */
export async function rewriteRoutineSubjectsForUnlinkInTx(
  tx: Tx, association: Association,
): Promise<RoutineSubjectUnlinkWriteResult> {
  const prepared = await prepareRoutineSubjectUnlinkInTx(tx, association)
  if (prepared.kind === 'held') return prepared

  const stacks: Array<{ row: StackRow; fingerprint: string }> = []
  if (prepared.stackIds.length) {
    const storage = await tx.$queryRaw<{ present: boolean }[]>`
      SELECT (SELECT count(*) = 3 FROM pg_attribute
        WHERE attrelid = to_regclass('"RoutineStack"')
          AND attname IN ('schedule_config', 'version', 'fingerprint') AND NOT attisdropped) AS present`
    if (storage.length !== 1 || storage[0].present !== true)
      return { kind: 'held', reason: 'stack-storage-unavailable' }

    // Count/byte metadata first: a corrupt stack body must not bypass root budgets.
    const sizes = await tx.$queryRaw<StackSize[]>`
      SELECT "id", "family_id", "version", octet_length("label") AS "label_bytes",
        COALESCE(octet_length("schedule_config"::text), 0) AS "config_bytes"
      FROM "RoutineStack" WHERE "family_id" = ${association.familyId}
        AND "id" = ANY(${prepared.stackIds}::text[]) ORDER BY "id" FOR UPDATE`
    const metadata = new Map<string, StackSize>()
    let totalBytes = 0
    if (sizes.length !== prepared.stackIds.length)
      return { kind: 'held', reason: 'stack-inventory-changed' }
    for (const row of sizes) {
      if (!prepared.stackIds.includes(row.id) || metadata.has(row.id) || row.family_id !== association.familyId ||
        !positiveInt(row.version) || !positiveInt(row.label_bytes) || !Number.isSafeInteger(row.config_bytes) || row.config_bytes < 0)
        return { kind: 'held', reason: 'stack-inventory-changed' }
      if (row.version >= 2147483647) return { kind: 'held', reason: 'stack-version-exhausted' }
      totalBytes += row.label_bytes + row.config_bytes
      if (row.label_bytes > ROUTINE_UNLINK_MAX_DEFINITION_BYTES || row.config_bytes > ROUTINE_UNLINK_MAX_DEFINITION_BYTES || totalBytes > ROUTINE_UNLINK_MAX_TOTAL_BYTES)
        return { kind: 'held', reason: 'stack-budget' }
      metadata.set(row.id, row)
    }
    const rows = await tx.$queryRaw<StackRow[]>`
      SELECT "id", "family_id", "version", "label", "schedule_config"
      FROM "RoutineStack" WHERE "family_id" = ${association.familyId}
        AND "id" = ANY(${prepared.stackIds}::text[]) ORDER BY "id" FOR UPDATE`
    if (rows.length !== metadata.size) return { kind: 'held', reason: 'stack-inventory-changed' }
    for (const row of rows) {
      const original = metadata.get(row.id)
      if (!original || row.family_id !== association.familyId || row.version !== original.version || typeof row.label !== 'string')
        return { kind: 'held', reason: 'stack-inventory-changed' }
      metadata.delete(row.id)
      const config = routineScheduleConfig.safeParse(row.schedule_config)
      // Null is an existing current-occurrence stack; still invalidate its review.
      if (row.schedule_config !== null && !config.success)
        return { kind: 'held', reason: 'stack-definition-held' }
      if (config.success && prepared.rewrites.some(rewrite => rewrite.stackId === row.id &&
        !config.data.steps.some(step => step.template_id === rewrite.rootId)))
        return { kind: 'held', reason: 'stack-definition-held' }
      const fingerprint = createHash('sha256').update(JSON.stringify({
        label: row.label, version: row.version + 1, config: config.success ? config.data : null,
      })).digest('hex')
      stacks.push({ row, fingerprint })
    }
    if (metadata.size) return { kind: 'held', reason: 'stack-inventory-changed' }
  }

  for (const rewrite of prepared.rewrites) {
    const count = await tx.$executeRaw`
      UPDATE "Chore" SET "routine_series_config" = ${JSON.stringify(rewrite.value)}::jsonb
      WHERE "id" = ${rewrite.rootId} AND "family_id" = ${association.familyId}
        AND "recurrence_id" = "id" AND "routine_series_config" IS NOT NULL
        AND COALESCE("routine_series_config"->>'revision', '1') = ${String(rewrite.previousRevision)}`
    if (count !== 1) throw new RoutineSubjectUnlinkWriteConflict()
  }
  for (const { row, fingerprint } of stacks) {
    const count = await tx.$executeRaw`
      UPDATE "RoutineStack" SET "version" = ${row.version + 1}, "fingerprint" = ${fingerprint}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${row.id} AND "family_id" = ${association.familyId} AND "version" = ${row.version}`
    if (count !== 1) throw new RoutineSubjectUnlinkWriteConflict()
  }
  return { kind: 'applied', inspectedRoots: prepared.inspectedRoots, unchangedRoots: prepared.unchangedRoots,
    rewrittenRoots: prepared.rewrites.length, invalidatedStacks: stacks.length }
}
