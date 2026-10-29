import { notFound } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { ROUTINE_SCHEDULE_READY_ENV } from "@/lib/routine-schedule-gates";
import IndependentRoutineManager from "@/components/chores/IndependentRoutineManager";
export const dynamic = "force-dynamic";
/** Dedicated private parent management view; no shared-device route or new shell. */
export default async function IndependentRoutinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env[ROUTINE_SCHEDULE_READY_ENV] !== "1") notFound();
  const session = await getServerUser();
  if (!session) return null;
  const familyId = session.family_id;
  if (!familyId || session.role !== "parent") return null;
  const query = await searchParams;
  const rootId = typeof query.root_id === "string" ? query.root_id : undefined;
  if (rootId && rootId.length > 128) notFound();
  return (
    <IndependentRoutineManager
      key={`${session.id}:${familyId}`}
      userId={session.id}
      familyId={familyId}
      initialRootId={rootId}
    />
  );
}
