import { getServerActor } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { readListOverview, type ListOverview } from "@/lib/list-overview";
import { prisma } from "@/lib/prisma";
import ListsClient from "./ListsClient";
import PendingTickRecovery from "./PendingTickRecovery";
import { listTypeFilter } from "@/lib/list-type-filter";

export const dynamic = "force-dynamic";

export default async function ListsPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string | string[] }>;
}) {
  // `?type=` (route inventory F-6): the old /dashboard/lists/type/[type] pages redirect here.
  const initialType = listTypeFilter((await searchParams)?.type);

  const actor = await getServerActor();
  if (!actor?.family_id || !actor.role) return null;

  let overview: ListOverview | null = null;
  let loadFailed = false;
  try {
    overview = await readListOverview(prisma!, {
      userId: actor.id,
      familyId: actor.family_id,
      role: actor.role,
      tokenVersion: actor.tokenVersion,
    });
  } catch {
    // Failed aggregation is unknown, never a fabricated zero-progress list.
    loadFailed = true;
    console.warn("List overview read failed");
  }
  if (!loadFailed && !overview) redirect("/dashboard");

  return (
    <>
      <ListsClient
        lists={overview?.lists ?? []}
        familyName={overview?.familyName || "Family"}
        canCreate={overview?.canCreate ?? false}
        initialType={initialType}
        loadFailed={loadFailed}
      />
      <PendingTickRecovery key={actor.id} userId={actor.id} />
    </>
  );
}
