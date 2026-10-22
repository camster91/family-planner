import { getServerActor } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { readListOverview, type ListOverview } from "@/lib/list-overview";
import { prisma } from "@/lib/prisma";
import ListsClient from "./ListsClient";
import PendingTickRecovery from "./PendingTickRecovery";
import {
  listTypeFilter,
  listsFilterHref,
  listsPageHref,
} from "@/lib/list-type-filter";
import { parseListPaging, LIST_OVERVIEW_PAGE_SIZE } from "@/lib/list-paging";

export const dynamic = "force-dynamic";

export default async function ListsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    type?: string | string[];
    cursor?: string | string[];
  }>;
}) {
  // `?type=` (route inventory F-6): the old /dashboard/lists/type/[type] pages redirect here.
  const params = await searchParams;
  const initialType = listTypeFilter(params?.type);

  const actor = await getServerActor();
  if (!actor?.family_id || !actor.role) return null;

  const pagingParams = new URLSearchParams({
    limit: String(LIST_OVERVIEW_PAGE_SIZE),
  });
  const cursors = params?.cursor;
  for (const value of Array.isArray(cursors)
    ? cursors
    : cursors === undefined
      ? []
      : [cursors])
    pagingParams.append("cursor", value);
  const paging = parseListPaging(pagingParams, {
    familyId: actor.family_id,
    type: initialType,
  });
  if (!paging.ok || !paging.paged) redirect(listsFilterHref(initialType));
  const firstHref = listsFilterHref(initialType);

  let overview: ListOverview | null = null;
  let loadFailed = false;
  try {
    overview = await readListOverview(
      prisma!,
      {
        userId: actor.id,
        familyId: actor.family_id,
        role: actor.role,
        tokenVersion: actor.tokenVersion,
      },
      { type: initialType, paging },
    );
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
        typeCounts={overview?.typeCounts}
        paging={{
          continued: Boolean(paging.cursor),
          currentCursor: typeof cursors === "string" ? cursors : null,
          firstHref,
          nextHref: overview?.nextCursor
            ? listsPageHref(initialType, overview.nextCursor)
            : null,
        }}
      />
      <PendingTickRecovery key={actor.id} userId={actor.id} />
    </>
  );
}
