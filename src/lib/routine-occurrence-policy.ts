/** Private read/action guards survive rollout rollback; never a public DTO. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { routineStepSeriesConfig } from "@/lib/routine-schedule";

export type RoutineOccurrenceSnapshot = {
  id: string;
  recurrence_id: string | null;
  root_id: string | null;
  root_recurrence_id: string | null;
  own_config: unknown;
  series_config: unknown;
  due_date: Date;
  status: string;
  photo_url: string | null;
  photo_verified: boolean;
  verified_at: Date | null;
  verified_notes: string | null;
  completed_at: Date | null;
  successor_id: string | null;
  member_subject_erased: boolean;
};
export type RoutineOccurrencePolicy =
  "legacy" | "scheduled" | "scheduled-once" | "inactive" | "unsupported";
export class RoutineOccurrenceUnavailableError extends Error {
  readonly code = "CHORE_ROUTINE_INACTIVE";
  constructor() {
    super("This routine chore is no longer available. Refresh your chores.");
  }
}
/** A pause never discards completion, started work, proof or previous-day work. */
export function routineOccurrencePolicy(
  row: RoutineOccurrenceSnapshot,
): RoutineOccurrencePolicy {
  const raw = row.own_config ?? row.series_config;
  if (raw == null) return "legacy";
  const parsed = routineStepSeriesConfig.safeParse(raw);
  if (
    !parsed.success ||
    !row.root_id ||
    row.root_recurrence_id !== row.root_id ||
    row.recurrence_id !== row.root_id ||
    (row.own_config != null && row.id !== row.root_id)
  )
    return "unsupported";
  const definition = parsed.data;
  const untouched =
    row.status === "pending" &&
    row.photo_url === null &&
    row.photo_verified === false &&
    row.verified_at === null &&
    row.verified_notes === null &&
    row.completed_at === null &&
    row.successor_id === null;
  const pristine = untouched && row.member_subject_erased === false;
  // Anonymous replacement controls are never presented as overdue/to-do work.
  // Evidence-bearing historical roots retain their normal history visibility.
  if (definition.anchor_retired && row.id === row.root_id && untouched)
    return "inactive";
  if (
    definition.state !== "active" &&
    pristine &&
    row.due_date.toISOString().slice(0, 10) >= definition.effective_on
  )
    return "inactive";
  return definition.schedule.frequency === "once"
    ? "scheduled-once"
    : "scheduled";
}
type Reader = Pick<PrismaClient, "$queryRaw">;
/** Filters execute before ordinary paging/caps. All joins stay household-scoped. */
export async function hiddenRoutineOccurrenceIds(
  db: Reader,
  familyId: string,
): Promise<string[]> {
  const rows = await db.$queryRaw<RoutineOccurrenceSnapshot[]>`
    SELECT c."id", c."recurrence_id", r."id" AS root_id, r."recurrence_id" AS root_recurrence_id,
      c."routine_series_config" AS own_config, r."routine_series_config" AS series_config,
      c."due_date", c."status", c."photo_url", c."photo_verified", c."verified_at", c."verified_notes",
      c."completed_at", c."successor_id", c."member_subject_erased"
    FROM "Chore" c LEFT JOIN "Chore" r ON r."id" = c."recurrence_id" AND r."family_id" = c."family_id"
    WHERE c."family_id" = ${familyId} AND c."status" IN ('pending', 'in_progress', 'overdue')
      AND (c."routine_series_config" IS NOT NULL OR r."routine_series_config" IS NOT NULL)`;
  return rows
    .filter((row) =>
      ["inactive", "unsupported"].includes(routineOccurrencePolicy(row)),
    )
    .map((row) => row.id);
}
/** Caller holds the household lock; matching raw row is re-read inside the effect. */
export async function routineOccurrencePolicyInTx(
  tx: Prisma.TransactionClient,
  familyId: string,
  choreId: string,
): Promise<RoutineOccurrencePolicy> {
  const rows = await tx.$queryRaw<RoutineOccurrenceSnapshot[]>`
    SELECT c."id", c."recurrence_id", r."id" AS root_id, r."recurrence_id" AS root_recurrence_id,
      c."routine_series_config" AS own_config, r."routine_series_config" AS series_config,
      c."due_date", c."status", c."photo_url", c."photo_verified", c."verified_at", c."verified_notes",
      c."completed_at", c."successor_id", c."member_subject_erased"
    FROM "Chore" c LEFT JOIN "Chore" r ON r."id" = c."recurrence_id" AND r."family_id" = c."family_id"
    WHERE c."family_id" = ${familyId} AND c."id" = ${choreId}`;
  // A disappeared occurrence cannot become an available legacy chore.
  return rows.length === 1 ? routineOccurrencePolicy(rows[0]) : "unsupported";
}

/**
 * Read only the rows already selected for a response. A recurrence ID alone is
 * not evidence that a scheduled step repeats: a routine can run just once.
 * Private metadata is reduced to owned occurrence IDs and never enters a DTO.
 */
export async function scheduledOnceRoutineOccurrenceIds(
  db: Reader,
  familyId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const selected = [...new Set(ids)];
  const rows = await db.$queryRaw<RoutineOccurrenceSnapshot[]>`
    SELECT c."id", c."recurrence_id", r."id" AS root_id, r."recurrence_id" AS root_recurrence_id,
      c."routine_series_config" AS own_config, r."routine_series_config" AS series_config,
      c."due_date", c."status", c."photo_url", c."photo_verified", c."verified_at", c."verified_notes",
      c."completed_at", c."successor_id", c."member_subject_erased"
    FROM "Chore" c LEFT JOIN "Chore" r ON r."id" = c."recurrence_id" AND r."family_id" = c."family_id"
    WHERE c."family_id" = ${familyId} AND c."id" = ANY(${selected}::text[])
      AND (c."routine_series_config" IS NOT NULL OR r."routine_series_config" IS NOT NULL)`;
  const requested = new Set(selected);
  return new Set(
    rows
      .filter(
        (row) =>
          requested.has(row.id) &&
          routineOccurrencePolicy(row) === "scheduled-once",
      )
      .map((row) => row.id),
  );
}
