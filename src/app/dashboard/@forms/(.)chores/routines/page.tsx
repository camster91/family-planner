import { getServerUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import RoutineStackEditor from "@/components/chores/RoutineStackEditor";

export const dynamic = "force-dynamic";

/** Intercepted parent sheet for opening a routine without leaving Chores. */
export default async function RoutineStackSheetPage() {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;
  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true, role: true },
  });
  if (!user?.family_id || user.role !== "parent") return null;
  return <RoutineStackEditor familyId={user.family_id} mode="sheet" />;
}
