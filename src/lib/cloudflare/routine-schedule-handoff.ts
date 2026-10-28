/** Read-only exact identity navigation. No names or future definitions leave
 * this boundary; malformed definitions keep the canonical editor fallback. */
import { routineStepSeriesConfig } from "@/lib/routine-schedule";
import { getD1Database, type D1Store } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1 } from "./read-client";
export async function readD1RoutineScheduleHandoff(
  familyId: string,
  kind: "stack" | "chore",
  id: string,
  database?: D1Store,
): Promise<string | null> {
  if (!id || id.length > 128) return null;
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  const captured = await captureD1Reads(
    async (db) => {
      if (kind === "stack") {
        const row = await db.routineStack.findFirst({
          where: { id, family_id: familyId },
          select: { id: true, schedule_config: true },
        });
        return row?.schedule_config != null
          ? `/dashboard/chores/schedules?stack_id=${encodeURIComponent(row.id)}`
          : null;
      }
      const root = await db.chore.findFirst({
        where: { id, family_id: familyId, recurrence_id: id },
        select: { routine_series_config: true },
      });
      if (root?.routine_series_config == null) return null;
      const parsed = routineStepSeriesConfig.safeParse(
        root.routine_series_config,
      );
      if (!parsed.success) return "/dashboard/chores/schedules";
      if (parsed.data.stack_id === null)
        return `/dashboard/chores/schedules/independent?root_id=${encodeURIComponent(id)}`;
      const stack = await db.routineStack.findFirst({
        where: { id: parsed.data.stack_id, family_id: familyId },
        select: { id: true, schedule_config: true },
      });
      return stack?.schedule_config != null
        ? `/dashboard/chores/schedules?stack_id=${encodeURIComponent(stack.id)}`
        : null;
    },
    store as unknown as NativeD1,
  );
  await session.batch(captured.checks(session));
  return captured.value;
}
