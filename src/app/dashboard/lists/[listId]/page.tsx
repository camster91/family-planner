import { redirect } from "next/navigation";
import { getServerActor } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readListDetailPage } from "@/lib/list-detail-reader";
import {
  parseListItemPaging,
  LIST_ITEM_PAGE_SIZE,
} from "@/lib/list-item-paging";
import ListDetailClient from "./ListDetailClient";
import DeleteListButton from "./DeleteListButton";
import ListsBackLink from "./ListsBackLink";
import { ListReadStatus } from "./ListReadStatus";
import PendingTickRecovery from "../PendingTickRecovery";
import { listTypeFilter } from "@/lib/list-type-filter";
import { parseListPaging, LIST_OVERVIEW_PAGE_SIZE } from "@/lib/list-paging";
import { PersonGroceryAdd } from "./PersonGroceryAdd";
import type { ListType } from "@/types";
import {
  canChangeListSectionSort,
  canDeleteListOrItem,
} from "@/lib/role-capabilities";

export const dynamic = "force-dynamic";
export default async function ListDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ listId: string }>;
  searchParams?: Promise<{
    type?: string | string[];
    overviewCursor?: string | string[];
    itemCursor?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const returnFilter = listTypeFilter(query?.type);
  const { listId } = await params;
  const actor = await getServerActor();
  if (!actor?.family_id || !actor.role) return null;
  let returnCursor: string | null = null;
  if (typeof query?.overviewCursor === "string") {
    const position = parseListPaging(
      new URLSearchParams({
        limit: String(LIST_OVERVIEW_PAGE_SIZE),
        cursor: query.overviewCursor,
      }),
      {
        familyId: actor.family_id,
        type: returnFilter,
      },
    );
    if (position.ok && position.paged) returnCursor = query.overviewCursor;
  }
  const firstQuery = new URLSearchParams();
  if (returnFilter) firstQuery.set("type", returnFilter);
  if (returnCursor) firstQuery.set("overviewCursor", returnCursor);
  const firstHref = `/dashboard/lists/${encodeURIComponent(listId)}${firstQuery.toString() ? `?${firstQuery}` : ""}`;
  const positions = new URLSearchParams({ limit: String(LIST_ITEM_PAGE_SIZE) });
  for (const value of Array.isArray(query?.itemCursor)
    ? query.itemCursor
    : typeof query?.itemCursor === "string"
      ? [query.itemCursor]
      : [])
    positions.append("cursor", value);
  const paging = parseListItemPaging(positions, {
    familyId: actor.family_id,
    listId,
  });
  if (!paging.ok || !paging.paged) redirect(firstHref);
  let snapshot: Awaited<ReturnType<typeof readListDetailPage>> | null = null;
  try {
    snapshot = await readListDetailPage(
      prisma!,
      {
        userId: actor.id,
        familyId: actor.family_id,
        role: actor.role,
        tokenVersion: actor.tokenVersion,
      },
      listId,
      paging,
    );
  } catch {
    // No raw database error or private list content enters logs.
    console.warn("List detail read failed");
  }
  if (snapshot?.state === "forbidden") redirect("/dashboard");
  if (!snapshot || snapshot.state === "missing")
    return (
      <div className="max-w-4xl mx-auto px-4 space-y-4">
        <ListsBackLink filter={returnFilter} cursor={returnCursor} />
        <ListReadStatus failed={!snapshot} />
        <PersonGroceryAdd userId={actor.id} listId={listId} allowNew={false} />
        <PendingTickRecovery key={actor.id} userId={actor.id} />
      </div>
    );
  const {
    list,
    items,
    sections,
    overrides: sectionOverrides,
    sectionOrder,
  } = snapshot;
  const canDelete = canDeleteListOrItem(actor.role);
  const mappedItems = items.map((item, i: number) => ({
    id: item.id,
    content: item.content,
    checked: item.checked,
    updated_at: item.updated_at.toISOString(),
    quantity: item.quantity ?? 1,
    category: item.category ?? null,
    added_by: item.adder,
    checked_by: item.checker ?? undefined,
    checked_at: item.checked_at?.toISOString(),
    amount: item.amount ?? null,
    unit: item.unit ?? null,
    ingredient_id: item.ingredient_id ?? null,
    ingredient_name: item.ingredient?.name ?? null,
    recipe_title: item.recipe?.title ?? null,
    section: sections[i] ?? null,
  }));

  return (
    <div className="max-w-2xl mx-auto">
      {/* Nav */}
      <div className="flex items-center justify-between px-4 pt-4 mb-4">
        <ListsBackLink filter={returnFilter} cursor={returnCursor} />
        {canDelete && (
          <DeleteListButton
            listId={list.id}
            listName={list.name}
            returnFilter={returnFilter}
            returnCursor={returnCursor}
          />
        )}
      </div>

      {list.image_url && (
        <div className="px-4 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={list.image_url}
            alt={list.name}
            width={640}
            height={200}
            className="w-full max-h-48 object-contain rounded-xl bg-[var(--surface-fill)]"
          />
        </div>
      )}

      <ListDetailClient
        key={`${actor.id}:${actor.tokenVersion}:${list.id}`}
        version={snapshot.version}
        generatedAt={new Date().toISOString()}
        listId={list.id}
        listName={list.name}
        listType={list.type as ListType}
        items={mappedItems}
        userId={actor.id}
        ownerGeneration={actor.tokenVersion}
        canDeleteItems={canDelete}
        paging={{
          continued: Boolean(paging.cursor),
          firstHref,
          nextHref: snapshot.nextCursor
            ? `${firstHref}${firstQuery.toString() ? "&" : "?"}itemCursor=${encodeURIComponent(snapshot.nextCursor)}`
            : null,
          versionQuery: new URLSearchParams({
            limit: String(LIST_ITEM_PAGE_SIZE),
            ...(typeof query?.itemCursor === "string"
              ? { cursor: query.itemCursor }
              : {}),
          }).toString(),
        }}
        sectionSort={{
          enabled: list.sort_by_section !== false,
          order: sectionOrder.order,
          learned: sectionOrder.learned,
          overrides: sectionOverrides,
          canChange: canChangeListSectionSort(actor.role),
        }}
      />
      <PendingTickRecovery key={actor.id} userId={actor.id} />
    </div>
  );
}

// Inline delete button moved to ./DeleteListButton.tsx (client component)
