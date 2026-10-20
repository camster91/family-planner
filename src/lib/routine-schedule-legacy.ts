import type { Prisma } from "@prisma/client";
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
}
