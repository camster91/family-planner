/** Dormant #557 preparation only. The caller owns lifecycle authority/locks. */
import type { Prisma } from "@prisma/client";
import { hasRoutineSubjectStorage } from "@/lib/routine-subject-lifecycle";
import {
  prepareRoutineSubjectUnlinkBatch,
  ROUTINE_UNLINK_MAX_ROOTS,
  type RoutineSubjectUnlinkBatch,
} from "@/lib/routine-subject-unlink";

type Association = { familyId: string; userId: string; memberId: string };
export const ROUTINE_UNLINK_MAX_DEFINITION_BYTES = 64 * 1024;
export const ROUTINE_UNLINK_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
type RootSize = {
  id: string;
  family_id: string;
  recurrence_id: string;
  definition_bytes: number;
};
type RootRow = {
  id: string;
  family_id: string;
  recurrence_id: string;
  routine_series_config: unknown;
};
export type RoutineSubjectUnlinkPreparation =
  | RoutineSubjectUnlinkBatch
  | { kind: "held"; reason: "storage-unavailable" | "definition-budget" | "invalid-inventory" | "inventory-changed" };

/**
 * Call only inside the future unlink transaction AFTER locking participants
 * and the household, renewing the exact association and owner proof. Every
 * writer of future routine definitions must honor that household lock.
 *
 * Reads every non-null future ROOT definition without guessing subject fields,
 * supported protocols or active states. The lookahead holds oversized families;
 * it never supplies a truncated prefix to the planner. Locked metadata sizes
 * bound each definition to64KiB and aggregate JSON to4MiB before body transfer.
 * Missing schema is held, not an empty inventory. Database errors propagate.
 *
 * FOR UPDATE protects the returned roots; it does not prevent phantom inserts
 * without the caller's household lock protocol or prove domain/credit parity.
 * A ready result performs no updates, grants no authority and is not a receipt.
 */
export async function prepareRoutineSubjectUnlinkInTx(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  association: Association,
): Promise<RoutineSubjectUnlinkPreparation> {
  const scope = prepareRoutineSubjectUnlinkBatch(
    { roots: [], complete: true }, association,
  );
  if (scope.kind === "held") return scope;
  if (!(await hasRoutineSubjectStorage(tx)))
    return { kind: "held", reason: "storage-unavailable" };

  // Lock and size all roots before transferring any definition JSON to Node.
  // octet_length counts serialized UTF-8 payload, not object/DB working memory.
  const sizes = await tx.$queryRaw<RootSize[]>`
    SELECT "id", "family_id", "recurrence_id",
      octet_length("routine_series_config"::text) AS "definition_bytes"
    FROM "Chore"
    WHERE "family_id" = ${association.familyId}
      AND "recurrence_id" = "id" AND "routine_series_config" IS NOT NULL
    ORDER BY "id" LIMIT ${ROUTINE_UNLINK_MAX_ROOTS + 1} FOR UPDATE`;
  if (sizes.length > ROUTINE_UNLINK_MAX_ROOTS)
    return { kind: "held", reason: "too-many-roots" };
  let bytes = 0;
  const ids = new Set<string>();
  for (const row of sizes) {
    if (typeof row.id !== "string" || row.id.length < 1 || row.id.length > 128 ||
      row.family_id !== association.familyId || row.recurrence_id !== row.id || ids.has(row.id) ||
      !Number.isSafeInteger(row.definition_bytes) || row.definition_bytes < 1)
      return { kind: "held", reason: "invalid-inventory" };
    ids.add(row.id);
    bytes += row.definition_bytes;
    if (row.definition_bytes > ROUTINE_UNLINK_MAX_DEFINITION_BYTES || bytes > ROUTINE_UNLINK_MAX_TOTAL_BYTES)
      return { kind: "held", reason: "definition-budget" };
  }
  if (sizes.length === 0) return scope;
  const rows = await tx.$queryRaw<RootRow[]>`
    SELECT "id", "family_id", "recurrence_id", "routine_series_config"
    FROM "Chore"
    WHERE "family_id" = ${association.familyId}
      AND "recurrence_id" = "id" AND "routine_series_config" IS NOT NULL
      AND "id" = ANY(${[...ids]}::text[])
    ORDER BY "id" FOR UPDATE`;
  if (rows.length !== sizes.length || rows.some(row => !ids.delete(row.id)) || ids.size)
    return { kind: "held", reason: "inventory-changed" };

  return prepareRoutineSubjectUnlinkBatch({
    complete: true,
    roots: rows.map((row) => ({
      id: row.id,
      familyId: row.family_id,
      recurrenceId: row.recurrence_id,
      definition: row.routine_series_config,
    })),
  }, association);
}
