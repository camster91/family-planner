/** Exact owned identity only. Never promote a legacy routine by matching its label. */
import { storageBackend } from "@/lib/storage-backend";
import type { PrismaClient } from "@prisma/client";
import { routineStepSeriesConfig } from "@/lib/routine-schedule";
import { ROUTINE_SCHEDULE_READY_ENV } from "@/lib/routine-schedule-gates";
export async function readRoutineScheduleHandoff(
  db: Pick<PrismaClient, "$queryRaw">,
  familyId: string,
  kind: "stack" | "chore",
  id: string,
): Promise<string | null> {
  if (process.env[ROUTINE_SCHEDULE_READY_ENV] !== "1" || !id || id.length > 128)
    return null;
  if (storageBackend() === "d1") {
    const { readD1RoutineScheduleHandoff } = await import("@/lib/cloudflare/routine-schedule-handoff");
    return readD1RoutineScheduleHandoff(familyId, kind, id);
  }
  if (kind === "stack") {
    const rows = await db.$queryRaw<
      { id: string; schedule_config: unknown }[]
    >`SELECT "id", "schedule_config" FROM "RoutineStack" WHERE "id" = ${id} AND "family_id" = ${familyId}`;
    return rows.length === 1 && rows[0].schedule_config != null
      ? `/dashboard/chores/schedules?stack_id=${encodeURIComponent(rows[0].id)}`
      : null;
  }
  const rows = await db.$queryRaw<
    { routine_series_config: unknown; stack_id: string | null }[]
  >`
    SELECT c."routine_series_config", s."id" AS stack_id FROM "Chore" c
    LEFT JOIN "RoutineStack" s ON s."id" = c."routine_series_config"->>'stack_id' AND s."family_id" = c."family_id" AND s."schedule_config" IS NOT NULL
    WHERE c."id" = ${id} AND c."family_id" = ${familyId} AND c."recurrence_id" = c."id"`;
  if (rows.length !== 1 || rows[0].routine_series_config == null) return null;
  const parsed = routineStepSeriesConfig.safeParse(
    rows[0].routine_series_config,
  );
  if (!parsed.success) return "/dashboard/chores/schedules";
  if (parsed.data.stack_id === null)
    return `/dashboard/chores/schedules/independent?root_id=${encodeURIComponent(id)}`;
  return parsed.data.stack_id && parsed.data.stack_id === rows[0].stack_id
    ? `/dashboard/chores/schedules?stack_id=${encodeURIComponent(parsed.data.stack_id)}`
    : null;
}
