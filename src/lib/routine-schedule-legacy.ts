import type { Prisma } from "@prisma/client";
import { routineOccurrencePolicyInTx } from "@/lib/routine-occurrence-policy";
export class RoutineScheduleLegacyWriteError extends Error {
  readonly code = "ROUTINE_SCHEDULE_EDITOR_REQUIRED";
  constructor() {
    super("Open the routine schedule editor to change this series.");
  }
}
/** Caller holds the household lock and has renewed ordinary edit/delete authority. */
export async function refuseScheduledRoutineLegacyWrite(
  tx: Prisma.TransactionClient,
  familyId: string,
  choreId: string,
  series = false,
) {
  const rows = await tx.$queryRaw<{ routine_series_config: unknown }[]>`
    SELECT "routine_series_config" FROM "Chore"
    WHERE "family_id" = ${familyId} AND (
      "id" = ${choreId} OR (${series} AND "id" = (
        SELECT "recurrence_id" FROM "Chore" WHERE "id" = ${choreId} AND "family_id" = ${familyId}
      ))
    ) FOR UPDATE`;
  // Unknown/future definitions also refuse: an older command must not rewrite
  // the root behind a versioned shared schedule.
  if (rows.some((row) => row.routine_series_config != null))
    throw new RoutineScheduleLegacyWriteError();
  const policy = await routineOccurrencePolicyInTx(tx, familyId, choreId);
  if (policy === "inactive" || policy === "unsupported")
    throw new RoutineScheduleLegacyWriteError();
}

/** Current-occurrence commands cannot overwrite a versioned future stack or
 * adopt its root/copies into another occurrence stack. Receipt replay is checked
 * first by the caller; this applies only before a new effect under its locks. */
export async function refuseScheduledOccurrenceStackWrite(
  tx: {
    $queryRaw(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<unknown>;
  },
  familyId: string,
  stackId: string | null,
  choreIds: string[],
) {
  const result = await tx.$queryRaw`
    SELECT s."schedule_config" AS schedule_config FROM "RoutineStack" s
      WHERE s."family_id" = ${familyId} AND s."id" = ${stackId}
    UNION ALL
    SELECT COALESCE(c."routine_series_config", r."routine_series_config") AS schedule_config
      FROM "Chore" c LEFT JOIN "Chore" r ON r."id" = c."recurrence_id" AND r."family_id" = c."family_id"
      WHERE c."family_id" = ${familyId} AND c."id" = ANY(${choreIds}::text[])`;
  if (!Array.isArray(result)) throw new Error("Routine metadata read failed");
  if (result.some((row) => row.schedule_config != null))
    throw new RoutineScheduleLegacyWriteError();
}
