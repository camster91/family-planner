import { getServerUser } from "@/lib/supabase/server";
import RoutineStackEditor from "@/components/chores/RoutineStackEditor";
import { readRoutineScheduleHandoff } from "@/lib/routine-schedule-handoff";
import { RoutineScheduleHandoff } from "@/components/chores/RoutineScheduleHandoff";

export const dynamic = "force-dynamic";

/** Direct parent route for a current-occurrence routine stack. */
export default async function RoutineStackPage({
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
  if (href) return <RoutineScheduleHandoff href={href} />;
  return <RoutineStackEditor familyId={familyId} mode="page" />;
}
