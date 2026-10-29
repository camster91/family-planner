import { getServerUser } from "@/lib/supabase/server";
import RoutineStackEditor from "@/components/chores/RoutineStackEditor";
import { readRoutineScheduleHandoff } from "@/lib/routine-schedule-handoff";
import { RoutineScheduleHandoff } from "@/components/chores/RoutineScheduleHandoff";

export const dynamic = "force-dynamic";

/** Intercepted parent sheet for opening a routine without leaving Chores. */
export default async function RoutineStackSheetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;
  const familyId = sessionUser.family_id;
  if (!familyId || sessionUser.role !== "parent") return null;
  const params = await searchParams;
  const href =
    typeof params.stack_id === "string"
      ? await readRoutineScheduleHandoff(
          undefined,
          familyId,
          "stack",
          params.stack_id,
        )
      : null;
  if (href) return <RoutineScheduleHandoff href={href} sheet />;
  return <RoutineStackEditor familyId={familyId} mode="sheet" />;
}
