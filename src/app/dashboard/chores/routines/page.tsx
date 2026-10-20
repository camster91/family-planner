import { getServerUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
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
  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true, role: true },
  });
  if (!user?.family_id || user.role !== "parent") return null;
  const params = await searchParams;
  const href =
    typeof params.stack_id === "string"
      ? await readRoutineScheduleHandoff(
          prisma!,
          user.family_id,
          "stack",
          params.stack_id,
        )
      : null;
  if (href) return <RoutineScheduleHandoff href={href} />;
  return <RoutineStackEditor familyId={user.family_id} mode="page" />;
}
