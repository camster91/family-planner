import EditChoreForm from "./EditChoreForm";
import { getServerUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readRoutineScheduleHandoff } from "@/lib/routine-schedule-handoff";
import { RoutineScheduleHandoff } from "@/components/chores/RoutineScheduleHandoff";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerUser();
  if (session?.role === "parent" && session.family_id) {
    const params = await searchParams;
    const href =
      typeof params.id === "string"
        ? await readRoutineScheduleHandoff(
            prisma!,
            session.family_id,
            "chore",
            params.id,
          )
        : null;
    if (href) return <RoutineScheduleHandoff href={href} />;
  }
  return <EditChoreForm />;
}
