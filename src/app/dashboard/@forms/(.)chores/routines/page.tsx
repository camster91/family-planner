import { getServerUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
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
  if (href) return <RoutineScheduleHandoff href={href} sheet />;
  return <RoutineStackEditor familyId={user.family_id} mode="sheet" />;
}
