/** Dormant #557 preparation only. The caller owns lifecycle authority/locks. */
import type { Prisma } from "@prisma/client";
import { hasRoutineSubjectStorage } from "@/lib/routine-subject-lifecycle";
import {
  prepareRoutineSubjectUnlinkBatch,
  ROUTINE_UNLINK_MAX_ROOTS,
  type RoutineSubjectUnlinkBatch,
} from "@/lib/routine-subject-unlink";

type Association = { familyId: string; userId: string; memberId: string };
type RootRow = {
  id: string;
  family_id: string;
  recurrence_id: string;
  routine_series_config: unknown;
};
export type RoutineSubjectUnlinkPreparation =
  | RoutineSubjectUnlinkBatch
  | { kind: "held"; reason: "storage-unavailable" };

/**
 * Call only inside the future unlink transaction AFTER locking participants
 * and the household, renewing the exact association and owner proof. Every
 * writer of future routine definitions must honor that household lock.
 *
 * Reads every non-null future ROOT definition without guessing subject fields,
 * supported protocols or active states. The lookahead holds oversized families;
 * it never supplies a truncated prefix to the planner. Missing schema is held,
 * not an empty inventory. Database errors propagate to abort the transaction.
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

  const rows = await tx.$queryRaw<RootRow[]>`
    SELECT "id", "family_id", "recurrence_id", "routine_series_config"
    FROM "Chore"
    WHERE "family_id" = ${association.familyId}
      AND "recurrence_id" = "id" AND "routine_series_config" IS NOT NULL
    ORDER BY "id" LIMIT ${ROUTINE_UNLINK_MAX_ROOTS + 1} FOR UPDATE`;
  if (rows.length > ROUTINE_UNLINK_MAX_ROOTS)
    return { kind: "held", reason: "too-many-roots" };

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
